/**
 * In-memory API used when VITE_MOCK=1 (dev only; imported dynamically so production
 * builds never include it). Covers every screen: healthy, warning (disk, blob reserve
 * QUOTA, memory), failing (handshake), stale/paused and never-probed nodes.
 *
 * Mock logins: any password (≥1 char). "alice" → owner, "bob" → admin with TOTP (any
 * 6 digits), "carol" → viewer. Addresses containing "down" fail TCP, "bad" fail the
 * handshake when probed.
 */
import { formatFingerprint } from "./format";
import type {
  AuditEntry,
  Check,
  CheckCounts,
  CheckStatus,
  NodeDetail,
  NodeListItem,
  NodeStatus,
  Overview,
  OverviewEvent,
  Probe,
  ProbeConfig,
  ProbeStage,
  Report,
  ReportSummary,
  Role,
  User,
} from "./types";

const now = () => Math.floor(Date.now() / 1000);
const T0 = now();

// ---------- deterministic helpers ----------

function hash(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

let idSeq = 0;
const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid(seed = ++idSeq): string {
  let s = "01J";
  for (let i = 0; i < 23; i++) s += CROCK[Math.floor(hash(seed * 31 + i) * 32)];
  return s;
}

function hexKey(seed: number): string {
  let s = "";
  for (let i = 0; i < 64; i++) s += Math.floor(hash(seed * 97 + i) * 16).toString(16);
  return s;
}

function token(prefix: string): string {
  let s = prefix;
  for (let i = 0; i < 43; i++)
    s += "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[
      Math.floor(Math.random() * 62)
    ];
  return s;
}

// ---------- users ----------

interface MockUser extends User {
  password?: string;
}

const users: MockUser[] = [
  {
    id: ulid(1),
    username: "alice",
    role: "owner",
    totp_enabled: false,
    disabled: false,
    created_at: T0 - 86400 * 40,
    last_login_at: T0 - 600,
  },
  {
    id: ulid(2),
    username: "bob",
    role: "admin",
    totp_enabled: true,
    disabled: false,
    created_at: T0 - 86400 * 21,
    last_login_at: T0 - 86400 * 2,
  },
  {
    id: ulid(3),
    username: "carol",
    role: "viewer",
    totp_enabled: false,
    disabled: false,
    created_at: T0 - 86400 * 3,
    last_login_at: null,
  },
  {
    id: ulid(4),
    username: "dave",
    role: "viewer",
    totp_enabled: false,
    disabled: true,
    created_at: T0 - 86400 * 90,
    last_login_at: T0 - 86400 * 60,
  },
];

let sessionUserId: string | null = users[0]!.id;
let pendingTotp: string | null = null;

function publicUser(u: MockUser): User {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    totp_enabled: u.totp_enabled,
    disabled: u.disabled,
    created_at: u.created_at,
    last_login_at: u.last_login_at,
  };
}

// ---------- nodes ----------

type Profile = "healthy" | "warn" | "fail" | "stale" | "new" | "created";

interface MockNode {
  id: string;
  seed: number;
  name: string;
  addr: string;
  node_key: string;
  labels: Record<string, string>;
  notes: string;
  probe_interval_secs: number;
  paused: boolean;
  created_at: number;
  updated_at: number;
  profile: Profile;
  baseLatency: number;
  hasToken: boolean;
  reports: Report[];
  manualProbes: Probe[];
}

const CONFIG: ProbeConfig = {
  proto_version: 3,
  expires_at: T0 + 86400 * 6,
  supports_delivery_ack: true,
  supports_queue_addressing: true,
  supports_blobs: true,
  blob_max_size: 64 * 1024 * 1024,
};

