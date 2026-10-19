import type {
  AuditEntry,
  CreateNodeInput,
  EnrollInfo,
  Job,
  NodeRuntime,
  Profile,
  ProfileInput,
  ProvisionInput,
  ProvisionResult,
  Setting,
  SshInstallInput,
  TurnServer,
  TurnServerInput,
  CreateNodeResult,
  CreateUserResult,
  ErrorBody,
  Health,
  NodeDetail,
  NodeListItem,
  Overview,
  Probe,
  Report,
  ReportSummary,
  Role,
  SetupState,
  TotpSetup,
  UpdateNodeInput,
  User,
  UserEnvelope,
} from "./types";

export const API_BASE = "/api/v1";
export const CSRF_HEADER = "X-TrustMe-Admin";

type Method = "GET" | "POST" | "PATCH" | "DELETE";

/** Typed error for any non-2xx answer (or a network failure, code "network", status 0). */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  /** Seconds, from `Retry-After` on 429. */
  readonly retryAfter: number | null;

  constructor(code: string, message: string, status: number, retryAfter: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function isApiError(e: unknown, code?: string): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}

let unauthorizedHandler: (() => void) | null = null;

/** Called when any non-auth endpoint answers 401 `unauthorized` (session gone). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

/**
 * Endpoints where 401 is part of the normal flow (wrong password, TOTP step, startup
 * probing of /auth/me) and must not trigger the global redirect to /login.
 */
