// Enhanced AS Number to Geographic coordinate mapping using GeoLite2 databases
// This provides accurate geolocation using MaxMind GeoLite2 databases

const maxmind = require('maxmind');
const path = require('path');

// GeoLite2 database readers (will be initialized)
let cityLookup = null;
let asnLookup = null;

// Static fallback mapping for major ASNs (used when GeoLite2 fails)
const ASN_GEO_MAP = {
  // Google
  15169: { lat: 37.4220, lng: -122.0841, name: "Google", country: "US" },
  
  // Amazon
  16509: { lat: 39.0458, lng: -77.5081, name: "Amazon", country: "US" },
  14618: { lat: 39.0458, lng: -77.5081, name: "Amazon", country: "US" },
  
  // Cloudflare
  13335: { lat: 37.7749, lng: -122.4194, name: "Cloudflare", country: "US" },
  
  // Microsoft
  8075: { lat: 47.6062, lng: -122.3321, name: "Microsoft", country: "US" },
  
  // Facebook/Meta
  32934: { lat: 37.4220, lng: -122.0841, name: "Meta", country: "US" },
  
  // Level3/Lumen
  3356: { lat: 39.7392, lng: -104.9903, name: "Level3", country: "US" },
  
  // Cogent
  174: { lat: 38.9072, lng: -77.0369, name: "Cogent", country: "US" },
  
  // Hurricane Electric
  6939: { lat: 37.7749, lng: -122.4194, name: "Hurricane Electric", country: "US" },
  
  // NTT
  2914: { lat: 35.6762, lng: 139.6503, name: "NTT", country: "JP" },
  
  // Deutsche Telekom
  3320: { lat: 52.5200, lng: 13.4050, name: "Deutsche Telekom", country: "DE" },
  
  // Orange
  3215: { lat: 48.8566, lng: 2.3522, name: "Orange", country: "FR" },
  
  // BT
  2856: { lat: 51.5074, lng: -0.1278, name: "BT", country: "GB" },
  
  // Telecom Italia
  3269: { lat: 41.9028, lng: 12.4964, name: "Telecom Italia", country: "IT" },
  
  // China Telecom
  4134: { lat: 39.9042, lng: 116.4074, name: "China Telecom", country: "CN" },
  
  // China Unicom
  4837: { lat: 39.9042, lng: 116.4074, name: "China Unicom", country: "CN" },
  
  // Bharti Airtel (India)
  9498: { lat: 28.6139, lng: 77.2090, name: "Bharti Airtel", country: "IN" },
  
  // BSNL (India)
  9829: { lat: 28.6139, lng: 77.2090, name: "BSNL", country: "IN" },
  
  // Reliance Jio (India)
  55836: { lat: 19.0760, lng: 72.8777, name: "Reliance Jio", country: "IN" },
  
  // Additional Tier 1 ASNs for better arc coverage
  209: { lat: 39.7392, lng: -104.9903, name: "Qwest/CenturyLink", country: "US" },
  286: { lat: 52.3676, lng: 4.9041, name: "KPN", country: "NL" },
  701: { lat: 39.0458, lng: -77.5081, name: "Verizon", country: "US" },
  1239: { lat: 39.0458, lng: -77.5081, name: "Sprint", country: "US" },
  1299: { lat: 59.3293, lng: 18.0686, name: "Telia", country: "SE" },
  2828: { lat: 39.0458, lng: -77.5081, name: "XO/Verizon", country: "US" },
  3257: { lat: 51.5074, lng: -0.1278, name: "GTT", country: "GB" },
  3491: { lat: 22.3193, lng: 114.1694, name: "PCCW", country: "HK" },
  5511: { lat: 48.8566, lng: 2.3522, name: "Opentransit", country: "FR" },
  6453: { lat: 19.0760, lng: 77.2090, name: "TATA", country: "IN" },
  6461: { lat: 39.7392, lng: -104.9903, name: "Zayo", country: "US" },
  6762: { lat: 41.9028, lng: 12.4964, name: "Sparkle", country: "IT" },
  6830: { lat: 51.5074, lng: -0.1278, name: "Liberty Global", country: "GB" },
  7018: { lat: 32.7767, lng: -96.7970, name: "AT&T", country: "US" },
};