function baseChecks(): Check[] {
  return [
    { id: "config.parse", status: "ok", summary: "node.toml разобран, схема 1" },
    {
      id: "config.backend",
      status: "ok",
      summary: "Бэкенд доставки: jetstream (nats://nats:4222)",
    },
    { id: "config.limits", status: "ok", summary: "Лимиты соединений и сообщений в норме" },
    {
      id: "runtime.container",
      status: "ok",
      summary: "Контейнер message-service запущен, healthy",
      data: { uptime_secs: 864000, restarts: 0 },
    },
    {
      id: "runtime.version",
      status: "ok",
      summary: "trust_message_tcp 0.5.0 — актуальная версия",
      data: { version: "0.5.0" },
    },
    { id: "runtime.metrics", status: "ok", summary: "Метрики Prometheus отдаются на :9100" },
    {
      id: "identity.secret",
      status: "ok",
      summary: "Секретный ключ ноды загружен из файла",
      data: { source: "file" },
    },
    { id: "identity.pin", status: "ok", summary: "Пин совпадает с опубликованным" },
    {
      id: "host.disk",
      status: "ok",
      summary: "Диск /var/lib/trustme: свободно 71%",
      data: { free_bytes: 152_000_000_000, total_bytes: 214_000_000_000 },
    },
    { id: "host.memory", status: "ok", summary: "Память: занято 38% из 4 ГиБ" },
    {
      id: "host.blob_reserve",
      status: "ok",
      summary: "Резерв под блобы: 20 ГиБ из квоты 20 ГиБ доступны",
    },
    { id: "host.clock", status: "ok", summary: "Часы синхронизированы (NTP), смещение 4 мс" },
    { id: "endpoint.listen", status: "ok", summary: "Порт 7443/tcp слушается" },
    { id: "endpoint.probe", status: "ok", summary: "Локальная проба: рукопожатие 3 мс" },
    {
      id: "endpoint.tls_proxy",
      status: "skip",
      summary: "Прокси не используется — проверка пропущена",
    },
  ];
}

function countChecks(checks: Check[]): CheckCounts {
  const counts: CheckCounts = { ok: 0, skip: 0, warn: 0, error: 0, fail: 0 };
  for (const c of checks) counts[c.status]++;
  return counts;
}

function worst(checks: Check[]): CheckStatus {
  const order: CheckStatus[] = ["ok", "warn", "error", "fail"];
  return checks.reduce<CheckStatus>(
    (a, c) => (c.status !== "skip" && order.indexOf(c.status) > order.indexOf(a) ? c.status : a),
    "ok",
  );
}

function patch(checks: Check[], id: string, p: Partial<Check>): Check[] {
  return checks.map((c) => (c.id === id ? { ...c, ...p } : c));
}

function checksFor(profile: Profile, variant: number): Check[] {
  let c = baseChecks();
  if (profile === "warn") {
    c = patch(c, "host.disk", {
      status: "warn",
      summary: "Диск /var/lib/trustme: свободно 6% (11 ГиБ)",
      hint: "Освободите место или расширьте том: при 2% нода перестанет принимать блобы.",
      data: { free_bytes: 11_800_000_000, total_bytes: 196_000_000_000, threshold_pct: 10 },
    });
    c = patch(c, "host.blob_reserve", {
      status: "warn",
      summary: "QUOTA блобов (40 ГиБ) больше свободного места на томе (11 ГиБ)",
      hint: "Уменьшите blobs.quota в node.toml до 8 ГиБ или освободите место на томе.",
      data: { quota_bytes: 42_949_672_960, free_bytes: 11_800_000_000 },
    });
    c = patch(
      c,
      "host.memory",
      variant % 3 === 2
        ? { summary: "Память: занято 72% из 2 ГиБ" }
        : {
            status: "warn",
            summary: "Память: занято 91% из 2 ГиБ, swap активен",
            hint: "Добавьте памяти или снизьте limits.max_connections.",
          },
    );
    c = patch(c, "runtime.version", {
      summary: "trust_message_tcp 0.4.2 — доступна 0.5.0",
      data: { version: "0.4.2", latest: "0.5.0" },
    });
  }
  if (profile === "fail") {
    c = patch(c, "identity.secret", {
      status: "fail",
      summary: "Ключ ноды сгенерирован заново при старте — прежний секрет не найден",
      hint: "Верните файл секрета из резервной копии: клиенты с прежним пином не смогут подключиться.",
      data: { source: "generated" },
    });
    c = patch(c, "identity.pin", {
      status: "fail",
      summary: "Пин ноды не совпадает с опубликованным",
      hint: "Восстановите ключ или опубликуйте новый пин и обновите его в панели.",
    });
    c = patch(c, "endpoint.probe", {
      status: "error",
      summary: "Локальная проба не выполнена: timeout 5 s",
    });
  }
  if (profile === "stale") {
    c = patch(c, "runtime.metrics", { status: "skip", summary: "Метрики отключены в конфиге" });
  }
  return c;
}

