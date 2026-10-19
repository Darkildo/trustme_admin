import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import {
  amountText,
  bestFactor,
  factorById,
  formatSettingValue,
  fromAmount,
  parseAmount,
  toAmount,
} from "./units";

const t = i18n.getFixedT("ru");
const tEn = i18n.getFixedT("en");
const KIB = 1024;
const MIB = KIB * KIB;
const GIB = MIB * KIB;

describe("limits units", () => {
  it("picks the largest exact byte multiplier", () => {
    expect(bestFactor(64 * MIB, "bytes").id).toBe("MiB");
    expect(bestFactor(2 * GIB, "bytes").id).toBe("GiB");
    expect(bestFactor(1.5 * GIB, "bytes").id).toBe("GiB");
    expect(bestFactor(65_536, "bytes").id).toBe("KiB");
    expect(bestFactor(1000, "bytes").id).toBe("B");
    expect(bestFactor(0, "bytes").id).toBe("B");
  });

  it("picks the largest exact time multiplier", () => {
    expect(bestFactor(7200, "seconds").id).toBe("h");
    expect(bestFactor(86_400, "seconds").id).toBe("d");
    expect(bestFactor(30 * 86_400, "seconds").id).toBe("d");
    expect(bestFactor(90, "seconds").id).toBe("min");
    expect(bestFactor(61, "seconds").id).toBe("s");
  });

  it("round-trips bytes through every multiplier", () => {
    for (const value of [1, 1023, 65_536, 4 * MIB, 1.5 * GIB, 268_435_456, 5 * GIB, 1024 ** 4]) {
      const f = bestFactor(value, "bytes");
      const text = amountText(value, f);
      expect(fromAmount(parseAmount(text)!, f)).toBe(value);
    }
  });

  it("round-trips seconds through every multiplier", () => {
    for (const value of [1, 30, 90, 300, 7200, 5400, 86_400, 2_592_000, 31_536_000]) {
      const f = bestFactor(value, "seconds");
      expect(fromAmount(toAmount(value, f), f)).toBe(value);
    }
  });

  it("converts typed amounts in the chosen unit", () => {
    expect(fromAmount(parseAmount("1,5")!, factorById("bytes", "GiB"))).toBe(1.5 * GIB);
    expect(fromAmount(parseAmount("64")!, factorById("bytes", "MiB"))).toBe(64 * MIB);
    expect(fromAmount(parseAmount("2")!, factorById("seconds", "h"))).toBe(7200);
    expect(fromAmount(parseAmount("30")!, factorById("seconds", "d"))).toBe(2_592_000);
  });

  it("parses what people type and rejects the rest", () => {
    expect(parseAmount("10 000")).toBe(10_000);
    expect(parseAmount("0.5")).toBe(0.5);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("-1")).toBeNull();
    expect(parseAmount("1e3")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });

  it("formats values with units and the unlimited case", () => {
    const bytes = { unit: "bytes" as const, zero_unlimited: true };
    expect(formatSettingValue(64 * MIB, bytes, t, "ru")).toBe("64 MiB");
    expect(formatSettingValue(0, bytes, t, "ru")).toBe("без ограничения");
    expect(formatSettingValue(0, bytes, tEn, "en")).toBe("unlimited");
    expect(formatSettingValue(0, { unit: "count", zero_unlimited: false }, t, "ru")).toBe("0");
    const flag = { unit: "flag", zero_unlimited: false } as const;
    expect(formatSettingValue(1, flag, t, "ru")).toBe("включено");
    expect(formatSettingValue(0, flag, t, "ru")).toBe("выключено");
    expect(formatSettingValue(0, flag, tEn, "en")).toBe("off");
    expect(formatSettingValue(7200, { unit: "seconds", zero_unlimited: false }, t, "ru")).toBe(
      "2 ч",
    );
    expect(
      formatSettingValue(256 * MIB, { unit: "bytes_per_day", zero_unlimited: true }, t, "ru"),
    ).toBe("256 MiB/сут");
    expect(formatSettingValue(100, { unit: "per_second", zero_unlimited: true }, tEn, "en")).toBe(
      "100/s",
    );
  });
});
