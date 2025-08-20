// BGP
{
  "schema": "bgp.arc.v0",
  "ts": 1755547893.71,
  "event": "announce",           // "announce" | "withdraw"
  "prefix": "2600:6c7f:9370::/44",
  "origin_asn": 19115,
  "peer_asn": 13030,
  "as_path": [13030, 6939, 7843, 11426, 19115],
  "src": { "lat": 52.37, "lng": 4.90 },    // peer/RRC location (mocked now)
  "dst": { "lat": 37.77, "lng": -122.42 }, // origin ASN centroid (mocked now)
  "color": "#3aa3ff"                        // announce=blue, withdraw=orange
}
