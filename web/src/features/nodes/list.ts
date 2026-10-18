import { nodeStatusRank } from "@/lib/status";
import type { NodeListItem, NodeStatus } from "@/lib/types";

export type SortKey = "status" | "name" | "latency" | "uptime" | "report";
export type SortDir = "asc" | "desc";

export interface NodeFilter {
  text: string;
  statuses: NodeStatus[];
  /** "key=value" or "" for all. */
  label: string;
}

export function allLabels(nodes: NodeListItem[]): string[] {
  const set = new Set<string>();
  for (const n of nodes) for (const [k, v] of Object.entries(n.labels)) set.add(`${k}=${v}`);
  return [...set].sort();
}

export function filterNodes(nodes: NodeListItem[], f: NodeFilter): NodeListItem[] {
  const text = f.text.trim().toLowerCase();
  return nodes.filter((n) => {
    if (f.statuses.length > 0 && !f.statuses.includes(n.status)) return false;
    if (f.label) {
      const eq = f.label.indexOf("=");
      const k = f.label.slice(0, eq);
      const v = f.label.slice(eq + 1);
      if (n.labels[k] !== v) return false;
    }
    if (text) {
      const hay = [
        n.name,
        n.addr,
        n.fingerprint,
        n.node_key,
        ...Object.entries(n.labels).map(([k, v]) => `${k}=${v}`),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}

function sortValue(n: NodeListItem, key: SortKey): number | string {
  switch (key) {
    case "status":
      return nodeStatusRank(n.status);
    case "name":
      return n.name.toLowerCase();
    case "latency":
      return n.last_probe?.handshake_ms ?? Number.POSITIVE_INFINITY;
    case "uptime":
      return n.uptime_24h ?? -1;
    case "report":
      return n.last_report?.generated_at ?? 0;
  }
}

export function sortNodes(nodes: NodeListItem[], key: SortKey, dir: SortDir): NodeListItem[] {
  const mul = dir === "asc" ? 1 : -1;
  return [...nodes].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    const cmp =
      typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return cmp * mul || a.name.localeCompare(b.name);
  });
}
