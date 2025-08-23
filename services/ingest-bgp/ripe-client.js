const WebSocket = require('ws');
const { initializeGeoLite2 } = require('./ans-geo');
const BgpProcessor = require('./bgp-processor');
const ThrottleManager = require('./throttle-manager');
const MetricsManager = require('./metrics-manager');

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

class RipeClient {
  constructor(redisClient, streamName, maxLen) {
    this.redis = redisClient;
    this.streamName = streamName;
    this.maxLen = maxLen;
    this.ws = null;
    this.reconnectInterval = 5000;
    this.isConnecting = false;
    
    // Initialize modules
    this.bgpProcessor = new BgpProcessor();
    this.throttleManager = new ThrottleManager(500); // 500ms throttle window for better duplicate detection
    this.metricsManager = new MetricsManager();
    
    // Initialize GeoLite2 databases
    this.initializeGeolocation();
    
    // Debug counter for initial messages
    this.debugMessageCount = 0;
  }

  /**
   * Initialize GeoLite2 databases for enhanced geolocation
   */
  async initializeGeolocation() {
    try {
      await initializeGeoLite2();
    } catch (err) {
      console.error('Failed to initialize geolocation:', err.message);
    }
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
        
        // Subscribe to BGP updates from multiple RRC collectors
        // Send separate subscription for each RRC (standard WebSocket pattern)
        console.log(`📡 Subscribing to ${rrcSet.length} RRC collectors...`);
        
        rrcSet.forEach((rrc, index) => {
          const subscription = {
            type: 'ris_subscribe',
            data: {
              host: rrc.trim(), // Each RRC as separate subscription
              type: 'UPDATE'
            }
          };
          
          // Send subscription with small delay to avoid overwhelming the server
          setTimeout(() => {
            this.ws.send(JSON.stringify(subscription));
            console.log(`✅ Subscribed to BGP updates from: ${rrc.trim()}`);
          }, index * 100); // 100ms delay between subscriptions
        });
        
        this.metricsManager.setSubscriptionTime();
        this.startMetricsLogging();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', (code) => {
        console.log(`❌ WebSocket closed with code: ${code}`);
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.error('❌ WebSocket error:', err.message);
        this.scheduleReconnect();
      });

    } catch (err) {
      console.error('❌ Connection failed:', err.message);
      this.scheduleReconnect();
    }
  }

  /**
   * Start metrics logging every 10 seconds
   */
  startMetricsLogging() {
    setInterval(() => {
      this.metricsManager.logMetrics(this.throttleManager);
      
      // Clean up old throttling data
      this.throttleManager.cleanup();
    }, 10000);
  }

  /**
   * Handle incoming WebSocket messages from RIPE
   */
  handleMessage(data) {
    const message = JSON.parse(data.toString());
    
    if (message.type !== 'ris_message') {
      if (message.type === 'ris_error') {
        console.log('❌ RIS Error:', JSON.stringify(message, null, 2));
      }
      return;
    }

    this.metricsManager.incrementMessagesReceived();
    
    const bgpData = message.data;
    
    if (!this.shouldProcessEvent(bgpData)) {
      return;
    }

    // STEP 1: Convert RIPE format to internal format (without geolocation)
    const shouldDebug = this.debugMessageCount < 3;
    if (shouldDebug) this.debugMessageCount++;
    
    const processedEvents = this.bgpProcessor.convertRipeToArcs(bgpData, shouldDebug);
    this.metricsManager.addEventsGenerated(processedEvents.length);
    
    // STEP 2: Apply throttling (this saves us from unnecessary geo lookups!)
    const eventsToSend = this.throttleManager.filterEvents(processedEvents);
    
    // STEP 3: Add geolocation only to events that passed throttling
    const finalEvents = this.bgpProcessor.addGeolocation(eventsToSend, this.metricsManager);
    
    // STEP 4: Send to Redis
    this.sendEventsToRedis(finalEvents);
  }

  /**
   * Send events to Redis stream
   */
  async sendEventsToRedis(events) {
    for (const event of events) {
      try {
        await this.redis.xAdd(this.streamName, '*', { data: JSON.stringify(event) }, {
          TRIM: {
            strategy: 'MAXLEN',
            strategyModifier: '~',
            threshold: this.maxLen
          }
        });
      } catch (err) {
        console.error('❌ Failed to send event to Redis:', err.message);
      }
    }
    
    this.metricsManager.addEventsSent(events.length);
  }

  /**
   * Filter events to only process important ones
   */
  shouldProcessEvent(bgpData) {
    // Only process from important ASNs for now (can be expanded)
    if (IMPORTANT_ASNS.has(bgpData.peer_asn)) {
      return true;
    }
    
    // Also process if any announcement involves important ASNs
    if (bgpData.announcements && bgpData.announcements.length > 0) {
      const path = bgpData.path || [];
      if (path.some(asn => IMPORTANT_ASNS.has(asn))) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Schedule a reconnection attempt
   */
  scheduleReconnect() {
    if (this.isConnecting) return;
    
    this.isConnecting = false;
    
    console.log(`🔄 Reconnecting in ${this.reconnectInterval / 1000} seconds...`);
    setTimeout(() => {
      this.connect();
    }, this.reconnectInterval);
  }

  /**
   * Close the WebSocket connection
   */
  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

module.exports = RipeClient;