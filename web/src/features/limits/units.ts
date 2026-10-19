import type { Setting, SettingUnit } from "@/lib/types";

/** A display multiplier for a unit: «MiB» = 1024², «h» = 3600. */
export interface UnitFactor {
  id: string;
  factor: number;
  /** i18n key of the short label. */
  labelKey: string;
}

const KIB = 1024;
const BYTE_FACTORS: UnitFactor[] = [
  { id: "B", factor: 1, labelKey: "limits.units.B" },
  { id: "KiB", factor: KIB, labelKey: "limits.units.KiB" },
  { id: "MiB", factor: KIB ** 2, labelKey: "limits.units.MiB" },
  { id: "GiB", factor: KIB ** 3, labelKey: "limits.units.GiB" },
  { id: "TiB", factor: KIB ** 4, labelKey: "limits.units.TiB" },
];
const SECOND_FACTORS: UnitFactor[] = [
  { id: "s", factor: 1, labelKey: "limits.units.s" },
  { id: "min", factor: 60, labelKey: "limits.units.min" },
  { id: "h", factor: 3600, labelKey: "limits.units.h" },
  { id: "d", factor: 86_400, labelKey: "limits.units.d" },
];
const PER_SECOND: UnitFactor[] = [{ id: "ps", factor: 1, labelKey: "limits.units.perSecond" }];
const COUNT: UnitFactor[] = [{ id: "n", factor: 1, labelKey: "limits.units.count" }];

/** Multipliers offered by the input for a unit, smallest first. */
export function unitFactors(unit: SettingUnit): UnitFactor[] {
  switch (unit) {
    case "bytes":
    case "bytes_per_day":
      return BYTE_FACTORS;
    case "seconds":
      return SECOND_FACTORS;
    case "per_second":
      return PER_SECOND;
    case "count":
      return COUNT;
  }
}

export function factorById(unit: SettingUnit, id: string): UnitFactor {
  const list = unitFactors(unit);
  return list.find((f) => f.id === id) ?? list[0]!;
}

/** Round to at most two decimals without float noise: 1.5000000001 → 1.5. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The largest multiplier that shows `value` as a short number that converts back exactly:
 * 67108864 → 64 MiB, 7200 → 2 h, 1610612736 → 1.5 GiB, 1000 → 1000 B.
 */
export function bestFactor(value: number, unit: SettingUnit): UnitFactor {
  const list = unitFactors(unit);
  if (!Number.isFinite(value) || value <= 0) return list[0]!;
  for (let i = list.length - 1; i > 0; i--) {
    const f = list[i]!;
    const amount = value / f.factor;
    if (amount < 1) continue;
    if (Math.abs(round2(amount) * f.factor - value) < 1e-6) return f;
  }
  return list[0]!;
}

/** Raw value → number in the given multiplier (two decimals at most). */
export function toAmount(value: number, factor: UnitFactor): number {
  return round2(value / factor.factor);
}

/** Number typed by a person in the given multiplier → raw integer value. */
export function fromAmount(amount: number, factor: UnitFactor): number {
  return Math.round(amount * factor.factor);
}

/**
 * Parse what was typed: "1,5" and "1.5" are the same; spaces (incl. NBSP and thin spaces)
 * group thousands. Returns null for anything that is not a non-negative number.
 */
export function parseAmount(text: string): number | null {
  const clean = text.replace(/[\s\u00a0\u202f_]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

/** Text for the input, in the chosen multiplier: no grouping, «.» as the separator. */
export function amountText(value: number, factor: UnitFactor): string {
  return String(toAmount(value, factor));
}

type T = (key: string, options?: Record<string, unknown>) => string;

function grouped(n: number, lang: string): string {
  return new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(n);
}

/**
 * Human value of a setting: «64 MiB», «2 ч», «100/с», «256 MiB/сут», «без ограничения».
 * `t` is i18next's translate function (labels of units differ by language).
 */
export function formatSettingValue(
  value: number,
  setting: Pick<Setting, "unit" | "zero_unlimited">,
  t: T,
  lang: string,
): string {
  if (value === 0 && setting.zero_unlimited) return t("limits.unlimited");
  const f = bestFactor(value, setting.unit);
  const amount = grouped(toAmount(value, f), lang);
  switch (setting.unit) {
    case "count":
      return amount;
    case "per_second":
      return `${amount}${t("limits.units.perSecond")}`;
    case "bytes_per_day":
      return `${amount} ${t(f.labelKey)}${t("limits.units.perDay")}`;
    default:
      return `${amount} ${t(f.labelKey)}`;
  }
}
