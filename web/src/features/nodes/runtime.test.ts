import { describe, expect, it } from "vitest";
import type { AgentInfo, AppliedInfo, NodeRuntime, ProvisionInfo } from "@/lib/types";
import { agentPresence, applyBanner, isAgentOnline } from "./runtime";

const NOW = 1_800_000_000;

const agent = (online: boolean): AgentInfo => ({
  hostname: "msk-1",
  arch: "x86_64",
  tmnode_version: "0.5.0",
  enrolled_at: NOW - 86_400,
  last_seen_at: online ? NOW - 10 : NOW - 3600,
  online,
});

const applied = (p: Partial<AppliedInfo> = {}): AppliedInfo => ({
  result: "applied",
  version: "a1b2c3",
  error: null,
  pending_restart: [],
  at: NOW - 60,
  ...p,
});

const provision: ProvisionInfo = {
  public_host: "203.0.113.10",
  port: 18081,
  backend: "sled",
  with_turn: true,
};

type Rt = Pick<NodeRuntime, "state" | "applied" | "provision" | "agent">;

describe("apply-state banner", () => {
  it("explains manually added nodes (no agent, no provision)", () => {
    const b = applyBanner({ state: "no_agent", applied: null, provision: null, agent: null });
    expect(b.variant).toBe("manual");
    expect(b.tone).toBe("skip");
    expect(b.pendingRestart).toEqual([]);
  });

  it("tells a prepared node is not installed yet", () => {
    const b = applyBanner({ state: "no_agent", applied: null, provision, agent: null });
    expect(b.variant).toBe("not_installed");
    expect(b.tone).toBe("unknown");
  });

  it("shows pending with a spinner while the agent is online", () => {
    const rt: Rt = { state: "pending", applied: applied(), provision, agent: agent(true) };
    const b = applyBanner(rt);
    expect(b.variant).toBe("pending");
    expect(b.spinning).toBe(true);
  });

  it("warns when the agent that should apply is offline", () => {
    const b = applyBanner({ state: "pending", applied: null, provision, agent: agent(false) });
    expect(b.variant).toBe("pending_offline");
    expect(b.tone).toBe("warn");
    expect(b.spinning).toBe(false);
  });

  it("reports the applied version, time and pending restarts", () => {
    const b = applyBanner({
      state: "applied",
      applied: applied({ pending_restart: ["blob_chunk_max_bytes"] }),
      provision,
      agent: agent(true),
    });
    expect(b).toMatchObject({
      variant: "applied",
      tone: "ok",
      version: "a1b2c3",
      at: NOW - 60,
      pendingRestart: ["blob_chunk_max_bytes"],
    });
  });

  it("surfaces the node's rejection reason", () => {
    const b = applyBanner({
      state: "invalid",
      applied: applied({ result: "invalid", error: "blob_get_window_bytes: меньше куска" }),
      provision,
      agent: agent(true),
    });
    expect(b.variant).toBe("invalid");
    expect(b.tone).toBe("fail");
    expect(b.error).toBe("blob_get_window_bytes: меньше куска");
  });
});

describe("agent presence", () => {
  it("is online within 90 s of the last heartbeat", () => {
    expect(isAgentOnline(NOW - 90, NOW)).toBe(true);
    expect(isAgentOnline(NOW - 91, NOW)).toBe(false);
    expect(isAgentOnline(null, NOW)).toBe(false);
  });

  it("classifies list items", () => {
    expect(agentPresence({ agent: null }, NOW)).toBe("none");
    expect(agentPresence({ agent: { hostname: "a", last_seen_at: NOW - 5 } }, NOW)).toBe("online");
    expect(agentPresence({ agent: { hostname: "a", last_seen_at: null } }, NOW)).toBe("offline");
  });
});
