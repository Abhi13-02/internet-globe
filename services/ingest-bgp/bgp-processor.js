/**
 * BGP Data Processing Module
 * Handles conversion from RIPE format to internal arc format
 */

class BgpProcessor {
  constructor() {
    // Color configuration
    this.ANNOUNCE_COLOR = '#3aa3ff';
    this.WITHDRAW_COLOR = '#ff8a3a';
  }

  /**
   * Convert RIPE BGP data to internal arc events (without geolocation)
   * Geolocation will be added later after throttling
   */
  convertRipeToArcs(bgpData, debugLog = false) {
    const events = [];
    const timestamp = bgpData.timestamp;
    
    // Debug: Log first few messages to understand structure
    if (debugLog) {
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
          // Extract potential IP for later geolocation
          const ipMatch = prefix.match(/^([0-9.]+)/);
          const sampleIP = ipMatch ? ipMatch[1] : null;
          
          events.push({
            schema: 'bgp.arc.v0',
            ts: timestamp,
            event: 'announce',
            prefix: prefix,
            origin_asn: originAsn,
            peer_asn: peerAsn,
            as_path: path,
            sample_ip: sampleIP, // Store for later geolocation
            color: this.ANNOUNCE_COLOR,
            // Metadata for future anomaly detection
            rrc: bgpData.host,
            path_length: path.length,
            communities: announcement.communities || []
          });
        });
      });
    }
    
    // Process withdrawals
    if (bgpData.withdrawals && bgpData.withdrawals.length > 0) {
      const peerAsn = bgpData.peer_asn;
      
      bgpData.withdrawals.forEach(prefix => {
        if (!prefix) return;
        
        // Extract potential IP for later geolocation
        const ipMatch = prefix.match(/^([0-9.]+)/);
        const sampleIP = ipMatch ? ipMatch[1] : null;
        
        events.push({
          schema: 'bgp.arc.v0',
          ts: timestamp,
          event: 'withdraw',
          prefix: prefix,
          origin_asn: null, // Unknown for withdrawals
          peer_asn: peerAsn,
          as_path: [],
          sample_ip: sampleIP, // Store for later geolocation
          color: this.WITHDRAW_COLOR,
          rrc: bgpData.host
        });
      });
    }
    
    return events;
  }

  /**
   * Add geolocation data to events (called after throttling)
   */
  addGeolocation(events, metrics = null) {
    const { getEnhancedASNLocation, getASNLocation } = require('./ans-geo');
    
    return events.map(event => {
      let srcLocation, dstLocation;
      
      try {
        // CRITICAL FIX: Don't use IP-based geolocation for ASNs - it gives wrong locations!
        // The sample IP tells us where the PREFIX is, not where the ASN company is located
        // Use static ASN locations for proper peer->origin arcs
        
        srcLocation = getASNLocation(event.peer_asn, metrics) || 
                     { lat: 52.3676, lng: 4.9041 }; // Amsterdam fallback
        
        if (event.event === 'announce' && event.origin_asn) {
          dstLocation = getASNLocation(event.origin_asn, metrics) || 
                       { lat: 40.7128, lng: -74.0060 }; // NYC fallback
        } else {
          dstLocation = { lat: 0, lng: 0 }; // Withdrawals or unknown origin
        }
        
      } catch (err) {
        // Fallback to basic ASN location on any error
        srcLocation = getASNLocation(event.peer_asn, metrics) || { lat: 52.3676, lng: 4.9041 };
        dstLocation = event.event === 'announce' && event.origin_asn ? 
          getASNLocation(event.origin_asn, metrics) || { lat: 40.7128, lng: -74.0060 } : 
          { lat: 0, lng: 0 };
      }
      
      // Remove sample_ip and add final locations
      const { sample_ip, ...eventWithoutSampleIP } = event;
      const finalEvent = {
        ...eventWithoutSampleIP,
        src: srcLocation,
        dst: dstLocation
      };
      
      
      return finalEvent;
    });
  }
}

module.exports = BgpProcessor;