const NO_REDIRECT = [/^\/auth\//, /^\/setup\b/, /^\/invite\b/];

function isMutating(method: Method): boolean {
  return method !== "GET";
}

async function transport(method: Method, path: string, init: RequestInit): Promise<Response> {
  if (import.meta.env.VITE_MOCK === "1") {
    const { mockFetch } = await import("./mock");
    return mockFetch(method, path, init.body as string | undefined);
  }
  return fetch(API_BASE + path, init);
}

async function parseError(res: Response): Promise<ApiError> {
  const retryAfterRaw = res.headers.get("Retry-After");
  const retryAfter =
    retryAfterRaw !== null && /^\d+$/.test(retryAfterRaw) ? Number(retryAfterRaw) : null;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const err = (body as Partial<ErrorBody> | null)?.error;
  if (err && typeof err.code === "string") {
    return new ApiError(
      err.code,
      typeof err.message === "string" ? err.message : err.code,
      res.status,
      retryAfter,
    );
  }
  return new ApiError(
    res.status === 401 ? "unauthorized" : res.status >= 500 ? "internal" : "http_error",
    res.statusText || `HTTP ${res.status}`,
    res.status,
    retryAfter,
  );
}

export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (isMutating(method)) headers[CSRF_HEADER] = "1";

  let res: Response;
  try {
    res = await transport(method, path, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError("network", e instanceof Error ? e.message : "network error", 0);
  }

  if (!res.ok) {
    const error = await parseError(res);
    if (error.code === "unauthorized" && !NO_REDIRECT.some((re) => re.test(path))) {
      unauthorizedHandler?.();
    }
    throw error;
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    (e): e is [string, string | number] => e[1] !== undefined,
  );
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

const enc = encodeURIComponent;

export const api = {
  health: () => request<Health>("GET", "/health"),

  setup: {
    state: () => request<SetupState>("GET", "/setup"),
    complete: (input: { token: string; username: string; password: string }) =>
      request<UserEnvelope>("POST", "/setup", input).then((r) => r.user),
  },

  auth: {
    login: (input: { username: string; password: string; totp?: string }) =>
      request<UserEnvelope>("POST", "/auth/login", input).then((r) => r.user),
    logout: () => request<void>("POST", "/auth/logout"),
    me: () => request<UserEnvelope>("GET", "/auth/me").then((r) => r.user),
    totpSetup: () => request<TotpSetup>("POST", "/auth/totp/setup"),
    totpEnable: (code: string) =>
      request<UserEnvelope>("POST", "/auth/totp/enable", { code }).then((r) => r.user),
    totpDisable: (input: { password: string; code: string }) =>
      request<UserEnvelope>("POST", "/auth/totp/disable", input).then((r) => r.user),
    changePassword: (input: { current: string; new: string }) =>
      request<void>("POST", "/auth/password", input),
  },

  overview: () => request<Overview>("GET", "/overview"),

  nodes: {
    list: () => request<{ nodes: NodeListItem[] }>("GET", "/nodes").then((r) => r.nodes),
    create: (input: CreateNodeInput) => request<CreateNodeResult>("POST", "/nodes", input),
    get: (id: string) =>
      request<{ node: NodeDetail }>("GET", `/nodes/${enc(id)}`).then((r) => r.node),
    update: (id: string, input: UpdateNodeInput) =>
      request<{ node: NodeDetail }>("PATCH", `/nodes/${enc(id)}`, input).then((r) => r.node),
    remove: (id: string) => request<void>("DELETE", `/nodes/${enc(id)}`),
    probe: (id: string) =>
      request<{ probe: Probe }>("POST", `/nodes/${enc(id)}/probe`).then((r) => r.probe),
    probes: (id: string, params: { since?: number; limit?: number }) =>
      request<{ probes: Probe[] }>("GET", `/nodes/${enc(id)}/probes${qs(params)}`).then(
        (r) => r.probes,
      ),
    reports: (id: string, params: { limit?: number } = {}) =>
      request<{ reports: ReportSummary[] }>("GET", `/nodes/${enc(id)}/reports${qs(params)}`).then(
        (r) => r.reports,
      ),
    report: (id: string, rid: string) =>
      request<{ report: Report }>("GET", `/nodes/${enc(id)}/reports/${enc(rid)}`).then(
        (r) => r.report,
      ),
    rotateToken: (id: string) =>
      request<{ ingest_token: string }>("POST", `/nodes/${enc(id)}/ingest-token`).then(
        (r) => r.ingest_token,
      ),
    runtime: (id: string) => request<NodeRuntime>("GET", `/nodes/${enc(id)}/runtime`),
    provision: (input: ProvisionInput) =>
      request<ProvisionResult>("POST", "/nodes/provision", input),
    enrollToken: (id: string) =>
      request<{ enroll: EnrollInfo }>("POST", `/nodes/${enc(id)}/enroll-token`).then(
        (r) => r.enroll,
      ),
    sshInstall: (id: string, input: SshInstallInput) =>
      request<{ job_id: string }>("POST", `/nodes/${enc(id)}/ssh-install`, input).then(
        (r) => r.job_id,
      ),
  },

  jobs: {
    get: (id: string) => request<{ job: Job }>("GET", `/jobs/${enc(id)}`).then((r) => r.job),
  },

  catalog: () => request<{ settings: Setting[] }>("GET", "/catalog").then((r) => r.settings),

  profiles: {
    list: () => request<{ profiles: Profile[] }>("GET", "/profiles").then((r) => r.profiles),
    create: (input: { name: string; settings?: Record<string, number> }) =>
      request<{ profile: Profile }>("POST", "/profiles", input).then((r) => r.profile),
    update: (id: string, input: ProfileInput) =>
      request<{ profile: Profile }>("PATCH", `/profiles/${enc(id)}`, input).then((r) => r.profile),
    makeDefault: (id: string) =>
      request<{ profile: Profile }>("POST", `/profiles/${enc(id)}/default`).then((r) => r.profile),
    remove: (id: string) => request<void>("DELETE", `/profiles/${enc(id)}`),
  },

  turn: {
    list: () =>
      request<{ turn_servers: TurnServer[] }>("GET", "/turn-servers").then((r) => r.turn_servers),
    create: (input: { name: string; urls: string[]; secret?: string }) =>
      request<{ turn_server: TurnServer }>("POST", "/turn-servers", input).then(
        (r) => r.turn_server,
      ),
    update: (id: string, input: TurnServerInput) =>
      request<{ turn_server: TurnServer }>("PATCH", `/turn-servers/${enc(id)}`, input).then(
        (r) => r.turn_server,
      ),
    remove: (id: string) => request<void>("DELETE", `/turn-servers/${enc(id)}`),
  },

  users: {
    list: () => request<{ users: User[] }>("GET", "/users").then((r) => r.users),
    invite: (input: { username: string; role: Role }) =>
      request<CreateUserResult>("POST", "/users", input),
    update: (id: string, input: { role?: Role; disabled?: boolean }) =>
      request<UserEnvelope>("PATCH", `/users/${enc(id)}`, input).then((r) => r.user),
    remove: (id: string) => request<void>("DELETE", `/users/${enc(id)}`),
  },

  invite: {
    get: (token: string) => request<{ username: string }>("GET", `/invite${qs({ token })}`),
    accept: (input: { token: string; password: string }) =>
      request<UserEnvelope>("POST", "/invite", input).then((r) => r.user),
  },

  audit: (params: { limit?: number; before?: number }) =>
    request<{ entries: AuditEntry[] }>("GET", `/audit${qs(params)}`).then((r) => r.entries),
};

/**
 * Fetch probes since `since`, following pages while the server returns full pages,
 * so that a 7-day window is not truncated at the oldest 5000 points.
 */
export async function fetchProbesWindow(id: string, since: number, maxPages = 4): Promise<Probe[]> {
  const limit = 5000;
  const out: Probe[] = [];
  const seen = new Set<string>();
  let cursor = since;
  for (let page = 0; page < maxPages; page++) {
    const chunk = await api.nodes.probes(id, { since: cursor, limit });
    for (const p of chunk) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
      }
    }
    const last = chunk[chunk.length - 1];
    if (chunk.length < limit || last === undefined) break;
    cursor = last.at;
  }
  return out;
}
