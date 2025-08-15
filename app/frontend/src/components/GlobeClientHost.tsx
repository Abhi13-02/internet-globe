"use client";

import dynamic from "next/dynamic";

// Load your existing GlobeClient only on the client
const GlobeClient = dynamic(() => import("@/components/GlobeClient"), {
  ssr: false
});

export default function GlobeClientHost() {
  return <GlobeClient />;
}
