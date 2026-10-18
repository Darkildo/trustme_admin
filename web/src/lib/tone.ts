import type { Tone } from "./status";

/** Literal utility classes per tone (kept literal so Tailwind can see them). */
export const TONE_CLASSES: Record<
  Tone,
  { text: string; bg: string; border: string; fill: string }
> = {
  ok: { text: "text-ok", bg: "bg-ok-soft", border: "border-ok/30", fill: "bg-ok" },
  warn: { text: "text-warn", bg: "bg-warn-soft", border: "border-warn/30", fill: "bg-warn" },
  fail: { text: "text-fail", bg: "bg-fail-soft", border: "border-fail/35", fill: "bg-fail" },
  stale: { text: "text-stale", bg: "bg-stale-soft", border: "border-stale/30", fill: "bg-stale" },
  unknown: {
    text: "text-unknown",
    bg: "bg-unknown-soft",
    border: "border-unknown/30",
    fill: "bg-unknown",
  },
  skip: { text: "text-skip", bg: "bg-skip-soft", border: "border-skip/30", fill: "bg-skip" },
};