function makeReport(node: MockNode, at: number, variant: number): Report {
  const checks = checksFor(node.profile, variant);
  return {
    id: ulid(node.seed * 10_000 + variant),
    received_at: at + 2,
    generated_at: at,
    status: worst(checks),
    tmnode_version: node.profile === "warn" ? "0.4.2" : "0.5.0",
    counts: countChecks(checks),
    target: {
      config: "/etc/trustme/node.toml",
      container: "message-service",
      addr: node.addr,
      node_key: node.node_key,
    },
    checks,
  };
}

function mkNode(
  seed: number,
  name: string,
  addr: string,
  profile: Profile,
  labels: Record<string, string>,
  extra: Partial<MockNode> = {},
): MockNode {
  const node: MockNode = {
    id: ulid(100 + seed),
    seed,
    name,
    addr,
    node_key: hexKey(seed),
    labels,
    notes: "",
    probe_interval_secs: 60,
    paused: false,
    created_at: T0 - 86400 * (10 + seed),
    updated_at: T0 - 3600 * seed,
    profile,
    baseLatency: 18 + seed * 9,
    hasToken: profile !== "new",
    reports: [],
    manualProbes: [],
    ...extra,
  };
  if (profile !== "new" && profile !== "created") {
    const lastAt = profile === "stale" ? T0 - 3600 * 7 : T0 - 140;
    for (let i = 0; i < 40; i++) node.reports.push(makeReport(node, lastAt - i * 300, i));
  }
  return node;
}

const nodes: MockNode[] = [
  mkNode(
    1,
    "msk-1",
    "msk-1.trustme.example:7443",
    "healthy",
    { env: "prod", region: "ru" },
    { notes: "Основная нода, Москва. Бэкенд JetStream." },
  ),
  mkNode(
    2,
    "fra-edge",
    "fra.trustme.example:7443",
    "warn",
    { env: "prod", region: "eu" },
    { baseLatency: 64 },
  ),
  mkNode(3, "ams-relay", "203.0.113.24:7443", "fail", { env: "prod", region: "eu", role: "relay" }),
  mkNode(
    4,
    "lab-pi",
    "192.168.1.50:7443",
    "stale",
    { env: "lab" },
    { paused: true, probe_interval_secs: 300 },
  ),
  mkNode(
    5,
    "spb-2",
    "[2001:db8::42]:7443",
    "healthy",
    { env: "staging", region: "ru" },
    { baseLatency: 27 },
  ),
  mkNode(6, "nyc-new", "nyc.trustme.example:7443", "new", { env: "staging", region: "us" }),
];

function probeAt(node: MockNode, at: number): Probe {
  const r = hash(node.seed * 1_000_003 + at);
  const r2 = hash(node.seed * 7919 + at * 3);
  let ok = true;
  let stage: ProbeStage | null = null;
  let error: string | null = null;
  if (node.profile === "fail" && at > T0 - 2.5 * 3600) {
    ok = false;
    stage = "handshake";
    error =
      "noise: handshake failed — the node answered with a different static key (pin mismatch?)";
  } else if (node.profile === "warn" && r < 0.04) {
    ok = false;
    stage = "connect";
    error = "connect: timed out after 5 s";
  } else if (r < 0.0012) {
    ok = false;
    stage = "connect";
    error = "connect: connection refused";
  }
  const spike = r2 > 0.992 ? 2.2 : 1;
  const wave = 1 + 0.25 * Math.sin(at / 5400 + node.seed);
  const connect =
    ok || stage !== "connect" ? Math.round(node.baseLatency * 0.4 * wave * spike + r2 * 6) : null;
  const handshake = ok ? Math.round(node.baseLatency * wave * spike + r * 12) : null;
  return {
    id: ulid(node.seed * 100_000_000 + at),
    at,
    ok,
    stage,
    error,
    connect_ms: connect,
    handshake_ms: handshake,
    config: ok ? CONFIG : null,
  };
}

function probesOf(node: MockNode, since: number, limit: number): Probe[] {
  if (node.profile === "new" || node.profile === "created") {
    return node.manualProbes.filter((p) => p.at >= since).slice(0, limit);
  }
  const step = node.probe_interval_secs;
  const end = node.paused ? T0 - 3600 * 7 : now();
  const start = Math.max(since, T0 - 14 * 86400);
  const out: Probe[] = [];
  for (let t = Math.ceil(start / step) * step; t <= end && out.length < limit; t += step)
    out.push(probeAt(node, t));
  for (const p of node.manualProbes) if (p.at >= since) out.push(p);
  out.sort((a, b) => a.at - b.at);
  return out.slice(0, limit);
}

