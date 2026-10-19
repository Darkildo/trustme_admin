import { describe, expect, it } from "vitest";
import type { Setting } from "@/lib/types";
import {
  sameSettings,
  serverErrorKey,
  validateSettings,
  validateSettingValue,
  withoutKey,
} from "./validation";

function setting(p: Partial<Setting>): Setting {
  return {
    key: "x",
    env: "X",
    group: "messages",
    unit: "count",
    scope: "hot",
    min: 1,
    max: 100,
    zero_unlimited: false,
    default: 10,
    summary: "",
    ...p,
  };
}

const ttl = setting({ key: "ice_credential_ttl_secs", unit: "seconds", min: 300, max: 86_400 });
const conns = setting({
  key: "limit_max_connections",
  min: 1,
  max: 1_000_000_000,
  zero_unlimited: true,
});

describe("limit validation", () => {
  it("accepts values inside [min, max]", () => {
    expect(validateSettingValue(ttl, 300)).toBeNull();
    expect(validateSettingValue(ttl, 86_400)).toBeNull();
    expect(validateSettingValue(ttl, 7200)).toBeNull();
  });

  it("rejects values outside [min, max] with the bounds", () => {
    expect(validateSettingValue(ttl, 299)).toEqual({
      code: "range",
      min: 300,
      max: 86_400,
      zero: false,
    });
    expect(validateSettingValue(ttl, 86_401)?.code).toBe("range");
  });

  it("treats 0 as «no limit» only where the catalog allows it", () => {
    expect(validateSettingValue(conns, 0)).toBeNull();
    expect(validateSettingValue(ttl, 0)?.code).toBe("range");
  });

  it("rejects non-numbers and fractions", () => {
    expect(validateSettingValue(ttl, Number.NaN)).toEqual({ code: "number" });
    expect(validateSettingValue(ttl, 400.5)).toEqual({ code: "integer" });
    expect(validateSettingValue(conns, -1)).toEqual({ code: "integer" });
  });

  it("validates a whole set, including unknown keys", () => {
    const errors = validateSettings([ttl, conns], {
      ice_credential_ttl_secs: 10,
      limit_max_connections: 0,
      nope: 1,
    });
    expect(Object.keys(errors).sort()).toEqual(["ice_credential_ttl_secs", "nope"]);
    expect(errors.nope).toEqual({ code: "unknown" });
  });

  it("compares and edits value maps", () => {
    expect(sameSettings({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameSettings({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameSettings({ a: 1 }, {})).toBe(false);
    expect(withoutKey({ a: 1, b: 2 }, "a")).toEqual({ b: 2 });
  });

  it("finds the setting a server 400 message is about", () => {
    const catalog = [ttl, conns];
    expect(serverErrorKey("ice_credential_ttl_secs: от 300 до 86400, получено 5", catalog)).toBe(
      "ice_credential_ttl_secs",
    );
    expect(serverErrorKey("overrides.limit_max_connections: слишком много", catalog)).toBe(
      "limit_max_connections",
    );
    expect(serverErrorKey("name: от 1 до 64 символов", catalog)).toBeNull();
    expect(serverErrorKey("что-то пошло не так", catalog)).toBeNull();
  });
});
