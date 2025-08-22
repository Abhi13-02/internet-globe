const WebSocket = require('ws');
const { getASNLocation, getRRCLocation } = require('./ans-geo');

const RIPE_WEBSOCKET_URL = 'wss://ris-live.ripe.net/v1/ws/';

// Filter configuration - only process events from these important ASNs
const IMPORTANT_ASNS = new Set([
  15169, // Google
  16509, 14618, // Amazon
  13335, // Cloudflare
  8075, // Microsoft
  32934, // Meta/Facebook
  3356, // Level3
  174, // Cogent
  6939, // Hurricane Electric
  2914, // NTT
  3320, // Deutsche Telekom
  3215, // Orange
  2856, // BT
  4134, 4837, // China Telecom/Unicom
  9498, 9829, 55836, // Indian ISPs
]);


// Only process these types of BGP messages
const ALLOWED_TYPES = new Set(['announcement', 'withdrawal']);

class RipeClient {
  constructor(redisClient, streamName, maxLen) {
    this.redis = redisClient;
    this.streamName = streamName;
    this.maxLen = maxLen;
    this.ws = null;
    this.reconnectInterval = 5000;
    this.isConnecting = false;
    
    // Better metrics tracking
    this.messagesReceived = 0;  // RIS messages
    this.eventsGenerated = 0;   // Individual prefix events
    this.eventsSent = 0;        // Events sent to Redis
    this.subscriptionTime = 0;
    this.filteredCount = 0;     // Debug counter
    
    // Add throttling state
    this.prefixLastSeen = new Map(); // prefix -> {ts, pathHash, type}
    this.THROTTLE_WINDOW_MS = 1000; // 1 second per prefix
    
    // Metrics for throttling
    this.throttled = 0;
    this.pathChanges = 0;
    this.typeFlips = 0;
    
    // Color configuration
    this.ANNOUNCE_COLOR = '#3aa3ff';
    this.WITHDRAW_COLOR = '#ff8a3a';
  }

