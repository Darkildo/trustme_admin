import { cn } from "@/lib/utils";

/**
 * 24-bar uptime sparkline. Values are shares 0..1; -1 means "no data" and is drawn
 * as a short neutral tick. Bars below 100% switch to warn/fail tones.
 */
export function Sparkline({
  values,
  className,
  label,
}: {
  values: number[];
  className?: string;
  label: string;
}) {
  const n = Math.max(values.length, 1);
  const w = 120;
  const h = 28;
  const gap = 2;
  const bw = (w - gap * (n - 1)) / n;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cn("h-7 w-full", className)}
    >
      {values.map((v, i) => {
        const x = i * (bw + gap);
        if (v < 0) {
          return (
            <rect
              key={i}
              x={x}
              y={h - 2}
              width={bw}
              height={2}
              rx={0.5}
              className="fill-line-strong"
            />
          );
        }
        const bh = Math.max(3, v * (h - 2));
        const tone = v >= 0.99 ? "fill-ok" : v >= 0.9 ? "fill-warn" : "fill-fail";
        return (
          <rect
            key={i}
            x={x}
            y={h - bh}
            width={bw}
            height={bh}
            rx={0.75}
            className={cn(tone, v >= 0.99 ? "opacity-60" : "opacity-95")}
          />
        );
      })}
    </svg>
  );
}
