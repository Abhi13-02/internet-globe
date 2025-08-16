// src/components/globe/Tooltip.tsx
"use client";

import type { TlsPoint } from "@/types/events";

type TooltipProps = {
  point: TlsPoint;
  onClose?: () => void;
  className?: string;
};

export default function Tooltip({ point, onClose, className = "" }: TooltipProps) {
  const {
    domain,
    ip,
    issuer,
    sanCount,
    expiresInDays,
    org,
    country,
    ts
  } = point;

  return (
    <div
      className={[
        "pointer-events-auto rounded-xl border border-white/10 bg-white/10 backdrop-blur px-4 py-3 shadow-lg",
        "text-sm text-white",
        "max-w-xs",
        className
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-[15px] leading-tight">
            {domain}
          </div>
          <div className="text-white/80 text-xs">{ip ?? "—"}</div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto -mr-1 rounded-md px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        <Info label="Issuer" value={issuer ?? "—"} />
        <Info label="Seen" value={new Date(ts).toLocaleTimeString()} />
        <Info label="SANs" value={sanCount?.toString() ?? "—"} />
        <Info label="Expires" value={expiresInDays != null ? `${expiresInDays} days` : "—"} />
        <Info label="Org" value={org ?? "—"} />
        <Info label="Country" value={country ?? "—"} />
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-white/60">
        {label}
      </span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
