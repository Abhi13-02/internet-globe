"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import Tooltip from "@/components/Tooltip";
import type { TlsPoint } from "@/types/events";
import { MOCK_TLS } from "@/data/mock/tls";

// Dynamic import so SSR never touches WebGL/DOM
const Globe = dynamic(() => import("react-globe.gl"), { ssr: false });

export default function GlobeClient() {
  const globeRef = useRef<any>(null);
  const [selected, setSelected] = useState<TlsPoint | null>(null);
  const [hovered, setHovered] = useState<TlsPoint | null>(null);



  // Stable data reference to avoid unnecessary React re-renders inside the Globe
  const tlsPoints = useMemo<object[]>(
    () =>
      (MOCK_TLS as TlsPoint[]).map((p) => ({
        ...p,
        // ensure all accessors exist
        lat: p.lat,
        lng: p.lng,
        radius: p.radius ?? 1.2,
        color: p.color ?? "#ff5b5b",
      })),
    []
  );

  // One-time controls tuning after the globe is ready
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;

    // OrbitControls configuration
    const controls = g.controls() as OrbitControls | undefined;
    if (controls) {
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.rotateSpeed = 0.45;
      controls.minDistance = 160;
      controls.maxDistance = 700;
    }

    // Optional: Set an initial POV a bit away from the globe
    g.pointOfView({ altitude: 2.2 }, 0);
  }, []);

  const onPointClick = (p?: any) => {
    if (!p) return;
    if (globeRef.current && p?.lat != null && p?.lng != null) {
      globeRef.current.pointOfView(
        { lat: p.lat, lng: p.lng, altitude: 1.2 },
        1200
      );
    }

    setSelected((prev) =>
      prev && prev.domain === p.domain && prev.ts === p.ts
        ? null
        : (p as TlsPoint)
    );
    console.log("Clicked point:", p); // Debug log
  };

  const closeTooltip = () => setSelected(null);

  return (
    <div className="relative w-full h-full">
      {/* Globe takes the container size; ensure the parent gives it height */}
      <Globe
        ref={globeRef}
        backgroundColor="rgba(0,0,0,1)"
        showAtmosphere
        atmosphereColor="#3a99ff"
        atmosphereAltitude={0.18}
        globeImageUrl="https://unpkg.com/three-globe/example/img/earth-dark.jpg"
        bumpImageUrl="https://unpkg.com/three-globe/example/img/earth-topology.png"
        // ---- TLS POINTS LAYER ----
        pointsData={tlsPoints}
        pointLat="lat"
        pointLng="lng"
        pointRadius={(d: any) => d.radius}
        pointsMerge={false}
        onPointClick={onPointClick}
        pointResolution={12}
        pointAltitude={(d:any) => d === hovered ? 0.03 : 0.015}
        pointColor={(d:any) => d === hovered ? "#ffffff" : d.color}
      />

      {/* Simple overlay tooltip (anchored to screen corner for v1).
          If you want to anchor near the clicked point later, we can add a small proj-to-screen util. */}
      {selected && (
        <div className="absolute top-4 right-4 z-50">
          <Tooltip point={selected} onClose={closeTooltip} />
        </div>
      )}
    </div>
  );
}
