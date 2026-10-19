// Types mirroring docs/api.md (API v1). Timestamps are Unix seconds; IDs are ULIDs.

export type Role = "owner" | "admin" | "viewer";
export type NodeStatus = "ok" | "unknown" | "warn" | "stale" | "fail";
export type CheckStatus = "ok" | "skip" | "warn" | "error" | "fail";
export type ProbeStage = "connect" | "handshake" | "auth" | "config";

export type ErrorCode =
  | "invalid_input"
  | "unauthorized"
  | "totp_required"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unprocessable"
  | "rate_limited"
  | "internal";

export interface ErrorBody {
  error: { code: ErrorCode | (string & {}); message: string };
}

export interface User {
  id: string;
  username: string;
  role: Role;
  totp_enabled: boolean;
  disabled: boolean;
  created_at: number;
  last_login_at: number | null;
}

/** From the signed ServerConfig. */
export interface ProbeConfig {
  proto_version: number;
  expires_at: number;
  supports_delivery_ack: boolean;
  supports_queue_addressing: boolean;
  supports_blobs: boolean;
  blob_max_size: number;
}

export interface Probe {
  id: string;
  at: number;
  ok: boolean;
  /** Where a failed probe stopped. */
  stage: ProbeStage | null;
  error: string | null;
  connect_ms: number | null;
  handshake_ms: number | null;
  config: ProbeConfig | null;
}

export interface CheckCounts {
  ok: number;
  skip: number;
  warn: number;
  error: number;
  fail: number;
}

export interface ReportSummary {
  id: string;
  received_at: number;
  generated_at: number;
  status: CheckStatus;
  tmnode_version: string;
  counts: CheckCounts;
}

/** An element of `checks` from tmnode.report/1, as is. */
export interface Check {
  id: string;
  status: CheckStatus;
  summary: string;
  hint?: string;
  data?: Record<string, unknown>;
}

export interface Report extends ReportSummary {
  target: { config?: string; container?: string; addr?: string; node_key?: string };
  checks: Check[];
}

/** Agent summary shown in lists (full record is in {@link NodeRuntime}). */
export interface NodeAgentBrief {
  last_seen_at: number | null;
  hostname: string;
}

export interface NodeListItem {
  id: string;
  name: string;
  addr: string;
  /** Prepared in the panel; the agent has not sent the key yet (node_key = ""). */
  provisioning: boolean;
  agent: NodeAgentBrief | null;
  /** 64 hex. */
  node_key: string;
  /** "A1B2-C3D4-…" — groups of 4 hex, upper case. */
  fingerprint: string;
  labels: Record<string, string>;
  status: NodeStatus;
  paused: boolean;
  last_probe: Probe | null;
  last_report: ReportSummary | null;
  /** Share of successful probes over 24 h, 0..1. */
  uptime_24h: number | null;
}

export interface NodeDetail extends NodeListItem {
  notes: string;
  probe_interval_secs: number;
  created_at: number;
  updated_at: number;
  latest_report: Report | null;
  has_ingest_token: boolean;
}

// ---- Endpoint payloads ----

export interface Health {
  status: string;
  version: string;
}

export interface SetupState {
  needed: boolean;
}

export interface UserEnvelope {
  user: User;
}

export interface TotpSetup {
  secret: string;
  otpauth_uri: string;
}

export interface OverviewTile {
  id: string;
  name: string;
  status: NodeStatus;
  handshake_ms: number | null;
  uptime_24h: number | null;
  /** 24 values: hourly share of successful probes (0..1), -1 = no data. */
  spark: number[];
}

export type OverviewEventKind = "status_changed" | "report_problem" | "key_changed";

export interface OverviewEvent {
  at: number;
  node_id: string;
  node_name: string;
  kind: OverviewEventKind;
  from?: NodeStatus;
  to?: NodeStatus;
  summary: string;
}

export interface Overview {
  nodes: { total: number; by_status: Record<NodeStatus, number> };
  tiles: OverviewTile[];
  /** Last 50. */
  events: OverviewEvent[];
  /** 24 hourly points across the fleet. */
  latency: Array<{ at: number; handshake_ms_p50: number | null }>;
}

export interface CreateNodeInput {
  name: string;
  addr: string;
  node_key: string;
  labels?: Record<string, string>;
  probe_interval_secs?: number;
}

export interface CreateNodeResult {
  node: NodeDetail;
  ingest_token: string;
}

export interface UpdateNodeInput {
  name?: string;
  addr?: string;
  node_key?: string;
  labels?: Record<string, string>;
  notes?: string;
  probe_interval_secs?: number;
  paused?: boolean;
  /** "" — the default profile. */
  profile_id?: string;
  /** Whole object; {} removes all overrides. */
  overrides?: Record<string, number>;
  /** Whole list. */
  turn_server_ids?: string[];
}

