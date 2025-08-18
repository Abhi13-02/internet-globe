// src/data/mock/tls.ts
import type { TlsPoint } from "@/types/events";

export const MOCK_TLS: TlsPoint[] = [
  {
    lat: 37.7749,
    lng: -122.4194,
    domain: "api.example.com",
    ip: "93.184.216.34",
    issuer: "Let's Encrypt",
    sanCount: 3,
    expiresInDays: 72,
    org: "Cloudflare",
    country: "US",
    ts: new Date().toISOString(),
    color: "#ff5b5b",
    radius: 0.9
  },
  {
    lat: 51.5074,
    lng: -0.1278,
    domain: "login.coolsite.io",
    ip: "203.0.113.18",
    issuer: "DigiCert",
    sanCount: 2,
    expiresInDays: 120,
    org: "Akamai",
    country: "GB",
    ts: new Date(Date.now() - 60_000).toISOString(),
    color: "#ff5b5b",
    radius: 0.9
  },
  {
    lat: 28.6139,
    lng: 77.2090,
    domain: "shop.indsite.in",
    ip: "198.51.100.7",
    issuer: "GlobalSign",
    sanCount: 4,
    expiresInDays: 45,
    org: "AWS",
    country: "IN",
    ts: new Date(Date.now() - 120_000).toISOString(),
    color: "#ff5b5b",
    radius: 0.9
  }
];

// Optional helper for demos/tests
export function generateMockTls(count = 20): TlsPoint[] {
  const issuers = ["Let's Encrypt", "DigiCert", "GlobalSign", "Sectigo"];
  const orgs = ["Cloudflare", "AWS", "Akamai", "GCP"];
  const countries = ["US", "GB", "DE", "IN", "SG", "JP"];

  return Array.from({ length: count }, (_, i) => {
    const lat = (Math.random() - 0.5) * 180;
    const lng = (Math.random() - 0.5) * 360;
    return {
      lat,
      lng,
      domain: `demo${i}.example.org`,
      ip: `198.51.100.${(i % 250) + 1}`,
      issuer: issuers[i % issuers.length],
      sanCount: (i % 5) + 1,
      expiresInDays: 30 + (i % 180),
      org: orgs[i % orgs.length],
      country: countries[i % countries.length],
      ts: new Date(Date.now() - i * 15_000).toISOString(),
      color: "#ff5b5b",
      radius: 0.9
    };
  });
}
