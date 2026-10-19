/** "a1b2c3d4…" (64 hex) → "A1B2-C3D4-…" — groups of 4 hex, upper case. */
export function formatFingerprint(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  return (clean.match(/.{1,4}/g) ?? []).join("-");
}

/** First `groups` groups of a fingerprint followed by an ellipsis: "A1B2-C3D4-…". */
export function shortFingerprint(fingerprint: string, groups = 2): string {
  const parts = fingerprint.split("-").filter(Boolean);
  if (parts.length <= groups) return parts.join("-");
  return parts.slice(0, groups).join("-") + "-…";
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s`;
  return `${Math.round(ms)} ms`;
}

export function formatPercent(share: number | null | undefined, digits = 1): string {
  if (share === null || share === undefined || !Number.isFinite(share)) return "—";
  const v = share * 100;
  if (v === 100) return "100%";
  return `${v.toFixed(digits)}%`;
}

/**
 * Размер в двоичных единицах: «64 MiB», «1.5 GiB». С `lang` число пишется по правилам языка
 * и точнее — до двух знаков ниже 10 и одного выше: «1,25 GiB», «13,5 GiB».
 */
export function formatBytes(bytes: number, lang?: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  if (lang !== undefined) {
    const digits = i === 0 ? 0 : v >= 10 ? 1 : 2;
    return `${new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(v)} ${units[i]}`;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatDateTime(ts: number, lang: string): string {
  return new Intl.DateTimeFormat(lang, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ts * 1000));
}

export function formatTime(ts: number, lang: string): string {
  return new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(ts * 1000),
  );
}

export function formatRelative(ts: number, lang: string, nowSec = Date.now() / 1000): string {
  const diff = ts - nowSec;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
  if (abs < 45) return rtf.format(Math.round(diff), "second");
  if (abs < 45 * 60) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 22 * 3600) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 26 * 86400) return rtf.format(Math.round(diff / 86400), "day");
  return formatDateTime(ts, lang);
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
