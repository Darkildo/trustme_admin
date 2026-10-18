import {
  CircleCheck,
  CircleHelp,
  CircleMinus,
  CircleX,
  Clock,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { CheckStatus, NodeStatus } from "./types";

/** Visual tone; each maps to a `--tm-<tone>` / `--tm-<tone>-soft` token pair. */
export type Tone = "ok" | "warn" | "fail" | "stale" | "unknown" | "skip";

export interface StatusMeta {
  tone: Tone;
  icon: LucideIcon;
  /** i18n key of the label. */
  labelKey: string;
}

/** Order from best to worst: ok < unknown < warn < stale < fail. */
export const NODE_STATUS_ORDER: readonly NodeStatus[] = ["ok", "unknown", "warn", "stale", "fail"];

const NODE_META: Record<NodeStatus, StatusMeta> = {
  ok: { tone: "ok", icon: CircleCheck, labelKey: "status.node.ok" },
  unknown: { tone: "unknown", icon: CircleHelp, labelKey: "status.node.unknown" },
  warn: { tone: "warn", icon: TriangleAlert, labelKey: "status.node.warn" },
  stale: { tone: "stale", icon: Clock, labelKey: "status.node.stale" },
  fail: { tone: "fail", icon: CircleX, labelKey: "status.node.fail" },
};

const CHECK_META: Record<CheckStatus, StatusMeta> = {
  ok: { tone: "ok", icon: CircleCheck, labelKey: "status.check.ok" },
  skip: { tone: "skip", icon: CircleMinus, labelKey: "status.check.skip" },
  warn: { tone: "warn", icon: TriangleAlert, labelKey: "status.check.warn" },
  error: { tone: "fail", icon: OctagonAlert, labelKey: "status.check.error" },
  fail: { tone: "fail", icon: CircleX, labelKey: "status.check.fail" },
};

export function nodeStatusMeta(status: NodeStatus): StatusMeta {
  return NODE_META[status] ?? NODE_META.unknown;
}

export function checkStatusMeta(status: CheckStatus): StatusMeta {
  return CHECK_META[status] ?? CHECK_META.skip;
}

export function nodeStatusRank(status: NodeStatus): number {
  const i = NODE_STATUS_ORDER.indexOf(status);
  return i < 0 ? 1 : i;
}

export function worstNodeStatus(statuses: NodeStatus[]): NodeStatus {
  return statuses.reduce<NodeStatus>(
    (acc, s) => (nodeStatusRank(s) > nodeStatusRank(acc) ? s : acc),
    "ok",
  );
}

/** Report status → node status, as documented in api.md. */
export function reportToNodeStatus(status: CheckStatus): NodeStatus {
  switch (status) {
    case "ok":
    case "skip":
      return "ok";
    case "warn":
    case "error":
      return "warn";
    case "fail":
      return "fail";
  }
}

export const CHECK_STATUS_ORDER: readonly CheckStatus[] = ["ok", "skip", "warn", "error", "fail"];

export function worstCheckStatus(statuses: CheckStatus[]): CheckStatus {
  return statuses.reduce<CheckStatus>(
    (acc, s) => (CHECK_STATUS_ORDER.indexOf(s) > CHECK_STATUS_ORDER.indexOf(acc) ? s : acc),
    "ok",
  );
}
