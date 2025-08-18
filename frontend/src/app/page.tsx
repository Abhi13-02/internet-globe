// src/app/page.tsx
"use client";

import GlobeClient from "@/components/GlobeClient";

export default function HomePage() {
  return (
    <main className="h-screen w-screen overflow-hidden">
      <GlobeClient />
    </main>
  );
}
