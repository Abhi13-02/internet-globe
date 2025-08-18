// src/components/GlobeClient.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import Tooltip from "@/components/Tooltip";
import type { TlsPoint } from "@/types/events";

// Types from react-globe.gl
import type { GlobeMethods } from "react-globe.gl";

// SSR-safe globe
const Globe = dynamic(() => import("react-globe.gl"), { ssr: false });

export default function GlobeClient() {
  const globeRef = useRef<GlobeMethods | null>(null);

  const [points, setPoints] = useState<TlsPoint[]>([]);
  const [selected, setSelected] = useState<TlsPoint | null>(null);
  const [hovered, setHovered] = useState<TlsPoint | null>(null);

  // Normalize any WS payload to TlsPoint[]
  const normalize = (msg: any): TlsPoint[] => {
    const arr = Array.isArray(msg) ? msg : Array.isArray(msg?.items) ? msg.items : msg ? [msg] : [];
    return arr
      .filter(Boolean)
      .map((p: any) => ({
        lat: Number(p.lat),
        lng: Number(p.lng),
        domain: String(p.domain ?? "unknown"),
        ip: String(p.ip ?? ""),
        ts: p.ts, // epoch seconds or ISO
        color: p.color ?? "#ff5b5b",
        radius: p.radius ?? 0.9,
        issuer: p.issuer,
        sanCount: p.sanCount,
        expiresInDays: p.expiresInDays,
        org: p.org,
        country: p.country
      }));
  };

  // Connect to gateway WebSocket and accumulate points
  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8000/ws/live");
    ws.onopen = () => console.log("✅ WebSocket connected");
    ws.onmessage = (e) => {
      try {
        const batch = normalize(JSON.parse(e.data));
        if (batch.length) setPoints((prev) => [...prev, ...batch].slice(-2000));
      } catch (err) {
        console.error("Bad WS message:", err);
      }
    };
    ws.onerror = (e) => console.error("❌ WS error", e);
    return () => ws.close();
  }, []);

  // Tweak OrbitControls and initial POV
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;

    const controls = g.controls() as OrbitControls | undefined;
    if (controls) {
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.rotateSpeed = 0.45;
      controls.minDistance = 160;
      controls.maxDistance = 700;
    }
    g.pointOfView({ altitude: 2.2 }, 0);
  }, []);

  const onPointClick = (p?: any) => {
    if (!p) return;
    const d = p as TlsPoint;

    if (globeRef.current && d.lat != null && d.lng != null) {
      globeRef.current.pointOfView({ lat: d.lat, lng: d.lng, altitude: 1.2 }, 1200);
    }
    setSelected((prev) => (prev && prev.domain === d.domain && prev.ts === d.ts ? null : d));
  };

  return (
    <div className="relative w-full h-full">
      <Globe
        ref={globeRef as any} // react-globe.gl expects a mutable ref to GlobeMethods
        backgroundColor="rgba(0,0,0,1)"
        showAtmosphere
        atmosphereColor="#3a99ff"
        atmosphereAltitude={0.18}
        globeImageUrl="https://unpkg.com/three-globe/example/img/earth-dark.jpg"
        bumpImageUrl="https://unpkg.com/three-globe/example/img/earth-topology.png"

        // Live TLS points
        pointsData={points}
        pointLat="lat"
        pointLng="lng"
        pointRadius={(d: any) => d.radius ?? 0.9}                 // accessor (obj:any)=>number
        pointAltitude={(d: any) => (hovered && d === hovered ? 0.03 : 0.015)}
        pointColor={(d: any) => (hovered && d === hovered ? "#ffffff" : d.color ?? "#ff5b5b")}
        pointsMerge={false}
        pointResolution={12}

        // Handlers — match library signatures
        onPointClick={(p: object) => onPointClick(p)}
        onPointHover={(p?: object | null) => setHovered((p as TlsPoint) ?? null)}
      />

      {selected && (
        <div className="absolute top-4 right-4 z-50">
          <Tooltip point={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  );
}
