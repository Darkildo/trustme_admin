import { TONE_CLASSES } from "@/lib/tone";
import type { Tone } from "@/lib/status";
import { cn } from "@/lib/utils";

/** Pulsing "live" indicator. The ring animation is disabled under prefers-reduced-motion. */
export function LiveDot({ tone = "ok", className }: { tone?: Tone; className?: string }) {
  const fill = TONE_CLASSES[tone].fill;
  return (
    <span className={cn("relative inline-flex size-2.5", className)} aria-hidden>
      <span className={cn("absolute inset-0 rounded-full animate-pulse-ring", fill)} />
      <span className={cn("relative inline-flex size-2.5 rounded-full", fill)} />
    </span>
  );
}
