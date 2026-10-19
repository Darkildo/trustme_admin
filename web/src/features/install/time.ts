type T = (key: string, options?: Record<string, unknown>) => string;

/** Seconds left → «23 ч 59 мин», «12 мин», «40 с» (units from limits.units). */
export function formatLeft(secs: number, t: T): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} ${t("limits.units.h")} ${m} ${t("limits.units.min")}`;
  if (m > 0) return `${m} ${t("limits.units.min")}`;
  return `${s} ${t("limits.units.s")}`;
}
