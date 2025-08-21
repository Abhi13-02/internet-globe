"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { GlobeMethods } from "react-globe.gl";
import { BgpArcV0 } from "@/types/events";

const Globe = dynamic(() => import("react-globe.gl"), { ssr: false });

export default function GlobeClient() {
  const globeRef = useRef<GlobeMethods | null>(null);
  const [arcs, setArcs] = useState<(BgpArcV0 & { _arrived: number })[]>([]);

  const TTL_MS = 1000; // 1 seconds

  // WebSocket + TTL
  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8000/ws/live");
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "bgp" && Array.isArray(msg.items)) {
          setArcs((prev) => {
            const now = Date.now() / 1000; // seconds
            const cutoff = now - TTL_MS / 1000;
            const afterCutoff = prev.filter((a) => a._arrived >= cutoff);
            const fresh = msg.items.map((d: any) => ({ ...d, _arrived: now }));
            return [...afterCutoff, ...fresh];
          });
          console.log("WebSocket message received:", msg.items);
        }
      } catch (err) {
        console.error("WS parse error:", err);
      }
    };
    ws.onerror = (e) => console.error("❌ WS error", e);
    return () => ws.close();
  }, []);

  // Controls + POV
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

  // Helper: fade arcs by age
  const getAge = (d: any) => {
    const age = Date.now() / 1000 - (d._arrived ?? 0);
    return age;
  };

  return (
    <div className="w-full h-full">
      <Globe
        ref={globeRef as any}
        globeImageUrl="https://unpkg.com/three-globe/example/img/earth-dark.jpg"
        arcsData={arcs}
        arcStartLat={(d: any) => d.src.lat}
        arcStartLng={(d: any) => d.src.lng}
        arcEndLat={(d: any) => d.dst.lat}
        arcEndLng={(d: any) => d.dst.lng}
        arcColor={(d: any) => {
          const age = getAge(d);
          if (age < 10) return d.color; // fresh = bright
          if (age < 20) return "rgba(200,200,200,0.7)";
          return "rgba(150,150,150,0.3)"; // near expiry = faded
        }}
        arcAltitude={(d: any) => {
          const age = getAge(d);
          if (age < 10) return 0.3;
          if (age < 20) return 0.15;
          return 0.05;
        }}
        arcStroke={0.7}
        arcDashLength={0.4}
        arcDashGap={0.2}
        arcDashAnimateTime={1500}
      />
    </div>
  );
}
