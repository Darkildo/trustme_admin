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
} from "./queries";
import type { Job } from "./types";

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
