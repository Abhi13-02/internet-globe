// src/types/events.ts

export type TlsPoint = {
  // position
  lat: number;
  lng: number;

  // identity
  domain: string;
  ip?: string | null;
  issuer?: string | null;

  // context
  sanCount?: number;        // number of SANs on the cert
  expiresInDays?: number;   // days until expiry (approx)
  org?: string | null;      // hosting org/ISP (e.g., Cloudflare)
  country?: string | null;  // 2-letter country (e.g., "US")
  ts: string;               // when we saw it (ISO)

  // optional future styling hooks
  color?: string;
  radius?: number;
};

// Room to grow later (BGP, Outages, etc.)
export type BgpEvent = {
  // TODO: as we add BGP
};

export type OutageEvent = {
  // TODO: as we add Outages
};
