import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatFingerprint,
  formatMs,
  formatPercent,
  shortFingerprint,
} from "./format";

const KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

describe("fingerprint formatting", () => {
  it("groups 64 hex into 16 upper-case groups of 4", () => {
    const fp = formatFingerprint(KEY);
    expect(fp).toBe(
      "A1B2-C3D4-E5F6-0718-293A-4B5C-6D7E-8F90-A1B2-C3D4-E5F6-0718-293A-4B5C-6D7E-8F90",
    );
    expect(fp.split("-")).toHaveLength(16);
  });

  it("ignores whitespace and separators in the input", () => {
    expect(formatFingerprint("a1b2 c3d4\nE5F6-0718")).toBe("A1B2-C3D4-E5F6-0718");
  });

  it("shortens to the first groups with an ellipsis", () => {
    expect(shortFingerprint(formatFingerprint(KEY))).toBe("A1B2-C3D4-…");
    expect(shortFingerprint(formatFingerprint(KEY), 4)).toBe("A1B2-C3D4-E5F6-0718-…");
    expect(shortFingerprint("A1B2-C3D4", 2)).toBe("A1B2-C3D4");
  });
});

describe("number formatting", () => {
  it("formats milliseconds and shares", () => {
    expect(formatMs(null)).toBe("—");
    expect(formatMs(12.4)).toBe("12 ms");
    expect(formatMs(1500)).toBe("1.5 s");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0.9876)).toBe("98.8%");
    expect(formatPercent(null)).toBe("—");
  });
});

describe("bytes formatting", () => {
  const GIB = 1024 ** 3;

  it("keeps the short form without a language", () => {
    expect(formatBytes(64 * 1024 * 1024)).toBe("64 MiB");
    expect(formatBytes(1.25 * GIB)).toBe("1.3 GiB");
    expect(formatBytes(-1)).toBe("—");
  });

  it("follows the language and keeps two decimals below 10", () => {
    expect(formatBytes(1.25 * GIB, "ru")).toBe("1,25 GiB");
    expect(formatBytes(1.25 * GIB, "en")).toBe("1.25 GiB");
    expect(formatBytes(5 * GIB, "ru")).toBe("5 GiB");
    expect(formatBytes(4.4 * GIB, "ru")).toBe("4,4 GiB");
    expect(formatBytes(13.5 * GIB, "en")).toBe("13.5 GiB");
    expect(formatBytes(512, "ru")).toBe("512 B");
  });
});