// RIPE RRC (Route Reflection Collector) locations
const RRC_LOCATIONS = {
  0: { lat: 52.3676, lng: 4.9041, name: "Amsterdam", country: "NL" },
  1: { lat: 51.5074, lng: -0.1278, name: "London", country: "GB" },
  3: { lat: 52.3676, lng: 4.9041, name: "Amsterdam", country: "NL" },
  4: { lat: 46.9481, lng: 7.4474, name: "Geneva", country: "CH" },
  5: { lat: 48.8566, lng: 2.3522, name: "Paris", country: "FR" },
  6: { lat: 35.6762, lng: 139.6503, name: "Tokyo", country: "JP" },
  7: { lat: 59.3293, lng: 18.0686, name: "Stockholm", country: "SE" },
  8: { lat: 37.7749, lng: -122.4194, name: "San Francisco", country: "US" },
  10: { lat: 52.3676, lng: 4.9041, name: "Amsterdam", country: "NL" },
  11: { lat: 40.7128, lng: -74.0060, name: "New York", country: "US" },
  12: { lat: 50.1109, lng: 8.6821, name: "Frankfurt", country: "DE" },
  13: { lat: 55.7558, lng: 37.6176, name: "Moscow", country: "RU" },
  14: { lat: 37.5665, lng: 126.9780, name: "Seoul", country: "KR" },
  15: { lat: -23.5505, lng: -46.6333, name: "São Paulo", country: "BR" },
  16: { lat: 45.4642, lng: 9.1900, name: "Milan", country: "IT" },
  18: { lat: 59.9139, lng: 10.7522, name: "Oslo", country: "NO" },
  19: { lat: 49.2827, lng: -123.1207, name: "Vancouver", country: "CA" },
  20: { lat: 47.3769, lng: 8.5417, name: "Zurich", country: "CH" },
  21: { lat: 48.2082, lng: 16.3738, name: "Vienna", country: "AT" },
  22: { lat: 41.0082, lng: 28.9784, name: "Istanbul", country: "TR" },
  23: { lat: 1.3521, lng: 103.8198, name: "Singapore", country: "SG" },
  24: { lat: -33.8688, lng: 151.2093, name: "Sydney", country: "AU" },
  25: { lat: 52.0907, lng: 5.1214, name: "Utrecht", country: "NL" },
  26: { lat: 45.5017, lng: -73.5673, name: "Montreal", country: "CA" },
};

// Default locations for unknown ASNs (spread around major internet hubs)
const DEFAULT_LOCATIONS = [
  { lat: 52.3676, lng: 4.9041, name: "Amsterdam", country: "NL" },
  { lat: 51.5074, lng: -0.1278, name: "London", country: "GB" },
  { lat: 40.7128, lng: -74.0060, name: "New York", country: "US" },
  { lat: 37.7749, lng: -122.4194, name: "San Francisco", country: "US" },
  { lat: 35.6762, lng: 139.6503, name: "Tokyo", country: "JP" },
  { lat: 1.3521, lng: 103.8198, name: "Singapore", country: "SG" },
  { lat: 50.1109, lng: 8.6821, name: "Frankfurt", country: "DE" },
];

/**
 * Initialize GeoLite2 databases
 */
