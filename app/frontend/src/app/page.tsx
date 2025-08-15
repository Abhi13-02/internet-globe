export default function Page() {
  // import inside the component to keep this file a Server Component
  const GlobeClientHost = require("@/components/GlobeClientHost").default;
  return (
    <main className="w-screen h-screen overflow-hidden">
      <GlobeClientHost />
    </main>
  );
}
