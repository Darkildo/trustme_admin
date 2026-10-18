import { formatMs } from "@/lib/format";
import type { Probe } from "@/lib/types";

export type StageKey = "tcp" | "handshake" | "config";
export type StageState = "pending" | "running" | "ok" | "fail" | "skipped";

export interface StageView {
  key: StageKey;
  state: StageState;
  detail: string | null;
}

/** Maps a probe result onto the TCP → handshake → config chain. */
export function deriveStages(probe: Probe | null): StageView[] {
  if (!probe) {
    return [
      { key: "tcp", state: "pending", detail: null },
      { key: "handshake", state: "pending", detail: null },
      { key: "config", state: "pending", detail: null },
    ];
  }
  if (probe.ok) {
    return [
      { key: "tcp", state: "ok", detail: formatMs(probe.connect_ms) },
      { key: "handshake", state: "ok", detail: formatMs(probe.handshake_ms) },
      {
        key: "config",
        state: "ok",
        detail: probe.config ? `v${probe.config.proto_version}` : null,
      },
    ];
  }
  const failedAt = probe.stage === "connect" ? 0 : probe.stage === "config" ? 2 : 1;
  const details = [formatMs(probe.connect_ms), formatMs(probe.handshake_ms), null];
  return (["tcp", "handshake", "config"] as const).map((key, i) => ({
    key,
    state: i < failedAt ? "ok" : i === failedAt ? "fail" : "skipped",
    detail: i < failedAt ? details[i]! : null,
  }));
}
