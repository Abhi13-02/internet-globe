/**
 * Metrics Manager
 * Centralized metrics tracking and reporting
 */

class MetricsManager {
  constructor() {
    // Core metrics
    this.messagesReceived = 0;  // RIS messages
    this.eventsGenerated = 0;   // Individual prefix events
    this.eventsSent = 0;        // Events sent to Redis
    this.subscriptionTime = Date.now(); // Initialize to now
    
    // Geolocation metrics
    this.geoLookups = 0;        // Total geolocation lookups
    this.geoLite2Hits = 0;      // Successful GeoLite2 lookups
    this.geoFallbacks = 0;      // Fallback location usage
    
    this.startTime = Date.now();
  }

  /**
   * Start periodic metrics logging
   */
  startLogging(intervalMs = 10000) {
    setInterval(() => {
      this.logMetrics();
    }, intervalMs);
  }

  /**
   * Log comprehensive metrics
   */
  logMetrics(throttleManager = null) {
    const uptime = Math.floor((Date.now() - this.subscriptionTime) / 1000);
    
    // Calculate GeoLite2 success rate
    const geoSuccessRate = this.geoLookups > 0 ? 
      `${((this.geoLite2Hits / this.geoLookups) * 100).toFixed(1)}%` : '0%';
    
    // Get throttling metrics if available
    const throttleMetrics = throttleManager ? throttleManager.getMetrics() : {};
    
    const metrics = {
      // Input metrics
      ris_messages: this.messagesReceived,
      ris_msg_per_sec: Math.floor(this.messagesReceived / Math.max(uptime, 1)),
      events_generated: this.eventsGenerated,
      
      // Filtering metrics  
      events_sent: this.eventsSent,
      events_throttled: throttleMetrics.throttled || 0,
      
      // Tier 1 filtering metrics
      ...(throttleMetrics.tier1FilterEnabled && {
        tier1_filter: '🎯 ENABLED',
        tier1_asn_count: throttleMetrics.tier1FilterASNCount || 0,
        tier1_filtered: throttleMetrics.tier1Filtered || 0
      }),
      
      // Geolocation metrics
      geolite2_success_rate: geoSuccessRate,
      geo_lookups: this.geoLookups,
      geo_fallbacks: this.geoFallbacks,
      
      // Quality metrics
      path_changes_preserved: throttleMetrics.pathChanges || 0,
      type_flips_preserved: throttleMetrics.typeFlips || 0,
      
      // Rates
      avg_events_in: Math.floor(this.eventsGenerated / Math.max(uptime, 1)),
      avg_events_out: Math.floor(this.eventsSent / Math.max(uptime, 1)),
      
      // Effectiveness
      reduction_rate: `${((1 - this.eventsSent / Math.max(this.eventsGenerated, 1)) * 100).toFixed(1)}%`,
      
      // Health check
      quality_check: (throttleMetrics.pathChanges || 0) > 0 && (throttleMetrics.typeFlips || 0) > 0 ? '✅' : '⚠️'
    };

    console.log(`📊 Metrics [${uptime}s]:`, metrics);
    
    return metrics;
  }

  /**
   * Increment message received counter
   */
  incrementMessagesReceived() {
    this.messagesReceived++;
  }

  /**
   * Add to events generated count
   */
  addEventsGenerated(count) {
    this.eventsGenerated += count;
  }

  /**
   * Add to events sent count
   */
  addEventsSent(count) {
    this.eventsSent += count;
  }

  /**
   * Set subscription start time
   */
  setSubscriptionTime(timestamp = Date.now()) {
    this.subscriptionTime = timestamp;
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot() {
    const uptime = Math.floor((Date.now() - this.subscriptionTime) / 1000);
    return {
      messagesReceived: this.messagesReceived,
      eventsGenerated: this.eventsGenerated,
      eventsSent: this.eventsSent,
      geoLookups: this.geoLookups,
      geoLite2Hits: this.geoLite2Hits,
      geoFallbacks: this.geoFallbacks,
      uptime: uptime
    };
  }
}

module.exports = MetricsManager;