import {
  CircleCheck,
  Hourglass,
  LoaderCircle,
  OctagonAlert,
  Unplug,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import type { Tone } from "@/lib/status";
import type { NodeListItem, NodeRuntime } from "@/lib/types";

/** Heartbeat every 30 s; the agent counts as online for three intervals (api: `online`). */
export const AGENT_ONLINE_SECS = 90;

export function isAgentOnline(lastSeenAt: number | null | undefined, nowSec: number): boolean {
  return typeof lastSeenAt === "number" && nowSec - lastSeenAt <= AGENT_ONLINE_SECS;
}

export type AgentPresence = "none" | "online" | "offline";

export function agentPresence(node: Pick<NodeListItem, "agent">, nowSec: number): AgentPresence {
  if (!node.agent) return "none";
  return isAgentOnline(node.agent.last_seen_at, nowSec) ? "online" : "offline";
}

export type BannerVariant =
  "not_installed" | "manual" | "pending" | "pending_offline" | "applied" | "invalid";

export interface ApplyBanner {
  variant: BannerVariant;
  tone: Tone;
  icon: LucideIcon;
  /** Animated icon (pending). */
  spinning: boolean;
  /** Version the node reports as applied, if any. */
  version: string | null;
  /** When the agent reported the result. */
  at: number | null;
  /** Rejection reason from the node (invalid). */
  error: string | null;
  /** Settings that wait for a node restart. */
  pendingRestart: string[];
}

/**
 * `GET /nodes/{id}/runtime` → what the apply-state banner shows. Text comes from
 * `runtime.banner.<variant>` in i18n.
 */
export function applyBanner(
  rt: Pick<NodeRuntime, "state" | "applied" | "provision" | "agent">,
): ApplyBanner {
  const base = {
    spinning: false,
    version: rt.applied?.version ?? null,
    at: rt.applied?.at ?? null,
    error: null,
    pendingRestart: rt.applied?.pending_restart ?? [],
  };
  switch (rt.state) {
    case "no_agent":
      return rt.provision
        ? { ...base, variant: "not_installed", tone: "unknown", icon: Hourglass }
        : { ...base, variant: "manual", tone: "skip", icon: Unplug, pendingRestart: [] };
    case "pending":
      return rt.agent && !rt.agent.online
        ? { ...base, variant: "pending_offline", tone: "warn", icon: WifiOff }
        : { ...base, variant: "pending", tone: "stale", icon: LoaderCircle, spinning: true };
    case "applied":
      return { ...base, variant: "applied", tone: "ok", icon: CircleCheck };
    case "invalid":
      return {
        ...base,
        variant: "invalid",
        tone: "fail",
        icon: OctagonAlert,
        error: rt.applied?.error ?? null,
      };
  }
}
