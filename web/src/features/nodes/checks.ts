import { worstCheckStatus } from "@/lib/status";
import type { Check, CheckStatus } from "@/lib/types";

export type CheckGroupKey = "config" | "runtime" | "identity" | "host" | "endpoint" | "other";

export const CHECK_GROUP_ORDER: readonly CheckGroupKey[] = [
  "config",
  "runtime",
  "identity",
  "host",
  "endpoint",
  "other",
];

export interface CheckGroup {
  key: CheckGroupKey;
  checks: Check[];
  worst: CheckStatus;
}

/** `config.backend` → "config"; ids with an unknown prefix land in "other". */
export function checkGroupOf(id: string): CheckGroupKey {
  const prefix = id.split(".", 1)[0] ?? "";
  return (CHECK_GROUP_ORDER as readonly string[]).includes(prefix) && prefix !== "other"
    ? (prefix as CheckGroupKey)
    : "other";
}

/** Groups checks by id prefix, in the fixed display order, skipping empty groups. */
export function groupChecks(checks: Check[]): CheckGroup[] {
  const buckets = new Map<CheckGroupKey, Check[]>();
  for (const c of checks) {
    const key = checkGroupOf(c.id);
    const list = buckets.get(key);
    if (list) list.push(c);
    else buckets.set(key, [c]);
  }
  return CHECK_GROUP_ORDER.flatMap((key) => {
    const list = buckets.get(key);
    if (!list || list.length === 0) return [];
    return [{ key, checks: list, worst: worstCheckStatus(list.map((c) => c.status)) }];
  });
}
