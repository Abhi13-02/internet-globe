/**
 * Event Throttling Manager
 * Handles smart throttling of BGP events with exemptions for anomalies
 */

class ThrottleManager {
  constructor(windowMs = 500) {  // Reduced from 1000ms to 500ms for better duplicate detection
    this.THROTTLE_WINDOW_MS = windowMs;
    this.prefixLastSeen = new Map(); // prefix -> {ts, pathHash, type}
    
    // Metrics
    this.throttled = 0;
    this.pathChanges = 0;
    this.typeFlips = 0;
    this.tier1Filtered = 0;  // New metric for Tier 1 filtering
    
    // Tier 1 ASNs for anomaly detection
    this.TIER1_ASNS = new Set([174, 209, 286, 701, 1239, 1299, 2828, 2914, 3257, 3320, 3356, 3491, 5511, 6453, 6461, 6762, 6830, 7018]);
    
    // Configurable Tier 1 filtering
    this.enableTier1Filter = process.env.TIER1_FILTER_ENABLED === 'true';
    this.tier1FilterASNs = this.loadTier1FilterASNs();
    
    if (this.enableTier1Filter) {
      console.log(`🔧 Tier 1 filter ENABLED - showing only ${this.tier1FilterASNs.size} ASNs:`, Array.from(this.tier1FilterASNs).join(', '));
    } else {
      console.log('🔧 Tier 1 filter DISABLED - showing all ASNs');
    }
  }

  /**
   * Load Tier 1 filter ASNs from environment variable
   */
  loadTier1FilterASNs() {
    const defaultTier1ASNs = [
      174,   // Cogent
      209,   // Qwest (now CenturyLink)
      286,   // KPN
      701,   // Verizon
      1239,  // Sprint
      1299,  // Telia
      2828,  // XO (now Verizon)
      2914,  // NTT
      3257,  // GTT
      3320,  // Deutsche Telekom
      3356,  // Level3 (now Lumen)
      3491,  // PCCW
      5511,  // Opentransit
      6453,  // TATA
      6461,  // Zayo
      6762,  // Sparkle
      6830,  // Liberty Global
      7018   // AT&T
    ];
    
    if (process.env.TIER1_FILTER_ASNS) {
      const customASNs = process.env.TIER1_FILTER_ASNS.split(',').map(asn => parseInt(asn.trim()));
      console.log(`📋 Using custom Tier 1 ASNs from TIER1_FILTER_ASNS:`, customASNs);
      return new Set(customASNs);
    }
    
    return new Set(defaultTier1ASNs);
  }

  /**
   * Check if an event should be throttled
   */
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
    
    // EXEMPTION 4: Contains Tier 1 transit (important routing)
    if (this.containsTier1(event.as_path)) {
      return false; // Don't throttle major backbone routing
    }
    
    // Otherwise throttle this duplicate
    this.throttled++;
    return true;
  }

  /**
   * Check if event involves Tier 1 ASNs (for filtering)
   */
  involvesTier1ASNs(event) {
    // Check if peer ASN is in Tier 1 filter
    if (this.tier1FilterASNs.has(event.peer_asn)) {
      return true;
    }
    
    // Check if origin ASN is in Tier 1 filter
    if (event.origin_asn && this.tier1FilterASNs.has(event.origin_asn)) {
      return true;
    }
    
    // Check if any AS in path is in Tier 1 filter
    if (event.as_path && event.as_path.some(asn => this.tier1FilterASNs.has(asn))) {
      return true;
    }
    
    return false;
  }

  /**
   * Filter events through throttling logic first, then Tier 1 filtering
   */
  filterEvents(events) {
    // STEP 1: Apply throttling to ALL events first (to detect duplicates properly)
    const throttledEvents = events.filter(event => !this.shouldThrottle(event));
    
    // STEP 2: Then apply Tier 1 filtering if enabled
    let finalEvents = throttledEvents;
    
    if (this.enableTier1Filter) {
      finalEvents = throttledEvents.filter(event => {
        const isTier1 = this.involvesTier1ASNs(event);
        if (!isTier1) {
          this.tier1Filtered++;
        }
        return isTier1;
      });
    }
    
    return finalEvents;
  }

  /**
   * Simple hash for path comparison
   */
  hashPath(path) {
    return path.join(',');
  }

  /**
   * Check if path contains Tier 1 ASN (for anomaly detection)
   */
  containsTier1(path) {
    return path.some(asn => this.TIER1_ASNS.has(asn));
  }

  /**
   * Clean up old prefix entries for memory management
   */
  cleanup(maxAge = 60000) { // 1 minute default
    const cutoff = Date.now() - maxAge;
    for (const [prefix, data] of this.prefixLastSeen.entries()) {
      if (data.ts < cutoff) {
        this.prefixLastSeen.delete(prefix);
      }
    }
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      throttled: this.throttled,
      tier1Filtered: this.tier1Filtered,
      pathChanges: this.pathChanges,
      typeFlips: this.typeFlips,
      trackedPrefixes: this.prefixLastSeen.size,
      tier1FilterEnabled: this.enableTier1Filter,
      tier1FilterASNCount: this.tier1FilterASNs.size
    };
  }

  /**
   * Reset metrics (useful for periodic reporting)
   */
  resetMetrics() {
    this.throttled = 0;
    this.tier1Filtered = 0;
    this.pathChanges = 0;
    this.typeFlips = 0;
  }
}

module.exports = ThrottleManager;