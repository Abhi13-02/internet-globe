// src/types/events.ts

export type TlsPoint = {
  lat: number;
  lng: number;
  domain: string;
  ip: string;
  ts: number | string;   // ingest gives epoch seconds (number)
  // optional/enrichment
  issuer?: string;
  sanCount?: number;
  expiresInDays?: number;
  org?: string;
  country?: string;
  color?: string;   // default in UI
  radius?: number;  // default in UI
};

export type BgpArcV0 = {
  schema: "bgp.arc.v0";
  ts: number;
  event: "announce" | "withdraw";
  prefix: string;
  origin_asn: number;
  peer_asn: number;
  as_path: number[];
  src: { lat: number; lng: number };
  dst: { lat: number; lng: number };
  color: string;
};


// Room to grow later (BGP, Outages, etc.)
export type BgpEvent = {
  // TODO: as we add BGP
};

export type OutageEvent = {
  // TODO: as we add Outages
};
