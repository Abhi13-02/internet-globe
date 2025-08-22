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
        ris_messages: this.messagesReceived,
        events_generated: this.eventsGenerated,
        events_sent: this.eventsSent,
        avg_messages_per_sec: Math.floor(this.messagesReceived / Math.max(uptime, 1)),
        avg_events_per_sec: Math.floor(this.eventsSent / Math.max(uptime, 1)),
        expansion_rate: `${(this.eventsGenerated / Math.max(this.messagesReceived, 1)).toFixed(1)}x`
      });
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
    
    // Send each event to Redis
    processedEvents.forEach(async (arc) => {
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
  
  // For now, accept everything that passes basic validation
  // We'll add smart filtering in Step B
  return true;
}


  /**
   * Convert RIPE RIS Live format to our BGP arc format
   */
  convertRipeToArc(bgpData) {
    const arcs = [];
    
    // Debug: log first few events to understand the structure
    if (this.filteredCount < 3) {
      console.log('🔍 Debug BGP data:', JSON.stringify(bgpData, null, 2));
      console.log('✅ Event passed shouldProcessEvent filter');
    }
    
    // Determine event type and color based on RIPE format
    const hasAnnouncements = bgpData.announcements && bgpData.announcements.length > 0;
    const hasWithdrawals = bgpData.withdrawals && bgpData.withdrawals.length > 0;
    const event = hasAnnouncements ? 'announce' : 'withdraw';
    const color = event === 'announce' ? this.ANNOUNCE_COLOR : this.WITHDRAW_COLOR;
    
    // Extract origin ASN from path (last ASN in the path)
    let originASN = parseInt(bgpData.peer_asn); // fallback
    if (bgpData.path && bgpData.path.length > 0) {
      const lastPathElement = bgpData.path[bgpData.path.length - 1];
      originASN = Array.isArray(lastPathElement) ? lastPathElement[0] : lastPathElement;
    }
    
    // Get geographic locations
    const peerLocation = this.getPeerLocation(bgpData);
    const originLocation = getASNLocation(originASN);
    
    // Debug: log location mapping
    if (this.filteredCount < 3) {
      console.log('🌍 Peer location:', peerLocation);
      console.log('🌍 Origin location:', originLocation);
    }
    
    // Use fallback locations if we can't find specific ones
    const finalPeerLocation = peerLocation || { lat: 52.3676, lng: 4.9041 }; // Amsterdam default
    const finalOriginLocation = originLocation || { lat: 40.7128, lng: -74.0060 }; // NYC default
    
    // Debug: show final locations
    if (this.filteredCount < 3) {
      console.log('🌍 Final peer location:', finalPeerLocation);
      console.log('🌍 Final origin location:', finalOriginLocation);
    }
    
    // Skip only if we still don't have valid locations
    if (!finalPeerLocation || !finalOriginLocation ||
        !finalPeerLocation.lat || !finalPeerLocation.lng || 
        !finalOriginLocation.lat || !finalOriginLocation.lng) {
      if (this.filteredCount < 3) {
        console.log('❌ Skipping event due to invalid location data');
      }
      return arcs;
    }
    
    // Handle RIPE format - extract prefixes from announcements and withdrawals
    let prefixes = [];
    
    // Add announced prefixes
    if (bgpData.announcements && bgpData.announcements.length > 0) {
      bgpData.announcements.forEach(announcement => {
        if (announcement.prefixes) {
          prefixes = prefixes.concat(announcement.prefixes);
        }
      });
    }
    
    // Add withdrawn prefixes 
    if (bgpData.withdrawals && bgpData.withdrawals.length > 0) {
      prefixes = prefixes.concat(bgpData.withdrawals);
    }
    
    // If no prefixes found, skip this event
    if (prefixes.length === 0) {
      return arcs;
    }
    
    prefixes.forEach(prefix => {
      if (!prefix) return;
      
      const arc = {
        schema: 'bgp.arc.v0',
        ts: bgpData.timestamp || (Date.now() / 1000),
        event: event,
        prefix: prefix,
        origin_asn: originASN,
        peer_asn: parseInt(bgpData.peer_asn),
        as_path: bgpData.path || [bgpData.peer_asn, originASN],
        src: { 
          lat: finalPeerLocation.lat, 
          lng: finalPeerLocation.lng 
        },
        dst: { 
          lat: finalOriginLocation.lat, 
          lng: finalOriginLocation.lng 
        },
        color: color,
        // Additional metadata for debugging/enrichment
        rrc: bgpData.host || 'unknown',
        raw_type: bgpData.type
      };
      
      arcs.push(arc);
    });
    
    return arcs;
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