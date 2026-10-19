import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatDateTime, formatPercent } from "@/lib/format";
import type { Probe } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_SEGMENTS = 96;

interface Segment {
  from: number;
  to: number;
  ok: number;
  total: number;
}

/**
 * Availability strip: one segment per probe, or per time bucket when there are more
 * probes than fit (green = all ok, red = all failed, amber = mixed, empty = no data).
 */
export function AvailabilityStrip({
  probes,
  since,
  until,
}: {
  probes: Probe[];
  since: number;
  until: number;
}) {
  const { t, i18n } = useTranslation();
  const segments = useMemo<Segment[]>(() => {
    if (probes.length <= MAX_SEGMENTS) {
      return probes.map((p) => ({ from: p.at, to: p.at, ok: p.ok ? 1 : 0, total: 1 }));
    }
    const span = Math.max(1, until - since);
    const buckets: Segment[] = Array.from({ length: MAX_SEGMENTS }, (_, i) => ({
      from: Math.floor(since + (span * i) / MAX_SEGMENTS),
      to: Math.floor(since + (span * (i + 1)) / MAX_SEGMENTS),
      ok: 0,
      total: 0,
    }));
    for (const p of probes) {
      const idx = Math.min(
        MAX_SEGMENTS - 1,
        Math.max(0, Math.floor(((p.at - since) / span) * MAX_SEGMENTS)),
      );
      const b = buckets[idx]!;
      b.total++;
      if (p.ok) b.ok++;
    }
    return buckets;
  }, [probes, since, until]);

  const okTotal = probes.filter((p) => p.ok).length;
  const share = probes.length ? okTotal / probes.length : null;

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex h-8 min-w-0 items-stretch gap-px sm:gap-[2px]"
        role="img"
        aria-label={t("history.availabilityShare", { share: formatPercent(share) })}
      >
        {segments.map((s, i) => {
          const tone =
            s.total === 0
              ? "bg-surface-3"
              : s.ok === s.total
                ? "bg-ok"
                : s.ok === 0
                  ? "bg-fail"
                  : "bg-warn";
          const title =
            s.total === 0
              ? formatDateTime(s.from, i18n.language)
              : `${formatDateTime(s.from, i18n.language)} · ${s.ok}/${s.total}`;
          return (
            <span
              key={i}
              title={title}
              className={cn(
                "min-w-0 flex-1 rounded-[1px] sm:rounded-[2px] transition-opacity hover:opacity-100",
                tone,
                s.total > 0 && s.ok === s.total ? "opacity-75" : "opacity-95",
              )}
            />
          );
        })}
      </div>
      <p className="text-xs text-fg-subtle tabular">
        {t("history.availabilityShare", { share: formatPercent(share) })}
      </p>
    </div>
  );
}