function lastProbe(node: MockNode): Probe | null {
  const m = node.manualProbes[node.manualProbes.length - 1];
  if (node.profile === "new" || node.profile === "created") return m ?? null;
  const step = node.probe_interval_secs;
  const end = node.paused ? T0 - 3600 * 7 : now();
  const scheduled = probeAt(node, Math.floor(end / step) * step);
  return m && m.at > scheduled.at ? m : scheduled;
}

function summary(r: Report): ReportSummary {
  return {
    id: r.id,
    received_at: r.received_at,
    generated_at: r.generated_at,
    status: r.status,
    tmnode_version: r.tmnode_version,
    counts: r.counts,
  };
}

const RANK: NodeStatus[] = ["ok", "unknown", "warn", "stale", "fail"];

function nodeStatus(node: MockNode): NodeStatus {
  const p = lastProbe(node);
  let s: NodeStatus = p ? (p.ok ? "ok" : "fail") : "unknown";
  const r = node.reports[0];
  if (r) {
    let rs: NodeStatus =
      r.status === "fail" ? "fail" : r.status === "warn" || r.status === "error" ? "warn" : "ok";
    if (now() - r.generated_at > 3 * 3600) rs = "stale";
    if (RANK.indexOf(rs) > RANK.indexOf(s)) s = rs;
  }
  return s;
}

function uptime(node: MockNode, since: number): number | null {
  const ps = probesOf(node, since, 5000);
  if (ps.length === 0) return null;
  return ps.filter((p) => p.ok).length / ps.length;
}

function listItem(node: MockNode): NodeListItem {
  return {
    id: node.id,
    name: node.name,
    addr: node.addr,
    node_key: node.node_key,
    fingerprint: formatFingerprint(node.node_key),
    labels: node.labels,
    status: nodeStatus(node),
    paused: node.paused,
    last_probe: lastProbe(node),
    last_report: node.reports[0] ? summary(node.reports[0]) : null,
    uptime_24h: uptime(node, now() - 86400),
  };
}

function detail(node: MockNode): NodeDetail {
  return {
    ...listItem(node),
    notes: node.notes,
    probe_interval_secs: node.probe_interval_secs,
    created_at: node.created_at,
    updated_at: node.updated_at,
    latest_report: node.reports[0] ?? null,
    has_ingest_token: node.hasToken,
  };
}

function overview(): Overview {
  const by_status: Record<NodeStatus, number> = { ok: 0, unknown: 0, warn: 0, stale: 0, fail: 0 };
  const t = now();
  const hourStart = t - (t % 3600) - 23 * 3600;
  const tiles = nodes.map((n) => {
    const item = listItem(n);
    by_status[item.status]++;
    const ps = probesOf(n, hourStart, 5000);
    const spark = Array.from({ length: 24 }, (_, h) => {
      const inHour = ps.filter(
        (p) => p.at >= hourStart + h * 3600 && p.at < hourStart + (h + 1) * 3600,
      );
      return inHour.length ? inHour.filter((p) => p.ok).length / inHour.length : -1;
    });
    return {
      id: n.id,
      name: n.name,
      status: item.status,
      handshake_ms: item.last_probe?.handshake_ms ?? null,
      uptime_24h: item.uptime_24h,
      spark,
    };
  });
  const latency = Array.from({ length: 24 }, (_, h) => {
    const at = hourStart + h * 3600;
    const vals = nodes
      .flatMap((n) =>
        probesOf(n, at, 5000).filter((p) => p.at < at + 3600 && p.handshake_ms !== null),
      )
      .map((p) => p.handshake_ms!)
      .sort((a, b) => a - b);
    return { at, handshake_ms_p50: vals.length ? vals[Math.floor(vals.length / 2)]! : null };
  });
  const ams = nodes[2]!;
  const fra = nodes[1]!;
  const lab = nodes[3]!;
  const events: OverviewEvent[] = [
    {
      at: T0 - 2.5 * 3600,
      node_id: ams.id,
      node_name: ams.name,
      kind: "status_changed",
      from: "ok",
      to: "fail",
      summary: "Проба: рукопожатие не прошло — нода ответила другим ключом",
    },
    {
      at: T0 - 2.4 * 3600,
      node_id: ams.id,
      node_name: ams.name,
      kind: "report_problem",
      summary: "identity.secret: ключ сгенерирован заново при старте",
    },
    {
      at: T0 - 5 * 3600,
      node_id: fra.id,
      node_name: fra.name,
      kind: "report_problem",
      summary: "host.blob_reserve: QUOTA блобов больше свободного места",
    },
    {
      at: T0 - 6 * 3600,
      node_id: fra.id,
      node_name: fra.name,
      kind: "status_changed",
      from: "ok",
      to: "warn",
      summary: "host.disk: свободно 6%",
    },
    {
      at: T0 - 4 * 3600,
      node_id: lab.id,
      node_name: lab.name,
      kind: "status_changed",
      from: "ok",
      to: "stale",
      summary: "Отчётов нет больше 3 часов",
    },
    {
      at: T0 - 30 * 3600,
      node_id: fra.id,
      node_name: fra.name,
      kind: "status_changed",
      from: "fail",
      to: "ok",
      summary: "Проба снова проходит",
    },
  ].sort((a, b) => b.at - a.at) as OverviewEvent[];
  return { nodes: { total: nodes.length, by_status }, tiles, events, latency };
}

