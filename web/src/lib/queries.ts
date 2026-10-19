import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api, fetchProbesWindow, isApiError } from "./api";
import { nowSec } from "./format";
import type { Job, NodeUpdatesView } from "./types";

export const REFRESH_MS = 15_000;

export const qk = {
  setup: ["setup"] as const,
  me: ["me"] as const,
  overview: ["overview"] as const,
  nodes: ["nodes"] as const,
  node: (id: string) => ["nodes", id] as const,
  probes: (id: string, range: string) => ["nodes", id, "probes", range] as const,
  reports: (id: string) => ["nodes", id, "reports"] as const,
  report: (id: string, rid: string) => ["nodes", id, "reports", rid] as const,
  runtime: (id: string) => ["nodes", id, "runtime"] as const,
  blobReserve: (id: string) => ["nodes", id, "blob-reserve"] as const,
  updates: (id: string) => ["nodes", id, "updates"] as const,
  releases: ["releases"] as const,
  catalog: ["catalog"] as const,
  profiles: ["profiles"] as const,
  turn: ["turn-servers"] as const,
  job: (id: string) => ["jobs", id] as const,
  users: ["users"] as const,
  audit: ["audit"] as const,
};

export const setupQuery = queryOptions({
  queryKey: qk.setup,
  queryFn: () => api.setup.state(),
  staleTime: Infinity,
});

/** Current user, or null when there is no session. */
export const meQuery = queryOptions({
  queryKey: qk.me,
  queryFn: async () => {
    try {
      return await api.auth.me();
    } catch (e) {
      if (isApiError(e, "unauthorized")) return null;
      throw e;
    }
  },
  staleTime: 5 * 60_000,
});

export const overviewQuery = queryOptions({
  queryKey: qk.overview,
  queryFn: () => api.overview(),
  refetchInterval: REFRESH_MS,
});

export const nodesQuery = queryOptions({
  queryKey: qk.nodes,
  queryFn: () => api.nodes.list(),
  refetchInterval: REFRESH_MS,
});

export const nodeQuery = (id: string) =>
  queryOptions({
    queryKey: qk.node(id),
    queryFn: () => api.nodes.get(id),
    refetchInterval: REFRESH_MS,
  });

export type HistoryRange = "1h" | "24h" | "7d";
export const RANGE_SECS: Record<HistoryRange, number> = {
  "1h": 3600,
  "24h": 86400,
  "7d": 7 * 86400,
};

export const probesQuery = (id: string, range: HistoryRange) =>
  queryOptions({
    queryKey: qk.probes(id, range),
    queryFn: async () => {
      const until = nowSec();
      const since = until - RANGE_SECS[range];
      const probes = await fetchProbesWindow(id, since);
      return { since, until, probes };
    },
    refetchInterval: range === "7d" ? 5 * 60_000 : 60_000,
  });

export const reportsQuery = (id: string) =>
  queryOptions({
    queryKey: qk.reports(id),
    queryFn: () => api.nodes.reports(id, { limit: 50 }),
    refetchInterval: 60_000,
  });

export const reportQuery = (id: string, rid: string) =>
  queryOptions({
    queryKey: qk.report(id, rid),
    queryFn: () => api.nodes.report(id, rid),
    staleTime: Infinity,
  });

export const usersQuery = queryOptions({
  queryKey: qk.users,
  queryFn: () => api.users.list(),
});

export const AUDIT_PAGE = 100;

export const auditQuery = infiniteQueryOptions({
  queryKey: qk.audit,
  queryFn: ({ pageParam }) => api.audit({ limit: AUDIT_PAGE, before: pageParam }),
  initialPageParam: undefined as number | undefined,
  getNextPageParam: (last) => {
    if (last.length < AUDIT_PAGE) return undefined;
    return last[last.length - 1]?.at;
  },
});

/** The catalog only changes with the admin binary: fetch once per session. */
export const catalogQuery = queryOptions({
  queryKey: qk.catalog,
  queryFn: () => api.catalog(),
  staleTime: Infinity,
});

export const profilesQuery = queryOptions({
  queryKey: qk.profiles,
  queryFn: () => api.profiles.list(),
  staleTime: 30_000,
});

export const turnServersQuery = queryOptions({
  queryKey: qk.turn,
  queryFn: () => api.turn.list(),
  staleTime: 30_000,
});

/** Faster refresh while the agent has not applied the current version yet. */
export const RUNTIME_PENDING_MS = 5_000;

export const runtimeQuery = (id: string) =>
  queryOptions({
    queryKey: qk.runtime(id),
    queryFn: () => api.nodes.runtime(id),
    refetchInterval: (q) => (q.state.data?.state === "pending" ? RUNTIME_PENDING_MS : REFRESH_MS),
  });

/** Резерв диска меняется только с отчётом или подбором: опрос реже, чем у деталей ноды. */
export const blobReserveQuery = (id: string) =>
  queryOptions({
    queryKey: qk.blobReserve(id),
    queryFn: () => api.nodes.blobReserve(id),
    refetchInterval: 60_000,
  });

export const JOB_POLL_MS = 1_500;

/** Keep polling while the job runs (or before the first answer); stop once it finished. */
export function shouldPollJob(job: Job | undefined, failed = false): boolean {
  if (failed) return false;
  return job === undefined || job.status === "running";
}

export const jobQuery = (id: string) =>
  queryOptions({
    queryKey: qk.job(id),
    queryFn: () => api.jobs.get(id),
    retry: (count, e) => !isApiError(e, "not_found") && count < 3,
    refetchInterval: (q) =>
      shouldPollJob(q.state.data, q.state.status === "error") ? JOB_POLL_MS : false,
  });

/** Сервер держит релизы в кэше 5 минут — чаще спрашивать незачем. */
export const releasesQuery = queryOptions({
  queryKey: qk.releases,
  queryFn: () => api.releases(),
  staleTime: 5 * 60_000,
  retry: false,
});

/** Пока задание активно — опрос каждые 3 с, иначе раз в полминуты. */
export const UPDATE_POLL_MS = 3_000;

export function updatePollInterval(view: NodeUpdatesView | undefined): number {
  const latest = view?.updates[0];
  return latest && (latest.state === "pending" || latest.state === "running")
    ? UPDATE_POLL_MS
    : 30_000;
}

export const nodeUpdatesQuery = (id: string) =>
  queryOptions({
    queryKey: qk.updates(id),
    queryFn: () => api.nodes.updates(id),
    refetchInterval: (q) => updatePollInterval(q.state.data),
  });
