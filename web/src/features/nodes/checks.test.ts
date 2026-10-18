import { describe, expect, it } from "vitest";
import type { Check } from "@/lib/types";
import { checkGroupOf, groupChecks } from "./checks";

const c = (id: string, status: Check["status"] = "ok"): Check => ({ id, status, summary: id });

describe("check grouping", () => {
  it("maps id prefixes to groups", () => {
    expect(checkGroupOf("config.backend")).toBe("config");
    expect(checkGroupOf("runtime.container")).toBe("runtime");
    expect(checkGroupOf("identity.secret")).toBe("identity");
    expect(checkGroupOf("host.disk")).toBe("host");
    expect(checkGroupOf("endpoint.listen")).toBe("endpoint");
    expect(checkGroupOf("future.thing")).toBe("other");
    expect(checkGroupOf("other.x")).toBe("other");
    expect(checkGroupOf("noprefix")).toBe("other");
  });

  it("groups in fixed order, skips empty groups and keeps check order", () => {
    const groups = groupChecks([
      c("host.disk", "warn"),
      c("config.parse"),
      c("unknown.check", "skip"),
      c("host.memory"),
      c("identity.pin", "fail"),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["config", "identity", "host", "other"]);
    expect(groups.find((g) => g.key === "host")!.checks.map((x) => x.id)).toEqual([
      "host.disk",
      "host.memory",
    ]);
  });

  it("computes the worst status per group", () => {
    const groups = groupChecks([
      c("host.disk", "warn"),
      c("host.blob_reserve", "error"),
      c("config.parse", "skip"),
    ]);
    expect(groups.find((g) => g.key === "host")!.worst).toBe("error");
    expect(groups.find((g) => g.key === "config")!.worst).toBe("skip");
  });

  it("returns nothing for an empty report", () => {
    expect(groupChecks([])).toEqual([]);
  });
});
