import type { Setting, Settings } from "@/lib/types";

export type SettingError =
  | { code: "number" }
  | { code: "integer" }
  | { code: "range"; min: number; max: number; zero: boolean }
  | { code: "unknown" };

/**
 * The same rule the node applies (catalog `check`): 0 is always fine for «no limit»
 * settings, everything else must be an integer within [min, max].
 */
export function validateSettingValue(setting: Setting, value: number): SettingError | null {
  if (!Number.isFinite(value)) return { code: "number" };
  if (!Number.isInteger(value) || value < 0) return { code: "integer" };
  if (value === 0 && setting.zero_unlimited) return null;
  if (value < setting.min || value > setting.max) {
    return { code: "range", min: setting.min, max: setting.max, zero: setting.zero_unlimited };
  }
  return null;
}

/** Errors per key for a set of values (unknown keys included). Empty object when valid. */
export function validateSettings(
  catalog: readonly Setting[],
  values: Settings,
): Record<string, SettingError> {
  const byKey = new Map(catalog.map((s) => [s.key, s]));
  const out: Record<string, SettingError> = {};
  for (const [key, value] of Object.entries(values)) {
    const s = byKey.get(key);
    if (!s) {
      out[key] = { code: "unknown" };
      continue;
    }
    const e = validateSettingValue(s, value);
    if (e) out[key] = e;
  }
  return out;
}

/** Shallow equality of two value maps (order-independent). */
export function sameSettings(a: Settings, b: Settings): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && b[k] === a[k]);
}

/** Copy without one key. */
export function withoutKey(values: Settings, key: string): Settings {
  const next = { ...values };
  delete next[key];
  return next;
}

/** «blob_max_size_bytes: от …» → "blob_max_size_bytes" when that key is in the catalog. */
export function serverErrorKey(message: string, catalog: readonly Setting[]): string | null {
  const m = /^\s*(?:settings\.|overrides\.)?([a-z0-9_]+)\s*[:=]/.exec(message);
  if (!m) return null;
  return catalog.some((s) => s.key === m[1]) ? m[1]! : null;
}