// ---------- audit ----------

const ACTIONS = [
  "auth.login",
  "node.updated",
  "auth.login_failed",
  "node.created",
  "node.token_rotated",
  "user.invited",
  "auth.logout",
  "user.updated",
  "auth.totp_enabled",
  "node.deleted",
];
const audit: AuditEntry[] = Array.from({ length: 230 }, (_, i) => {
  const action = ACTIONS[Math.floor(hash(i * 13) * ACTIONS.length)]!;
  const node = nodes[i % nodes.length]!;
  const isNode = action.startsWith("node.");
  return {
    id: ulid(50_000 + i),
    at: T0 - i * 1800 - Math.floor(hash(i) * 900),
    user: action === "auth.login_failed" ? null : users[i % 2]!.username,
    action,
    target: isNode ? node.name : action.startsWith("user.") ? "carol" : null,
    details: isNode
      ? { node_id: node.id, fields: ["labels"] }
      : action === "auth.login_failed"
        ? { username: "root", reason: "bad_password" }
        : {},
    ip: action === "auth.login_failed" ? "198.51.100.7" : "10.0.0." + ((i % 20) + 2),
  };
});

function addAudit(action: string, target: string | null, details: Record<string, unknown> = {}) {
  const u = users.find((x) => x.id === sessionUserId);
  audit.unshift({
    id: ulid(),
    at: now(),
    user: u?.username ?? null,
    action,
    target,
    details,
    ip: "127.0.0.1",
  });
}

// ---------- HTTP plumbing ----------

function json(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body ?? {}), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function err(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return json(status, { error: { code, message } }, headers);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function me(): MockUser | null {
  return users.find((u) => u.id === sessionUserId && !u.disabled) ?? null;
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, admin: 1, owner: 2 };

function validNodeInput(b: Record<string, unknown>, partial: boolean): string | null {
  if (!partial || b.addr !== undefined) {
    if (typeof b.addr !== "string" || !/^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):\d{1,5}$/.test(b.addr))
      return "addr: ожидается host:port";
  }
  if (!partial || b.node_key !== undefined) {
    if (typeof b.node_key !== "string" || !/^[0-9a-fA-F]{64}$/.test(b.node_key))
      return "node_key: ожидается 64 hex";
  }
  if (!partial || b.name !== undefined) {
    if (typeof b.name !== "string" || b.name.trim().length < 1 || b.name.length > 64)
      return "name: 1–64 символа";
  }
  return null;
}

function runProbe(node: MockNode): Probe {
  const at = now();
  const down = node.addr.includes("down");
  const bad = node.addr.includes("bad");
  const ok = !down && !bad && node.profile !== "fail";
  const p: Probe = {
    id: ulid(),
    at,
    ok,
    stage: ok ? null : down ? "connect" : "handshake",
    error: ok
      ? null
      : down
        ? "connect: connection refused"
        : "noise: handshake failed — pin mismatch?",
    connect_ms: down ? null : 14 + Math.round(Math.random() * 20),
    handshake_ms: ok ? 30 + Math.round(Math.random() * 40) : null,
    config: ok ? CONFIG : null,
  };
  node.manualProbes.push(p);
  return p;
}

