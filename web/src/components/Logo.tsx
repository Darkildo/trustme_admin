import * as React from "react";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  const id = React.useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <defs>
        <linearGradient id={`lg-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="[stop-color:var(--tm-accent)]" />
          <stop offset="1" className="[stop-color:var(--tm-accent-2)]" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" className="fill-surface-2" />
      <path
        d="M16 5l9 3.5v6.8c0 5.6-3.8 9.9-9 11.7-5.2-1.8-9-6.1-9-11.7V8.5L16 5z"
        fill="none"
        stroke={`url(#lg-${id})`}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M11.5 16l3 3 6-6.5"
        fill="none"
        stroke={`url(#lg-${id})`}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      {!collapsed && (
        <span className="text-[15px] font-semibold tracking-tight text-fg">
          TrustMe <span className="text-gradient">Admin</span>
        </span>
      )}
    </span>
  );
}