export interface CreateUserResult {
  user: User;
  invite_url: string;
}

export interface AuditEntry {
  id: string;
  at: number;
  user: string | null;
  action: string;
  target: string | null;
  details: Record<string, unknown>;
  ip: string | null;
}

// ---- Node management (stage 2) ----

export type Scope = "hot" | "new_sessions" | "restart";
export type SettingGroup = "messages" | "sessions" | "network" | "blobs" | "security" | "calls";
export type SettingUnit = "count" | "per_second" | "bytes" | "bytes_per_day" | "seconds";

/** One entry of the node limits catalog (`GET /catalog`). */
export interface Setting {
  key: string;
  env: string;
  group: SettingGroup;
  unit: SettingUnit;
  scope: Scope;
  min: number;
  max: number;
  /** 0 means «no limit». */
  zero_unlimited: boolean;
  default: number;
  /** One line, in Russian. */
  summary: string;
}

export type Settings = Record<string, number>;

export interface Profile {
  id: string;
  name: string;
  /** Only the values set by the profile; the rest is the node default. */
  settings: Settings;
  is_default: boolean;
  /** How many nodes use this profile. */
  nodes: number;
  created_at: number;
  updated_at: number;
}

export interface ProfileInput {
  name?: string;
  settings?: Settings;
}

export interface TurnServer {
  id: string;
  name: string;
  /** stun: / stuns: / turn: / turns: */
  urls: string[];
  /** The secret itself is never returned. */
  has_secret: boolean;
  /** coturn installed together with a node. */
  managed_by_node: { id: string; name: string } | null;
  nodes: number;
  created_at: number;
}

export interface TurnServerInput {
  name?: string;
  urls?: string[];
  /** Omitted — keep; "" — remove. */
  secret?: string;
}

export type Backend = "sled" | "jetstream";

export interface ProvisionInfo {
  public_host: string;
  port: number;
  backend: Backend;
  with_turn: boolean;
}

export interface AgentInfo {
  hostname: string;
  arch: string;
  tmnode_version: string;
  enrolled_at: number;
  last_seen_at: number | null;
  online: boolean;
}

export type ApplyResult = "applied" | "invalid" | "absent";
export type RuntimeState = "no_agent" | "pending" | "applied" | "invalid";

export interface AppliedInfo {
  result: ApplyResult;
  version: string | null;
  error: string | null;
  pending_restart: string[];
  at: number;
}

export interface RuntimeSetting {
  key: string;
  value: number;
  source: "profile" | "override";
}

/** `GET /nodes/{id}/runtime` — what is desired for the node and what was applied. */
export interface NodeRuntime {
  profile: { id: string; name: string };
  overrides: Settings;
  /** Only the values that are set (profile or override). */
  settings: RuntimeSetting[];
  turn_server_ids: string[];
  desired_version: string;
  provision: ProvisionInfo | null;
  agent: AgentInfo | null;
  applied: AppliedInfo | null;
  state: RuntimeState;
}

export interface ProvisionInput {
  name: string;
  public_host: string;
  port?: number;
  backend?: Backend;
  with_turn?: boolean;
  /** По первому отчёту подобрать blob_disk_reserve_bytes, если места меньше резерва (сервер: true). */
  auto_blob_reserve?: boolean;
  profile_id?: string;
  turn_server_ids?: string[];
  labels?: Record<string, string>;
}

/** `GET /nodes/{id}/blob-reserve` — резерв диска под файлы: что видит tmnode и что предложит панель. */
export interface BlobReserve {
  /** Свободно на томе блобов — из последнего отчёта (`host.blob_reserve`). */
  available_bytes: number | null;
  /** Размер диска (`host.disk`). */
  total_bytes: number | null;
  /** Резерв, с которым сравнивал tmnode. */
  reserve_bytes: number | null;
  /** Что запишет панель; null — подбирать нечего (места хватает, нет отчёта или данных). */
  suggested_bytes: number | null;
  /** blob_disk_reserve_bytes в настройках панели для ноды (профиль + переопределение); null — не задано. */
  panel_bytes: number | null;
  /** У ноды есть агент tmnode: без него панель настройку не доставит. */
  managed: boolean;
}

export interface EnrollInfo {
  token: string;
  expires_at: number;
  /** Ready-to-run command for the server (one-time, 24 h). */
  command: string;
}

export interface ProvisionResult {
  node_id: string;
  enroll: EnrollInfo;
}

export interface SshInstallInput {
  username: string;
  password?: string;
  private_key?: string;
  passphrase?: string;
  sudo_password?: string;
  host?: string;
  port?: number;
  host_fingerprint?: string;
}

export type JobStatus = "running" | "succeeded" | "failed";

export interface Job {
  id: string;
  node_id: string;
  status: JobStatus;
  /** Install output, up to 256 KiB. */
  output: string;
  exit_code: number | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
}