  /**
   * Connect to RIPE RIS Live WebSocket
   */
  async connect() {
    if (this.isConnecting) {
      console.log('Already attempting to connect...');
      return;
    }

    this.isConnecting = true;
    
    try {
      console.log('Connecting to RIPE RIS Live WebSocket...');
      
      this.ws = new WebSocket(RIPE_WEBSOCKET_URL);
      
      this.ws.on('open', () => {
        console.log('✅ Connected to RIPE RIS Live!');
        this.isConnecting = false;
        
        // Parse RRC list from environment
        const rrcSet = process.env.RRC_SET ? process.env.RRC_SET.split(',') : ['rrc00'];
        
        // Subscribe to each RRC separately for better control
        rrcSet.forEach(rrc => {
          const subscription = {
            type: 'ris_subscribe',
            data: {
              host: rrc,
              type: 'UPDATE',  // Only BGP UPDATE messages
              socketOptions: {
                includeRaw: false,  // We don't need raw BGP bytes
                moreSpecific: true,
                lessSpecific: true
              }
            }
          };
          
          this.ws.send(JSON.stringify(subscription));
          console.log(`📡 Subscribed to ${rrc}`);
        });
        
        console.log(`✅ Subscribed to ${rrcSet.length} RRCs for UPDATE messages`);
        this.subscriptionTime = Date.now();
        
        // Start metrics logging
        this.startMetricsLogging();
      });

      this.ws.on('message', (data) => {
        try {
          this.handleMessage(data);
        } catch (error) {
          console.error('Error processing message:', error);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.log(`🔌 WebSocket closed: ${code} - ${reason}`);
        this.isConnecting = false;
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
        this.isConnecting = false;
        this.scheduleReconnect();
      });

    } catch (error) {
      console.error('❌ Failed to connect:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  /**
   * Start metrics logging every 10 seconds
   */
  startMetricsLogging() {
    setInterval(() => {
      const uptime = Math.floor((Date.now() - this.subscriptionTime) / 1000);
      
      console.log(`📊 Metrics [${uptime}s]:`, {
        // Input metrics
        ris_messages: this.messagesReceived,
        events_generated: this.eventsGenerated,
        
        // Filtering metrics  
        events_sent: this.eventsSent,
        events_throttled: this.throttled,
        
        // Quality metrics (these should never be throttled!)
        path_changes_preserved: this.pathChanges,
        type_flips_preserved: this.typeFlips,
        
        // Rates
        avg_events_in: Math.floor(this.eventsGenerated / Math.max(uptime, 1)),
        avg_events_out: Math.floor(this.eventsSent / Math.max(uptime, 1)),
        
        // Effectiveness
        reduction_rate: `${((1 - this.eventsSent / Math.max(this.eventsGenerated, 1)) * 100).toFixed(1)}%`,
        
        // Health check
        quality_check: this.pathChanges > 0 && this.typeFlips > 0 ? '✅' : '⚠️'
      });
      
      // Clean up old prefix entries (memory management)
      const cutoff = Date.now() - 60000; // 1 minute
      for (const [prefix, data] of this.prefixLastSeen.entries()) {
        if (data.ts < cutoff) {
          this.prefixLastSeen.delete(prefix);
        }
      }
    }, 10000);
  }

  /**
   * Handle incoming WebSocket messages from RIPE
   */
  handleMessage(data) {
    const message = JSON.parse(data.toString());
    
    if (message.type !== 'ris_message') {
      return;
    }

    this.messagesReceived++;  // Track RIS messages
    
    const bgpData = message.data;
    
    if (!this.shouldProcessEvent(bgpData)) {
      return;
    }

    // Convert RIPE format to our internal format
    const processedEvents = this.convertRipeToArc(bgpData);
    this.eventsGenerated += processedEvents.length;  // Track generated events
    
    // Apply throttling with exemptions
    const eventsToSend = processedEvents.filter(event => !this.shouldThrottle(event));
    
    // Send filtered events to Redis
    eventsToSend.forEach(async (arc) => {
      try {
        await this.redis.xAdd(this.streamName, '*', { data: JSON.stringify(arc) }, {
          TRIM: {
            strategy: 'MAXLEN',
            strategyModifier: '~',
            threshold: this.maxLen
          }
        });
        this.eventsSent++;
      } catch (error) {
        console.error('Error adding to Redis stream:', error);
      }
    });
  }

/**
 * Determine if we should process this BGP event
 */
shouldProcessEvent(bgpData) {
  // Must be an UPDATE message
  if (bgpData.type !== 'UPDATE') {
    return false;
  }
  
  // Must have basic required fields
  if (!bgpData.peer_asn || !bgpData.timestamp || !bgpData.host) {
    return false;
  }
  
  // Must have either announcements or withdrawals
  const hasAnnouncements = bgpData.announcements && bgpData.announcements.length > 0;
  const hasWithdrawals = bgpData.withdrawals && bgpData.withdrawals.length > 0;
  
  if (!hasAnnouncements && !hasWithdrawals) {
    return false;
  }
  
  // NEW: Track interesting events for future anomaly detection
  if (bgpData.announcements) {
    for (const announcement of bgpData.announcements) {
      const path = announcement.path || [];
      
      // Flag potential anomalies (don't filter yet, just prepare)
      const flags = {
        longPath: path.length > 7,  // Unusually long AS path
        shortPath: path.length === 1, // Direct announcement
        hasLoop: new Set(path).size !== path.length, // AS appears multiple times
        tier1Transit: this.containsTier1(path), // Goes through major backbone
        // We'll add RPKI validation here later
      };
      
      // For now, accept everything but store these flags
      // In Phase 2, we'll use these for anomaly detection
    }
  }
  
  return true; // Still accept everything for now
}

  containsTier1(path) {
    const TIER1_ASNS = [174, 209, 286, 701, 1239, 1299, 2828, 2914, 3257, 3320, 3356, 3491, 5511, 6453, 6461, 6762, 6830, 7018];
    return path.some(asn => TIER1_ASNS.includes(asn));
  }

  shouldThrottle(event) {
    const now = Date.now();
    const key = event.prefix;
    const last = this.prefixLastSeen.get(key);
    
    // First time seeing this prefix
    if (!last) {
      this.prefixLastSeen.set(key, {
        ts: now,
        pathHash: this.hashPath(event.as_path),
        type: event.event
      });
      return false; // Don't throttle
    }
    
    // Check if enough time has passed
    if (now - last.ts > this.THROTTLE_WINDOW_MS) {
      this.prefixLastSeen.set(key, {
        ts: now,
        pathHash: this.hashPath(event.as_path),
        type: event.event
      });
      return false; // Don't throttle
    }
    
    // EXEMPTION 1: Type changed (announce ↔ withdraw)
    if (event.event !== last.type) {
      this.typeFlips++;
      last.type = event.event;
      last.ts = now;
      return false; // Don't throttle - this is important!
    }
    
    // EXEMPTION 2: Path changed significantly
    const currentPathHash = this.hashPath(event.as_path);
    if (currentPathHash !== last.pathHash) {
      this.pathChanges++;
      last.pathHash = currentPathHash;
      last.ts = now;
      return false; // Don't throttle - potential anomaly!
    }
    
    // EXEMPTION 3: Long paths (potential path manipulation)
    if (event.as_path.length > 7) {
      return false; // Don't throttle suspicious paths
    }
    
    // Otherwise throttle this duplicate
    this.throttled++;
    return true;
  }
  
  hashPath(path) {
    // Simple hash for path comparison
    return path.join(',');
  }


  /**
   * Convert RIPE RIS Live format to our BGP arc format
   */
  convertRipeToArc(bgpData) {
    const events = [];
    const timestamp = bgpData.timestamp;
    
    // Debug: Log first few messages to understand structure
    if (this.eventsGenerated < 3) {
      console.log('🔍 DEBUG: BGP Data Structure:', JSON.stringify(bgpData, null, 2));
    }
    
    // Process announcements
    if (bgpData.announcements && bgpData.announcements.length > 0) {
      const path = bgpData.path || []; // AS path is at top level
      const peerAsn = bgpData.peer_asn; // The AS announcing this route
      
      // Get origin ASN from path (last ASN) or fallback to peer
      let originAsn = peerAsn;
      if (path.length > 0) {
        const lastPathElement = path[path.length - 1];
        originAsn = Array.isArray(lastPathElement) ? lastPathElement[0] : lastPathElement;
      }
      
      bgpData.announcements.forEach(announcement => {
        if (!announcement.prefixes || announcement.prefixes.length === 0) return;
        
        announcement.prefixes.forEach(prefix => {
          const srcLocation = getASNLocation(peerAsn) || { lat: 52.3676, lng: 4.9041 }; // Amsterdam fallback
          const dstLocation = getASNLocation(originAsn) || { lat: 40.7128, lng: -74.0060 }; // NYC fallback
          
          events.push({
            schema: 'bgp.arc.v0',
            ts: timestamp,
            event: 'announce',
            prefix: prefix,
            origin_asn: originAsn,
            peer_asn: peerAsn,
            as_path: path,
            // IMPORTANT: These locations will be peer → origin, not RRC → origin
            src: srcLocation,  // Where the announcement comes from
            dst: dstLocation, // Where the prefix belongs
            color: this.ANNOUNCE_COLOR,
            // Add metadata for future anomaly detection
            rrc: bgpData.host, // Keep for debugging, but don't visualize
            path_length: path.length,
            communities: announcement.communities || []
          });
        });
      });
    }
    
    // Process withdrawals similarly
    if (bgpData.withdrawals && bgpData.withdrawals.length > 0) {
      const peerAsn = bgpData.peer_asn;
      
      // Withdrawals are just an array of prefixes in RIPE format
      bgpData.withdrawals.forEach(prefix => {
        if (!prefix) return;
        
        const srcLocation = getASNLocation(peerAsn) || { lat: 52.3676, lng: 4.9041 }; // Amsterdam fallback
        
        events.push({
          schema: 'bgp.arc.v0',
          ts: timestamp,
          event: 'withdraw',
          prefix: prefix,
          origin_asn: null, // Unknown for withdrawals
          peer_asn: peerAsn,
          as_path: [],
          src: srcLocation,
          dst: { lat: 0, lng: 0 }, // Or use last known origin for this prefix
          color: this.WITHDRAW_COLOR,
          rrc: bgpData.host
        });
      });
    }
    
    return events;
  }

  /**
   * Get peer location based on RRC collector
   */
  getPeerLocation(bgpData) {
    if (bgpData.host && typeof bgpData.host === 'string') {
      // Extract RRC ID from host string (e.g., "rrc00" -> 0)
      const rrcMatch = bgpData.host.match(/rrc(\d+)/);
      if (rrcMatch) {
        const rrcId = parseInt(rrcMatch[1]);
        return getRRCLocation(rrcId);
      }
    }
    
    // Fallback to peer ASN location if we can't determine RRC
    return getASNLocation(bgpData.peer_asn);
  }

  /**
   * Schedule a reconnection attempt
   */
  scheduleReconnect() {
    if (this.isConnecting) return;
    
    console.log(`🔄 Reconnecting in ${this.reconnectInterval / 1000} seconds...`);
    setTimeout(() => {
      this.connect();
    }, this.reconnectInterval);
  }

  /**
   * Gracefully close the connection
   */
  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

module.exports = RipeClient;