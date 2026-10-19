import { describe, expect, it } from "vitest";
import {
  blobReserveQuery,
  JOB_POLL_MS,
  jobQuery,
  qk,
  RUNTIME_PENDING_MS,
  REFRESH_MS,
  runtimeQuery,
  shouldPollJob,
  UPDATE_POLL_MS,
  updatePollInterval,
} from "./queries";
import type { Job, NodeUpdate, NodeUpdatesView } from "./types";

const job = (status: Job["status"]): Job => ({
  id: "j",
  node_id: "n",
  status,
  output: "",
  exit_code: status === "succeeded" ? 0 : null,
  error: null,
  started_at: 1,
  finished_at: status === "running" ? null : 2,
});

type IntervalFn = (q: { state: { data: unknown; status: string } }) => number | false;

describe("job polling", () => {
  it("polls until the job finishes", () => {
    expect(shouldPollJob(undefined)).toBe(true);
    expect(shouldPollJob(job("running"))).toBe(true);
    expect(shouldPollJob(job("succeeded"))).toBe(false);
    expect(shouldPollJob(job("failed"))).toBe(false);
    expect(shouldPollJob(job("running"), true)).toBe(false);
  });

  it("wires the stop condition into the query", () => {
    const interval = jobQuery("j").refetchInterval as unknown as IntervalFn;
    expect(interval({ state: { data: undefined, status: "pending" } })).toBe(JOB_POLL_MS);
    expect(interval({ state: { data: job("running"), status: "success" } })).toBe(JOB_POLL_MS);
    expect(interval({ state: { data: job("succeeded"), status: "success" } })).toBe(false);
    expect(interval({ state: { data: job("failed"), status: "success" } })).toBe(false);
    expect(interval({ state: { data: undefined, status: "error" } })).toBe(false);
  });

  it("refreshes the runtime faster while a version is pending", () => {
    const interval = runtimeQuery("n").refetchInterval as unknown as IntervalFn;
    expect(interval({ state: { data: { state: "pending" }, status: "success" } })).toBe(
      RUNTIME_PENDING_MS,
    );
    expect(interval({ state: { data: { state: "applied" }, status: "success" } })).toBe(REFRESH_MS);
  });

  it("keeps the blob reserve under the node key", () => {
    const key = blobReserveQuery("n").queryKey;
    expect(key).toEqual(["nodes", "n", "blob-reserve"]);
    expect(key.slice(0, 2)).toEqual([...qk.node("n")]);
  });
});

describe("update polling", () => {
  const view = (state: NodeUpdate["state"] | null): NodeUpdatesView =>
    ({
      current: {} as NodeUpdatesView["current"],
      updates: state ? [{ state } as NodeUpdate] : [],
    }) as NodeUpdatesView;

  it("polls fast only while the latest job is active", () => {
    expect(updatePollInterval(view("pending"))).toBe(UPDATE_POLL_MS);
    expect(updatePollInterval(view("running"))).toBe(UPDATE_POLL_MS);
    for (const s of ["succeeded", "failed", "rolled_back", "refused", "cancelled", "lost"] as const)
      expect(updatePollInterval(view(s))).toBe(30_000);
    expect(updatePollInterval(view(null))).toBe(30_000);
    expect(updatePollInterval(undefined)).toBe(30_000);
  });
});
