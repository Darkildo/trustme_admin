import type { LucideIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  text?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

/** Gradient network illustration with an icon in the centre. Colours come from tokens. */
function Illustration({ icon: Icon, compact }: { icon: LucideIcon; compact?: boolean }) {
  const id = React.useId().replace(/:/g, "");
  const size = compact ? 120 : 168;
  return (
    <div className="relative" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 168 168" width={size} height={size} className="absolute inset-0">
        <defs>
          <linearGradient id={`g-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className="[stop-color:var(--tm-accent)]" />
            <stop offset="1" className="[stop-color:var(--tm-accent-2)]" />
          </linearGradient>
          <radialGradient id={`r-${id}`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" className="[stop-color:var(--tm-accent)] [stop-opacity:0.28]" />
            <stop offset="1" className="[stop-color:var(--tm-accent-2)] [stop-opacity:0]" />
          </radialGradient>
        </defs>
        <circle cx="84" cy="84" r="80" fill={`url(#r-${id})`} />
        <circle
          cx="84"
          cy="84"
          r="62"
          fill="none"
          stroke={`url(#g-${id})`}
          strokeOpacity="0.35"
          strokeDasharray="2 6"
        />
        <circle cx="84" cy="84" r="42" fill="none" stroke={`url(#g-${id})`} strokeOpacity="0.5" />
        {[
          [84, 22],
          [138, 66],
          [120, 134],
          [42, 140],
          [26, 64],
        ].map(([x, y], i) => (
          <g key={i}>
            <line x1="84" y1="84" x2={x} y2={y} stroke={`url(#g-${id})`} strokeOpacity="0.25" />
            <circle cx={x} cy={y} r={i % 2 ? 4 : 5.5} fill={`url(#g-${id})`} fillOpacity={0.85} />
          </g>
        ))}
        <rect
          x="58"
          y="58"
          width="52"
          height="52"
          rx="14"
          className="fill-surface-2"
          stroke={`url(#g-${id})`}
          strokeWidth="1.5"
        />
      </svg>
      <Icon
        className="absolute top-1/2 left-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-accent"
        strokeWidth={1.75}
      />
    </div>
  );
}

export function EmptyState({ icon, title, text, action, className, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-line-strong bg-gradient-soft text-center",
        compact ? "gap-3 px-6 py-8" : "gap-4 px-6 py-14",
        className,
      )}
    >
      <Illustration icon={icon} compact={compact} />
      <div className="flex max-w-md flex-col gap-1.5">
        <h3 className="text-base font-semibold tracking-tight text-fg">{title}</h3>
        {text && <p className="text-sm text-fg-muted">{text}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
