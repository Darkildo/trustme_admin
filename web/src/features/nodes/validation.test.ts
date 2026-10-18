import { describe, expect, it } from "vitest";
import { buildCronCommand } from "./cron";
import { deriveStages } from "./stages";
import { isValidAddr, isValidNodeKey, parseLabels, validateNodeForm } from "./validation";

const KEY = "0123456789abcdef".repeat(4);

describe("addr validation", () => {
  it.each([
    "node.example.org:7443",
    "1.2.3.4:1",
    "localhost:65535",
    "[::1]:7443",
    "[2001:db8::42]:443",
  ])("accepts %s", (a) => expect(isValidAddr(a)).toBe(true));
  it.each([
    "",
    "node.example.org",
    ":7443",
    "host:0",
    "host:65536",
    "host:port",
    "::1:7443",
    " host:1",
    "ho st:1",
    "-bad.org:1",
  ])("rejects %s", (a) => expect(isValidAddr(a)).toBe(false));
});

describe("node key validation", () => {
  it("requires exactly 64 hex characters", () => {
    expect(isValidNodeKey(KEY)).toBe(true);
    expect(isValidNodeKey(KEY.toUpperCase())).toBe(true);
    expect(isValidNodeKey(KEY.slice(1))).toBe(false);
    expect(isValidNodeKey(KEY + "0")).toBe(false);
    expect(isValidNodeKey(KEY.slice(1) + "g")).toBe(false);
  });
});

describe("labels", () => {
  it("parses key=value lists", () => {
    expect(parseLabels("env=prod, region = eu")).toEqual({
      ok: true,
      labels: { env: "prod", region: "eu" },
    });
    expect(parseLabels("")).toEqual({ ok: true, labels: {} });
    expect(parseLabels("env")).toEqual({ ok: false });
    expect(parseLabels("=x")).toEqual({ ok: false });
  });
});

describe("validateNodeForm", () => {
  it("reports every invalid field", () => {
    expect(validateNodeForm({ name: "", addr: "x", node_key: "zz", labels: "bad" })).toEqual({
      name: "validation.name",
      addr: "validation.addr",
      node_key: "validation.nodeKey",
      labels: "validation.labels",
    });
  });
  it("accepts a valid form and tolerates whitespace in the key", () => {
    expect(
      validateNodeForm({
        name: "msk-1",
        addr: "msk.example:7443",
        node_key: ` ${KEY.slice(0, 32)} ${KEY.slice(32)} `,
        labels: "env=prod",
      }),
    ).toEqual({});
  });
});

describe("cron command", () => {
  it("substitutes token and origin into a single cron line", () => {
    const cmd = buildCronCommand("tmi_abc", "https://admin.example.org/");
    expect(cmd).toBe(
      '*/5 * * * * root tmnode doctor --json | curl -fsS -X POST -H "Authorization: Bearer tmi_abc" -H "Content-Type: application/json" --data-binary @- https://admin.example.org/api/v1/ingest/report >/dev/null',
    );
    expect(cmd).not.toContain("\n");
    expect(buildCronCommand(null, "http://x")).toContain("Bearer tmi_…");
  });
});

describe("probe stage chain", () => {
  const base = { id: "p", at: 1, connect_ms: 10, handshake_ms: null, config: null };
  it("marks all stages ok for a successful probe", () => {
    const s = deriveStages({ ...base, ok: true, stage: null, error: null, handshake_ms: 30 });
    expect(s.map((x) => x.state)).toEqual(["ok", "ok", "ok"]);
  });
  it("stops at the failed stage", () => {
    expect(
      deriveStages({ ...base, ok: false, stage: "connect", error: "e" }).map((x) => x.state),
    ).toEqual(["fail", "skipped", "skipped"]);
    expect(
      deriveStages({ ...base, ok: false, stage: "handshake", error: "e" }).map((x) => x.state),
    ).toEqual(["ok", "fail", "skipped"]);
    expect(
      deriveStages({ ...base, ok: false, stage: "auth", error: "e" }).map((x) => x.state),
    ).toEqual(["ok", "fail", "skipped"]);
    expect(
      deriveStages({ ...base, ok: false, stage: "config", error: "e" }).map((x) => x.state),
    ).toEqual(["ok", "ok", "fail"]);
  });
  it("is pending without a probe", () => {
    expect(deriveStages(null).map((x) => x.state)).toEqual(["pending", "pending", "pending"]);
  });
});