export async function mockFetch(method: string, path: string, rawBody?: string): Promise<Response> {
  await sleep(120 + Math.random() * 260);
  const url = new URL(path, "http://mock");
  const p = url.pathname;
  const body = (rawBody ? JSON.parse(rawBody) : {}) as Record<string, unknown>;
  const route = `${method} ${p}`;
  let m: RegExpMatchArray | null;

  if (route === "GET /health") return json(200, { status: "ok", version: "0.1.0-mock" });
  if (route === "GET /setup") return json(200, { needed: false });
  if (route === "POST /setup") return err(409, "conflict", "setup already completed");

  if (route === "POST /auth/login") {
    const u = users.find((x) => x.username === body.username);
    if (!u || u.disabled || typeof body.password !== "string" || body.password.length === 0) {
      return err(401, "unauthorized", "invalid credentials");
    }
    if (u.totp_enabled && !(typeof body.totp === "string" && /^\d{6}$/.test(body.totp))) {
      return err(401, "totp_required", "totp code required");
    }
    sessionUserId = u.id;
    u.last_login_at = now();
    addAudit("auth.login", null);
    return json(200, { user: publicUser(u) });
  }

  if (route === "GET /invite") {
    return url.searchParams.get("token") === "demo"
      ? json(200, { username: "carol" })
      : err(404, "not_found", "invite not found");
  }
  if (route === "POST /invite") {
    if (body.token !== "demo") return err(404, "not_found", "invite not found");
    const u = users[2]!;
    sessionUserId = u.id;
    return json(200, { user: publicUser(u) });
  }

  const user = me();
  if (!user) return err(401, "unauthorized", "no session");
  const isAdmin = ROLE_RANK[user.role] >= ROLE_RANK.admin;
  const isOwner = user.role === "owner";
  const forbidden = () => err(403, "forbidden", "role does not allow this");

  if (route === "GET /auth/me") return json(200, { user: publicUser(user) });
  if (route === "POST /auth/logout") {
    addAudit("auth.logout", null);
    sessionUserId = null;
    return json(204);
  }
  if (route === "POST /auth/totp/setup") {
    pendingTotp = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    return json(200, {
      secret: pendingTotp,
      otpauth_uri: `otpauth://totp/TrustMe%20Admin:${user.username}?secret=${pendingTotp}&issuer=TrustMe%20Admin`,
    });
  }
  if (route === "POST /auth/totp/enable") {
    if (!pendingTotp || typeof body.code !== "string" || !/^\d{6}$/.test(body.code))
      return err(400, "invalid_input", "code: неверный код");
    user.totp_enabled = true;
    pendingTotp = null;
    addAudit("auth.totp_enabled", user.username);
    return json(200, { user: publicUser(user) });
  }
  if (route === "POST /auth/totp/disable") {
    if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code))
      return err(400, "invalid_input", "code: неверный код");
    user.totp_enabled = false;
    addAudit("auth.totp_disabled", user.username);
    return json(200, { user: publicUser(user) });
  }
  if (route === "POST /auth/password") {
    if (typeof body.new !== "string" || body.new.length < 10)
      return err(400, "invalid_input", "new: минимум 10 символов");
    if (body.current === body.new) return err(400, "invalid_input", "new: совпадает с текущим");
    addAudit("auth.password_changed", user.username);
    return json(204);
  }

  if (route === "GET /overview") return json(200, overview());
  if (route === "GET /nodes")
    return json(200, {
      nodes: [...nodes].sort((a, b) => a.name.localeCompare(b.name)).map(listItem),
    });
  if (route === "POST /nodes") {
    if (!isAdmin) return forbidden();
    const bad = validNodeInput(body, false);
    if (bad) return err(400, "invalid_input", bad);
    if (nodes.some((n) => n.addr === body.addr))
      return err(409, "conflict", "нода с таким addr уже есть");
    const seed = 1000 + nodes.length;
    const n = mkNode(
      seed,
      String(body.name),
      String(body.addr),
      "created",
      (body.labels as Record<string, string>) ?? {},
      {
        node_key: String(body.node_key).toLowerCase(),
        created_at: now(),
        updated_at: now(),
        hasToken: true,
        probe_interval_secs:
          typeof body.probe_interval_secs === "number" ? body.probe_interval_secs : 60,
      },
    );
    nodes.push(n);
    addAudit("node.created", n.name, { node_id: n.id });
    return json(201, { node: detail(n), ingest_token: token("tmi_") });
  }

  if ((m = p.match(/^\/nodes\/([^/]+)(\/.*)?$/))) {
    const node = nodes.find((n) => n.id === m![1]);
    if (!node) return err(404, "not_found", "node not found");
    const sub = m[2] ?? "";
    if (method === "GET" && sub === "") return json(200, { node: detail(node) });
    if (method === "PATCH" && sub === "") {
      if (!isAdmin) return forbidden();
      const bad = validNodeInput(body, true);
      if (bad) return err(400, "invalid_input", bad);
      const allowed = [
        "name",
        "addr",
        "node_key",
        "labels",
        "notes",
        "probe_interval_secs",
        "paused",
      ] as const;
      for (const k of allowed)
        if (body[k] !== undefined) (node as unknown as Record<string, unknown>)[k] = body[k];
      node.updated_at = now();
      addAudit("node.updated", node.name, { node_id: node.id, fields: Object.keys(body) });
      return json(200, { node: detail(node) });
    }
    if (method === "DELETE" && sub === "") {
      if (!isAdmin) return forbidden();
      nodes.splice(nodes.indexOf(node), 1);
      addAudit("node.deleted", node.name, { node_id: node.id });
      return json(204);
    }
    if (method === "POST" && sub === "/probe") {
      if (!isAdmin) return forbidden();
      await sleep(900 + Math.random() * 900);
      return json(200, { probe: runProbe(node) });
    }
    if (method === "GET" && sub === "/probes") {
      const since = Number(url.searchParams.get("since") ?? now() - 86400);
      const limit = Math.min(5000, Number(url.searchParams.get("limit") ?? 1000));
      return json(200, { probes: probesOf(node, since, limit) });
    }
    if (method === "GET" && sub === "/reports") {
      const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 50));
      return json(200, { reports: node.reports.slice(0, limit).map(summary) });
    }
    const rm = sub.match(/^\/reports\/([^/]+)$/);
    if (method === "GET" && rm) {
      const r = node.reports.find((x) => x.id === rm[1]);
      return r ? json(200, { report: r }) : err(404, "not_found", "report not found");
    }
    if (method === "POST" && sub === "/ingest-token") {
      if (!isAdmin) return forbidden();
      node.hasToken = true;
      addAudit("node.token_rotated", node.name, { node_id: node.id });
      return json(200, { ingest_token: token("tmi_") });
    }
  }

  if (route === "GET /audit") {
    if (!isAdmin) return forbidden();
    const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 100));
    const before = url.searchParams.get("before");
    const list = before ? audit.filter((e) => e.at < Number(before)) : audit;
    return json(200, { entries: list.slice(0, limit) });
  }

  if (route === "GET /users") {
    if (!isOwner) return forbidden();
    return json(200, { users: users.map(publicUser) });
  }
  if (route === "POST /users") {
    if (!isOwner) return forbidden();
    if (typeof body.username !== "string" || !body.username.trim())
      return err(400, "invalid_input", "username: обязательно");
    if (users.some((u) => u.username === body.username))
      return err(409, "conflict", "пользователь уже существует");
    const u: MockUser = {
      id: ulid(),
      username: body.username,
      role: (body.role as Role) ?? "viewer",
      totp_enabled: false,
      disabled: false,
      created_at: now(),
      last_login_at: null,
    };
    users.push(u);
    addAudit("user.invited", u.username);
    return json(201, { user: publicUser(u), invite_url: `/invite?token=${token("inv_")}` });
  }
  if ((m = p.match(/^\/users\/([^/]+)$/))) {
    if (!isOwner) return forbidden();
    const target = users.find((u) => u.id === m![1]);
    if (!target) return err(404, "not_found", "user not found");
    if (method === "PATCH") {
      const owners = users.filter((u) => u.role === "owner" && !u.disabled);
      const demotes = (body.role !== undefined && body.role !== "owner") || body.disabled === true;
      if (target.role === "owner" && demotes && owners.length <= 1)
        return err(409, "conflict", "нельзя понизить или заблокировать последнего владельца");
      if (body.role !== undefined) target.role = body.role as Role;
      if (body.disabled !== undefined) target.disabled = Boolean(body.disabled);
      addAudit("user.updated", target.username, body);
      return json(200, { user: publicUser(target) });
    }
    if (method === "DELETE") {
      if (target.id === user.id) return err(409, "conflict", "нельзя удалить себя");
      users.splice(users.indexOf(target), 1);
      addAudit("user.deleted", target.username);
      return json(204);
    }
  }

  return err(404, "not_found", `mock: no route for ${route}`);
}
