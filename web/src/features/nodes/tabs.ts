export const NODE_TABS = ["state", "history", "connect", "settings"] as const;
export type NodeTab = (typeof NODE_TABS)[number];

export function parseNodeTab(v: unknown): NodeTab {
  return (NODE_TABS as readonly unknown[]).includes(v) ? (v as NodeTab) : "state";
}