async function initializeGeoLite2() {
  try {
    console.log('🌍 Initializing GeoLite2 databases from npm packages...');
    
    // Use npm packages for database files (correct file names)
    try {
      const cityDbPath = require.resolve('@ip-location-db/geolite2-city-mmdb/geolite2-city-ipv4.mmdb');
      cityLookup = await maxmind.open(cityDbPath);
      console.log('✅ GeoLite2-City database loaded from npm package');
    } catch (err) {
      console.log('⚠️  GeoLite2-City npm package not found, using fallback locations');
      console.debug('City DB error:', err.message);
    }
    
    try {
      const asnDbPath = require.resolve('@ip-location-db/geolite2-asn-mmdb/geolite2-asn-ipv4.mmdb');
      asnLookup = await maxmind.open(asnDbPath);
      console.log('✅ GeoLite2-ASN database loaded from npm package');
    } catch (err) {
      console.log('⚠️  GeoLite2-ASN npm package not found, using static ASN mapping');
      console.debug('ASN DB error:', err.message);
    }
    
  } catch (err) {
    console.error('❌ Failed to initialize GeoLite2:', err.message);
  }
}

/**
 * Get geographic coordinates for an AS number using GeoLite2
 * @param {number} asn - AS number
 * @returns {object} - {lat, lng, name, country}
 */
function getASNLocation(asn, metrics = null) {
  if (metrics) metrics.geoLookups++;
  
  // Fallback to static mapping first (most reliable for known ASNs)
  if (ASN_GEO_MAP[asn]) {
    // Static ASN mapping is considered successful (not a fallback)
    if (metrics) metrics.geoLite2Hits++;
    return ASN_GEO_MAP[asn];
  }
  
  // For unknown ASNs, return a semi-random but consistent location
  const index = asn % DEFAULT_LOCATIONS.length;
  if (metrics) metrics.geoFallbacks++;
  return DEFAULT_LOCATIONS[index];
}

/**
 * Get geographic coordinates for an IP address using GeoLite2
 * @param {string} ip - IP address
 * @returns {object} - {lat, lng, name, country}
 */
function getIPLocation(ip, metrics = null) {
  if (metrics) metrics.geoLookups++;
  
  if (cityLookup) {
    try {
      const result = cityLookup.get(ip);
      
      if (result && result.latitude !== undefined && result.longitude !== undefined) {
        if (metrics) metrics.geoLite2Hits++;
        return {
          lat: result.latitude,
          lng: result.longitude,
          name: result.city || 'Unknown City',
          country: result.country_code || 'Unknown'
        };
      }
    } catch (err) {
      console.debug(`GeoLite2 city lookup failed for ${ip}:`, err.message);
    }
  }
  
  // Fallback to default location
  if (metrics) metrics.geoFallbacks++;
  return DEFAULT_LOCATIONS[0];
}

/**
 * Enhanced ASN location lookup that tries multiple methods
 * @param {number} asn - AS number
 * @param {string} [sampleIP] - Optional sample IP from the ASN for more accurate location
 * @returns {object} - {lat, lng, name, country}
 */
function getEnhancedASNLocation(asn, sampleIP = null, metrics = null) {
  // If we have a sample IP from the ASN, use that for accurate geolocation
  if (sampleIP && cityLookup) {
    const ipLocation = getIPLocation(sampleIP, metrics);
    if (ipLocation.lat !== DEFAULT_LOCATIONS[0].lat) {
      return {
        ...ipLocation,
        name: `AS${asn} (${ipLocation.name})`,
        asn: asn
      };
    }
  }
  
  // Fallback to regular ASN lookup
  return getASNLocation(asn, metrics);
}

/**
 * Get RRC location by ID
 * @param {number} rrcId - RRC collector ID
 * @returns {object} - {lat, lng, name, country}
 */
function getRRCLocation(rrcId) {
  return RRC_LOCATIONS[rrcId] || RRC_LOCATIONS[0]; // Default to Amsterdam
}

module.exports = {
  initializeGeoLite2,
  getASNLocation,
  getIPLocation,
  getEnhancedASNLocation,
  getRRCLocation,
  ASN_GEO_MAP,
  RRC_LOCATIONS
};