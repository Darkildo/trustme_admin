import { describe, expect, it } from "vitest";
import type { BlobReserve } from "@/lib/types";
import { blobReserveAction } from "./blobReserve";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

const reserve = (p: Partial<BlobReserve> = {}): BlobReserve => ({
  available_bytes: 4.4 * GIB,
  total_bytes: 13.5 * GIB,
  reserve_bytes: 5 * GIB,
  suggested_bytes: 1280 * MIB,
  panel_bytes: null,
  managed: true,
  ...p,
});

describe("подбор резерва диска", () => {
  it("предлагает кнопку админу при warn, предложении и агенте", () => {
    expect(blobReserveAction("warn", reserve(), true)).toEqual({
      kind: "fix",
      from: 5 * GIB,
      to: 1280 * MIB,
    });
    expect(blobReserveAction("warn", reserve({ reserve_bytes: null }), true)).toEqual({
      kind: "fix",
      from: null,
      to: 1280 * MIB,
    });
  });

  it("ничего не показывает без предупреждения, данных, предложения или прав", () => {
    for (const status of ["ok", "skip", "error", "fail"] as const)
      expect(blobReserveAction(status, reserve(), true)).toEqual({ kind: "none" });
    expect(blobReserveAction("warn", undefined, true)).toEqual({ kind: "none" });
    expect(blobReserveAction("warn", reserve({ suggested_bytes: null }), true)).toEqual({
      kind: "none",
    });
    expect(blobReserveAction("warn", reserve(), false)).toEqual({ kind: "none" });
  });

  it("без агента — подсказка про окружение, даже наблюдателю и без предложения", () => {
    expect(blobReserveAction("warn", reserve({ managed: false }), true)).toEqual({
      kind: "no_agent",
    });
    expect(
      blobReserveAction("warn", reserve({ managed: false, suggested_bytes: null }), false),
    ).toEqual({ kind: "no_agent" });
    expect(blobReserveAction("ok", reserve({ managed: false }), true)).toEqual({ kind: "none" });
  });

  it("если панель уже уменьшила резерв — пометка вместо кнопки", () => {
    const lowered = { kind: "lowered", panel: 1280 * MIB, reserve: 5 * GIB };
    expect(blobReserveAction("warn", reserve({ panel_bytes: 1280 * MIB }), true)).toEqual(lowered);
    expect(
      blobReserveAction("warn", reserve({ panel_bytes: 1280 * MIB, suggested_bytes: null }), false),
    ).toEqual(lowered);
  });

  it("резерв панели не меньше резерва отчёта — снова можно подобрать", () => {
    expect(blobReserveAction("warn", reserve({ panel_bytes: 5 * GIB }), true).kind).toBe("fix");
    expect(blobReserveAction("warn", reserve({ panel_bytes: 20 * GIB }), true).kind).toBe("fix");
    expect(
      blobReserveAction("warn", reserve({ panel_bytes: GIB, reserve_bytes: null }), true).kind,
    ).toBe("fix");
  });
});
