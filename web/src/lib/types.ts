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

export interface NodeListItem {
  id: string;
  name: string;
  addr: string;
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

export type OverviewEventKind = "status_changed" | "report_problem";

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
