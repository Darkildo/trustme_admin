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
  BlobReserve,
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
  Setting,
  Settings,
  ProvisionInfo,
  Job,
  NodeRuntime,
  EnrollInfo,
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

let idSeq = 10_000;
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

type Scenario = "healthy" | "warn" | "fail" | "stale" | "new" | "created" | "provisioning";

interface MockAgent {
  hostname: string;
  arch: string;
  tmnode_version: string;
  enrolled_at: number;
  /** Heartbeats keep coming (last_seen_at follows the clock). */
  live: boolean;
  last_seen_at: number | null;
}

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
  scenario: Scenario;
  baseLatency: number;
  hasToken: boolean;
  reports: Report[];
  manualProbes: Probe[];
  // ---- stage 2: limits, TURN, agent ----
  /** null — follows the default profile. */
  profileId: string | null;
  overrides: Settings;
  turnIds: string[];
  agent: MockAgent | null;
  provision: ProvisionInfo | null;
  desiredRev: number;
  desiredAt: number;
  appliedRev: number | null;
  appliedAt: number;
  applyError: string | null;
  restartPending: string[];
  /** restart-scope keys changed by a version the agent has not applied yet. */
  restartQueued: string[];
  /** GET /nodes/{id} polls counted since the install command was issued; null — not counting. */
  enrollPolls: number | null;
  flipAfter: number;
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
      data: { available_bytes: 152_000_000_000, total_bytes: 214_000_000_000 },
    },
    { id: "host.memory", status: "ok", summary: "Память: занято 38% из 4 ГиБ" },
    {
      id: "host.blob_reserve",
      status: "ok",
      summary: "Свободно 141.6 ГиБ при резерве 5.0 ГиБ",
      data: {
        available_bytes: 152_000_000_000,
        reserve_bytes: 5 * 1024 ** 3,
        host_path: "/var/lib/trustme/blobs",
      },
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

/** Маленький диск fra-edge: свободного места меньше резерва по умолчанию (5 ГиБ). */
const FRA_DISK = 13.5 * 1024 ** 3;
const FRA_FREE = 4.4 * 1024 ** 3;

function checksFor(scenario: Scenario, variant: number): Check[] {
  let c = baseChecks();
  if (scenario === "warn") {
    c = patch(c, "host.disk", {
      summary: "Диск /var/lib/trustme: свободно 33% (4.4 ГиБ из 13.5 ГиБ)",
      data: { available_bytes: FRA_FREE, total_bytes: FRA_DISK },
    });
    c = patch(c, "host.blob_reserve", {
      status: "warn",
      summary: "Свободно 4.4 ГиБ при резерве 5.0 ГиБ: загрузка файлов получает QUOTA",
      hint: "Уменьшите BLOB_DISK_RESERVE_BYTES или освободите место на томе.",
      data: {
        available_bytes: FRA_FREE,
        reserve_bytes: 5 * 1024 ** 3,
        host_path: "/var/lib/trustme/blobs",
      },
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
  if (scenario === "fail") {
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
  if (scenario === "stale") {
    c = patch(c, "runtime.metrics", { status: "skip", summary: "Метрики отключены в конфиге" });
    // Малина без агента: резерв подобрать нельзя, только подсказка про окружение.
    c = patch(c, "host.disk", {
      summary: "Диск /var/lib/trustme: свободно 7% (2.1 ГиБ из 29.7 ГиБ)",
      data: { available_bytes: 2_254_857_830, total_bytes: 31_890_145_280 },
    });
    c = patch(c, "host.blob_reserve", {
      status: "warn",
      summary: "Свободно 2.1 ГиБ при резерве 5.0 ГиБ: загрузка файлов получает QUOTA",
      data: {
        available_bytes: 2_254_857_830,
        reserve_bytes: 5 * 1024 ** 3,
        host_path: "/var/lib/trustme/blobs",
      },
    });
  }
  return c;
}

function makeReport(node: MockNode, at: number, variant: number): Report {
  const checks = checksFor(node.scenario, variant);
  return {
    id: ulid(node.seed * 10_000 + variant),
    received_at: at + 2,
    generated_at: at,
    status: worst(checks),
    tmnode_version: node.scenario === "warn" ? "0.4.2" : "0.5.0",
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
  scenario: Scenario,
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
    scenario,
    baseLatency: 18 + seed * 9,
    hasToken: scenario !== "new",
    reports: [],
    manualProbes: [],
    profileId: null,
    overrides: {},
    turnIds: [],
    agent: null,
    provision: null,
    desiredRev: 1,
    desiredAt: T0 - 86400,
    appliedRev: null,
    appliedAt: 0,
    applyError: null,
    restartPending: [],
    restartQueued: [],
    enrollPolls: null,
    flipAfter: 8,
    ...extra,
  };
  if (scenario !== "new" && scenario !== "created" && scenario !== "provisioning") {
    const lastAt = scenario === "stale" ? T0 - 3600 * 7 : T0 - 140;
    for (let i = 0; i < 40; i++) node.reports.push(makeReport(node, lastAt - i * 300, i));
  }
  return node;
}

// ---------- limits catalog, profiles, TURN ----------

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;
const TIB = GIB * 1024;
const DAY = 86_400;
const COUNT_MAX = 1_000_000_000;
const RATE_MAX = 1_000_000;

type Row = [
  key: string,
  group: Setting["group"],
  unit: Setting["unit"],
  scope: Setting["scope"],
  min: number,
  max: number,
  zero: boolean,
  def: number,
  summary: string,
];

// Mirrors the node catalog (trustme_backend src/runtime/catalog.rs).
// prettier-ignore
const CATALOG_ROWS: Row[] = [
  ["ttl_min_seconds", "messages", "seconds", "hot", 1, 365 * DAY, true, 86400, "Минимальный срок жизни сообщения: депозит с меньшим ttl отклоняется"],
  ["quota_max_messages_per_queue", "messages", "count", "hot", 1, COUNT_MAX, true, 10000, "Потолок сообщений в одной очереди (прямой бэкенд)"],
  ["quota_max_bytes_per_queue", "messages", "bytes", "hot", KIB, TIB, true, 64 * MIB, "Потолок объёма одной очереди (прямой бэкенд)"],
  ["quota_max_messages_sender_pair", "messages", "count", "hot", 1, COUNT_MAX, true, 2000, "Сколько сообщений один отправитель держит в очередях одного получателя"],
  ["rate_limit_send_msgs_per_sec", "messages", "per_second", "hot", 1, RATE_MAX, true, 100, "Отправка: сообщений в секунду на пользователя"],
  ["rate_limit_send_bytes_per_day", "messages", "bytes_per_day", "hot", MIB, 100 * TIB, true, 256 * MIB, "Отправка: байт в сутки на пользователя"],
  ["limit_max_sessions_per_user", "sessions", "count", "hot", 1, 100_000, true, 64, "Одновременных сессий одного пользователя"],
  ["session_confirm_timeout_secs", "sessions", "seconds", "new_sessions", 1, 600, false, 30, "Сколько нода ждёт первый кадр клиента после входа"],
  ["limit_ping_per_sec", "sessions", "per_second", "new_sessions", 1, RATE_MAX, true, 50, "Ping в секунду на соединение"],
  ["limit_control_per_sec", "sessions", "per_second", "new_sessions", 1, RATE_MAX, true, 50, "Управляющих кадров очередей в секунду на соединение"],
  ["max_queues_per_user", "sessions", "count", "hot", 1, COUNT_MAX, true, 1024, "Очередей на пользователя — по сути потолок контактов"],
  ["max_push_devices_per_user", "sessions", "count", "hot", 1, 100_000, true, 32, "Устройств с push-токенами на пользователя"],
  ["limit_max_connections", "network", "count", "hot", 1, COUNT_MAX, true, 4096, "Открытых TCP-соединений на ноду"],
  ["limit_handshake_inflight", "network", "count", "hot", 1, COUNT_MAX, true, 256, "Одновременных хендшейков на ноду"],
  ["limit_handshake_inflight_per_ip", "network", "count", "hot", 1, COUNT_MAX, true, 32, "Одновременных хендшейков с одного IP (за общим NAT — выше)"],
  ["tcp_keepalive_secs", "network", "seconds", "new_sessions", 1, 32_767, true, 60, "Простой до первой keepalive-пробы (0 — без keepalive)"],
  ["tcp_keepalive_interval_secs", "network", "seconds", "new_sessions", 1, 32_767, false, 15, "Интервал между keepalive-пробами"],
  ["tcp_keepalive_retries", "network", "count", "new_sessions", 1, 127, false, 4, "Неотвеченных keepalive-проб до разрыва"],
  ["tcp_user_timeout_secs", "network", "seconds", "new_sessions", 1, 3600, true, 120, "Сколько записанное нодой может ждать TCP-подтверждения (0 — системное)"],
  ["blob_max_size_bytes", "blobs", "bytes", "hot", KIB, TIB, false, 2 * GIB, "Потолок одного файла"],
  ["blob_max_ttl_secs", "blobs", "seconds", "hot", 60, 3650 * DAY, false, 30 * DAY, "Потолок срока жизни файла"],
  ["blob_quota_per_owner_bytes", "blobs", "bytes", "hot", MIB, 100 * TIB, true, 2 * GIB, "Квота файлов на владельца"],
  ["blob_quota_per_pair_bytes", "blobs", "bytes", "hot", MIB, 100 * TIB, true, GIB, "Квота загрузившего в ящик одного получателя"],
  ["blob_upload_bytes_per_day", "blobs", "bytes_per_day", "hot", MIB, 100 * TIB, true, 4 * GIB, "Загрузка файлов: байт в сутки на пользователя"],
  ["blob_disk_reserve_bytes", "blobs", "bytes", "hot", MIB, 100 * TIB, true, 5 * GIB, "Свободное место, ниже которого загрузки получают QUOTA"],
  ["blob_tombstone_secs", "blobs", "seconds", "hot", 60, 3650 * DAY, true, 30 * DAY, "Сколько помнить удалённый или истёкший файл"],
  ["max_blob_sessions_per_user", "blobs", "count", "new_sessions", 1, 10_000, true, 4, "Одновременных сессий передачи файлов одного пользователя"],
  ["blob_get_window_bytes", "blobs", "bytes", "hot", 64 * KIB, GIB, false, 8 * MIB, "Окно скачивания: сколько нода шлёт без подтверждения"],
  ["blob_sync_every_bytes", "blobs", "bytes", "hot", 64 * KIB, GIB, false, 4 * MIB, "Шаг fsync при загрузке"],
  ["blob_ops_per_sec", "blobs", "per_second", "hot", 1, RATE_MAX, true, 50, "Операций хранилища в секунду на пользователя"],
  ["blob_stat_per_sec", "blobs", "per_second", "hot", 1, RATE_MAX, true, 20, "BlobStat в секунду на пользователя"],
  ["blob_upload_stale_secs", "blobs", "seconds", "restart", 60, 365 * DAY, false, DAY, "Через сколько брошенная загрузка удаляется (входит в индекс сроков)"],
  ["blob_min_charge_bytes", "blobs", "bytes", "restart", 1, GIB, true, 64 * KIB, "Минимальный учётный размер файла в квотах (входит в счётчики квот)"],
  ["blob_chunk_max_bytes", "blobs", "bytes", "restart", 4 * KIB, 64 * MIB, false, MIB, "Потолок куска загрузки и скачивания (объявляется клиентам)"],
  ["device_cert_max_ttl_seconds", "security", "seconds", "restart", 60, 3650 * DAY, true, 30 * DAY, "Потолок срока сертификата устройства (0 — делегированный вход выключен)"],
  ["server_config_ttl_seconds", "security", "seconds", "restart", 60, 30 * DAY, false, DAY, "Срок жизни подписанного конфига у клиента"],
  ["ice_credential_ttl_secs", "calls", "seconds", "hot", 300, DAY, false, 7200, "Срок временной учётки TURN; звонок длиннее продлевается ICE restart"],
];

const CATALOG: Setting[] = CATALOG_ROWS.map(
  ([key, group, unit, scope, min, max, zero, def, summary]) => ({
    key,
    env: key.toUpperCase(),
    group,
    unit,
    scope,
    min,
    max,
    zero_unlimited: zero,
    default: def,
    summary,
  }),
);
const CATALOG_BY_KEY = new Map(CATALOG.map((c) => [c.key, c]));

/** The node's own check plus one cross-field rule, like the server's `check_settings`. */
function checkSettings(values: unknown, base: Settings = {}): string | null {
  if (typeof values !== "object" || values === null || Array.isArray(values))
    return "settings: ожидается объект";
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    const c = CATALOG_BY_KEY.get(key);
    if (!c) return `${key}: неизвестная настройка`;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
      return `${key}: ожидается целое неотрицательное число`;
    if (value === 0 && c.zero_unlimited) continue;
    if (value < c.min || value > c.max) {
      const zero = c.zero_unlimited ? " (или 0 — без ограничения)" : "";
      return `${key}: от ${c.min} до ${c.max}${zero}, получено ${value}`;
    }
  }
  const merged: Settings = { ...base, ...(values as Settings) };
  const get = (k: string) => merged[k] ?? CATALOG_BY_KEY.get(k)!.default;
  if (get("blob_get_window_bytes") < get("blob_chunk_max_bytes"))
    return `blob_get_window_bytes: окно скачивания (${get("blob_get_window_bytes")}) меньше куска blob_chunk_max_bytes (${get("blob_chunk_max_bytes")})`;
  return null;
}

interface MockProfile {
  id: string;
  name: string;
  settings: Settings;
  is_default: boolean;
  created_at: number;
  updated_at: number;
}

const profiles: MockProfile[] = [
  {
    id: ulid(9001),
    name: "Стандарт",
    settings: { rate_limit_send_msgs_per_sec: 50, blob_quota_per_owner_bytes: 4 * GIB },
    is_default: true,
    created_at: T0 - 40 * DAY,
    updated_at: T0 - 6 * DAY,
  },
  {
    id: ulid(9002),
    name: "Нагруженные",
    settings: {
      limit_max_connections: 20_000,
      limit_handshake_inflight: 1024,
      rate_limit_send_msgs_per_sec: 200,
      quota_max_bytes_per_queue: 256 * MIB,
      blob_max_size_bytes: 4 * GIB,
      blob_disk_reserve_bytes: 20 * GIB,
    },
    is_default: false,
    created_at: T0 - 30 * DAY,
    updated_at: T0 - 2 * DAY,
  },
  {
    id: ulid(9003),
    name: "Лаборатория",
    settings: {
      limit_max_connections: 256,
      blob_max_size_bytes: 256 * MIB,
      blob_quota_per_owner_bytes: GIB,
      ice_credential_ttl_secs: 3600,
      device_cert_max_ttl_seconds: 0,
    },
    is_default: false,
    created_at: T0 - 12 * DAY,
    updated_at: T0 - 12 * DAY,
  },
];

function defaultProfile(): MockProfile {
  return profiles.find((p) => p.is_default) ?? profiles[0]!;
}

interface MockTurn {
  id: string;
  name: string;
  urls: string[];
  secret: string | null;
  managedBy: string | null;
  created_at: number;
}

const turnServers: MockTurn[] = [
  {
    id: ulid(9101),
    name: "coturn · msk-1",
    urls: [
      "stun:msk-1.trustme.example:3478",
      "turn:msk-1.trustme.example:3478?transport=udp",
      "turn:msk-1.trustme.example:3478?transport=tcp",
    ],
    secret: token("ts_"),
    managedBy: ulid(101),
    created_at: T0 - 11 * DAY,
  },
  {
    id: ulid(9102),
    name: "turn-eu",
    urls: ["turns:turn-eu.example.org:5349", "turn:turn-eu.example.org:3478?transport=udp"],
    secret: token("ts_"),
    managedBy: null,
    created_at: T0 - 20 * DAY,
  },
  {
    id: ulid(9103),
    name: "stun-public",
    urls: ["stun:stun.example.net:3478"],
    secret: null,
    managedBy: null,
    created_at: T0 - 25 * DAY,
  },
];

const liveAgent = (hostname: string, arch = "x86_64", version = "0.5.0"): MockAgent => ({
  hostname,
  arch,
  tmnode_version: version,
  enrolled_at: T0 - 9 * DAY,
  live: true,
  last_seen_at: T0,
});

const nodes: MockNode[] = [
  mkNode(
    1,
    "msk-1",
    "msk-1.trustme.example:7443",
    "healthy",
    { env: "prod", region: "ru" },
    {
      notes: "Основная нода, Москва. Бэкенд JetStream.",
      profileId: ulid(9002),
      overrides: { limit_max_connections: 30_000 },
      turnIds: [ulid(9101), ulid(9102), ulid(9103)],
      agent: liveAgent("msk-1"),
      provision: {
        public_host: "msk-1.trustme.example",
        port: 7443,
        backend: "jetstream",
        with_turn: true,
      },
      desiredRev: 4,
      desiredAt: T0 - 3 * 3600,
      appliedRev: 4,
      appliedAt: T0 - 3 * 3600 + 21,
    },
  ),
  mkNode(
    2,
    "fra-edge",
    "fra.trustme.example:7443",
    "warn",
    { env: "prod", region: "eu" },
    {
      baseLatency: 64,
      overrides: { blob_get_window_bytes: 4 * MIB, blob_chunk_max_bytes: 8 * MIB },
      turnIds: [ulid(9102)],
      agent: liveAgent("fra-edge", "aarch64", "0.4.2"),
      provision: {
        public_host: "fra.trustme.example",
        port: 7443,
        backend: "sled",
        with_turn: false,
      },
      desiredRev: 7,
      desiredAt: T0 - 40 * 60,
      appliedRev: 7,
      appliedAt: T0 - 40 * 60 + 18,
      applyError:
        "runtime.toml: blob_get_window_bytes (4 MiB) меньше blob_chunk_max_bytes (8 MiB) — окно скачивания должно вмещать кусок",
    },
  ),
  mkNode(
    3,
    "ams-relay",
    "203.0.113.24:7443",
    "fail",
    { env: "prod", region: "eu", role: "relay" },
    {
      profileId: ulid(9002),
      turnIds: [ulid(9102), ulid(9103)],
      agent: { ...liveAgent("ams-relay"), live: false, last_seen_at: T0 - 2.6 * 3600 },
      provision: { public_host: "203.0.113.24", port: 7443, backend: "sled", with_turn: false },
      desiredRev: 3,
      desiredAt: T0 - 1800,
      appliedRev: 2,
      appliedAt: T0 - 5 * DAY,
    },
  ),
  mkNode(
    4,
    "lab-pi",
    "192.168.1.50:7443",
    "stale",
    { env: "lab" },
    { paused: true, probe_interval_secs: 300, profileId: ulid(9003) },
  ),
  mkNode(
    5,
    "spb-2",
    "[2001:db8::42]:7443",
    "healthy",
    { env: "staging", region: "ru" },
    {
      baseLatency: 27,
      overrides: { blob_chunk_max_bytes: 2 * MIB, device_cert_max_ttl_seconds: 7 * DAY },
      turnIds: [ulid(9103)],
      agent: liveAgent("spb-2.internal"),
      provision: { public_host: "2001:db8::42", port: 7443, backend: "sled", with_turn: false },
      desiredRev: 2,
      desiredAt: T0 - 2 * 3600,
      appliedRev: 2,
      appliedAt: T0 - 2 * 3600 + 25,
      restartPending: ["blob_chunk_max_bytes", "device_cert_max_ttl_seconds"],
    },
  ),
  mkNode(6, "nyc-new", "nyc.trustme.example:7443", "new", { env: "staging", region: "us" }),
  mkNode(
    7,
    "hel-new",
    "95.217.0.42:18081",
    "provisioning",
    { env: "staging", region: "eu" },
    {
      node_key: "",
      hasToken: false,
      provision: { public_host: "95.217.0.42", port: 18081, backend: "sled", with_turn: true },
      created_at: T0 - 3 * 3600,
      updated_at: T0 - 3 * 3600,
    },
  ),
];

function noHistory(node: MockNode): boolean {
  return node.scenario === "new" || node.scenario === "created" || node.scenario === "provisioning";
}

function probeAt(node: MockNode, at: number): Probe {
  const r = hash(node.seed * 1_000_003 + at);
  const r2 = hash(node.seed * 7919 + at * 3);
  let ok = true;
  let stage: ProbeStage | null = null;
  let error: string | null = null;
  if (node.scenario === "fail" && at > T0 - 2.5 * 3600) {
    ok = false;
    stage = "handshake";
    error =
      "noise: handshake failed — the node answered with a different static key (pin mismatch?)";
  } else if (node.scenario === "warn" && r < 0.04) {
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
  if (noHistory(node)) {
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
  if (noHistory(node)) return m ?? null;
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
    provisioning: node.node_key === "",
    agent: node.agent
      ? { last_seen_at: agentSeen(node.agent), hostname: node.agent.hostname }
      : null,
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

// ---------- stage 2: runtime, agents, install ----------

/** Seconds after a save before a live agent reports the version as applied. */
const APPLY_DELAY = 6;

function agentSeen(a: MockAgent): number | null {
  if (!a.live) return a.last_seen_at;
  const t = now();
  return t - (t % 30);
}

function agentOnline(a: MockAgent): boolean {
  const seen = agentSeen(a);
  return seen !== null && now() - seen <= 90;
}

function profileOf(node: MockNode): MockProfile {
  return profiles.find((p) => p.id === node.profileId) ?? defaultProfile();
}

function mergedOf(node: MockNode): Settings {
  return { ...profileOf(node).settings, ...node.overrides };
}

function versionOf(node: MockNode, rev: number): string {
  return hexKey(node.seed * 1000 + rev).slice(0, 12);
}

/** A new desired runtime.toml: restart-scope changes are remembered until it is applied. */
function bumpDesired(node: MockNode, before: Settings) {
  const after = mergedOf(node);
  for (const c of CATALOG) {
    if (
      c.scope === "restart" &&
      before[c.key] !== after[c.key] &&
      !node.restartQueued.includes(c.key)
    )
      node.restartQueued.push(c.key);
  }
  node.desiredRev++;
  node.desiredAt = now();
  node.updated_at = now();
}

function syncApply(node: MockNode) {
  if (!node.agent || !agentOnline(node.agent)) return;
  if (node.appliedRev !== node.desiredRev && now() - node.desiredAt >= APPLY_DELAY) {
    node.appliedRev = node.desiredRev;
    node.appliedAt = node.desiredAt + APPLY_DELAY;
    node.applyError = null;
    for (const k of node.restartQueued)
      if (!node.restartPending.includes(k)) node.restartPending.push(k);
    node.restartQueued = [];
  }
}

function runtimeView(node: MockNode): NodeRuntime {
  syncApply(node);
  const profile = profileOf(node);
  const merged = mergedOf(node);
  const agent = node.agent
    ? {
        hostname: node.agent.hostname,
        arch: node.agent.arch,
        tmnode_version: node.agent.tmnode_version,
        enrolled_at: node.agent.enrolled_at,
        last_seen_at: agentSeen(node.agent),
        online: agentOnline(node.agent),
      }
    : null;
  const applied =
    node.agent && node.appliedRev !== null
      ? {
          result: node.applyError ? ("invalid" as const) : ("applied" as const),
          version: versionOf(node, node.appliedRev),
          error: node.applyError,
          pending_restart: [...node.restartPending],
          at: node.appliedAt,
        }
      : null;
  const state: NodeRuntime["state"] = !agent
    ? "no_agent"
    : !applied
      ? "pending"
      : applied.result === "invalid"
        ? "invalid"
        : node.appliedRev === node.desiredRev
          ? "applied"
          : "pending";
  return {
    profile: { id: profile.id, name: profile.name },
    overrides: { ...node.overrides },
    settings: Object.keys(merged)
      .sort()
      .map((key) => ({
        key,
        value: merged[key]!,
        source: key in node.overrides ? ("override" as const) : ("profile" as const),
      })),
    turn_server_ids: [...node.turnIds].sort(),
    desired_version: versionOf(node, node.desiredRev),
    provision: node.provision,
    agent,
    applied,
    state,
  };
}

// ---------- резерв диска под файлы ----------

const RESERVE_STEP = 256 * MIB;
const RESERVE_MIN = 512 * MIB;
const RESERVE_MAX = 5 * GIB;

const numOrNull = (v: unknown): number | null => (typeof v === "number" ? v : null);

/**
 * Как на сервере: 10 % диска в пределах 512 MiB…5 GiB, кратно 256 MiB, и не больше половины
 * свободного места; меньше 512 MiB — диск почти полон, подбирать нечего.
 */
function suggestReserve(available: number, total: number): number | null {
  let s = Math.floor((total * 0.1) / RESERVE_STEP) * RESERVE_STEP;
  s = Math.min(Math.max(s, RESERVE_MIN), RESERVE_MAX);
  s = Math.min(s, Math.floor(available / 2 / RESERVE_STEP) * RESERVE_STEP);
  return s >= RESERVE_MIN ? s : null;
}

function blobReserveView(node: MockNode): BlobReserve {
  const checks = node.reports[0]?.checks ?? [];
  const check = checks.find((c) => c.id === "host.blob_reserve");
  const disk = checks.find((c) => c.id === "host.disk");
  const available = numOrNull(check?.data?.available_bytes);
  const reserve = numOrNull(check?.data?.reserve_bytes);
  const total = numOrNull(disk?.data?.total_bytes);
  const panel = mergedOf(node).blob_disk_reserve_bytes ?? null;
  let suggested: number | null = null;
  if (check?.status === "warn" && available !== null && total !== null) {
    suggested = suggestReserve(available, total);
    // В панели резерв уже не больше подобранного — подбирать нечего.
    if (suggested !== null && panel !== null && panel <= suggested) suggested = null;
  }
  return {
    available_bytes: available,
    total_bytes: total,
    reserve_bytes: reserve,
    suggested_bytes: suggested,
    panel_bytes: panel,
    managed: node.agent !== null,
  };
}

function profileJson(p: MockProfile) {
  const def = defaultProfile();
  return {
    ...p,
    settings: { ...p.settings },
    nodes: nodes.filter((n) => (n.profileId ?? def.id) === p.id).length,
  };
}

function turnJson(t: MockTurn) {
  const owner = t.managedBy ? nodes.find((n) => n.id === t.managedBy) : undefined;
  return {
    id: t.id,
    name: t.name,
    urls: [...t.urls],
    has_secret: t.secret !== null,
    managed_by_node: t.managedBy ? { id: t.managedBy, name: owner?.name ?? "?" } : null,
    nodes: nodes.filter((n) => n.turnIds.includes(t.id)).length,
    created_at: t.created_at,
  };
}

function checkTurn(urls: unknown, secret: string | null): string | null {
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > 8)
    return "urls: от 1 до 8 адресов";
  for (const u of urls) {
    if (typeof u !== "string" || !/^(stuns?|turns?):[^\s/]+$/i.test(u))
      return `${String(u)}: схема — stun:, stuns:, turn: или turns:`;
    if (/^turns?:/i.test(u) && (secret === null || secret.length < 16))
      return `${u}: для TURN нужен секрет не короче 16 символов`;
  }
  return null;
}

function panelUrl(): string {
  return typeof window === "undefined" ? "https://admin.example.org" : window.location.origin;
}

function issueEnroll(node: MockNode): EnrollInfo {
  const tok = token("tme_");
  if (node.node_key === "" && node.enrollPolls === null) node.enrollPolls = 0;
  return {
    token: tok,
    expires_at: now() + DAY,
    command: `curl -fsSL https://raw.githubusercontent.com/Darkildo/trustme_backend/stable/deploy/install.sh | sudo sh -s -- enroll --url ${panelUrl()} --token ${tok}`,
  };
}

/** The agent enrolled: the node gets its key, an agent, a first probe and (maybe) coturn. */
function enrollNode(node: MockNode) {
  node.node_key = hexKey(node.seed + 77);
  node.scenario = "created";
  node.enrollPolls = null;
  node.hasToken = true;
  node.agent = {
    hostname: node.name,
    arch: "x86_64",
    tmnode_version: "0.5.0",
    enrolled_at: now(),
    live: true,
    last_seen_at: now(),
  };
  node.desiredRev++;
  node.desiredAt = now();
  if (node.provision?.with_turn) {
    const host = node.provision.public_host;
    const t: MockTurn = {
      id: ulid(),
      name: `coturn · ${node.name}`,
      urls: [
        `stun:${host}:3478`,
        `turn:${host}:3478?transport=udp`,
        `turn:${host}:3478?transport=tcp`,
      ],
      secret: token("ts_"),
      managedBy: node.id,
      created_at: now(),
    };
    turnServers.push(t);
    node.turnIds.push(t.id);
  }
  runProbe(node);
  addAudit("agent.enrolled", node.name, { node_id: node.id });
}

interface MockJob extends Job {
  script: string[];
  step: number;
  /** Fail after this many steps: [step, error | null, exit code | null]. */
  failAt: [number, string | null, number | null] | null;
}

const jobs = new Map<string, MockJob>();

function installScript(node: MockNode, host: string): string[] {
  const p = node.provision!;
  const lines = [
    `host key: ssh-ed25519 SHA256:${btoa(hexKey(node.seed + 5).slice(0, 32)).slice(0, 43)} — принят при первом контакте\n`,
    `$ curl -fsSL https://raw.githubusercontent.com/Darkildo/trustme_backend/stable/deploy/install.sh | sudo sh -s -- enroll --url ${panelUrl()} --token tme_••••\n`,
    "==> TrustMe node installer (stable)\n==> System: Ubuntu 24.04 LTS, x86_64, 2 vCPU, 3.8 GiB RAM\n",
    "==> Installing Docker Engine 27.3\n    apt-get install docker-ce docker-ce-cli containerd.io … ok\n",
    "==> Pulling images\n    ghcr.io/darkildo/trust_message_tcp:0.5.0 … done\n",
  ];
  if (p.backend === "jetstream") lines.push("    nats:2.10-alpine … done\n");
  if (p.with_turn) lines.push("    coturn/coturn:4.6.3 … done\n");
  lines.push(
    `==> Writing /etc/trustme/node.toml (backend: ${p.backend}, listen 0.0.0.0:${p.port})\n`,
    "==> Generating node identity … done\n",
    "==> Installing tmnode agent 0.5.0 → /usr/local/bin/tmnode\n",
    `==> Enrolling with ${panelUrl()}\n    enrolled as ${node.name} (${host})\n`,
    `==> Starting services: message-service${p.backend === "jetstream" ? ", nats" : ""}${p.with_turn ? ", coturn" : ""}, tmnode-agent.timer\n`,
    `==> Done in 47 s. Node listens on ${host}:${p.port}\n`,
  );
  return lines;
}

function advanceJob(job: MockJob) {
  if (job.status !== "running") return;
  if (job.failAt && job.step >= job.failAt[0]) {
    job.status = "failed";
    job.error = job.failAt[1];
    job.exit_code = job.failAt[2];
    job.finished_at = now();
    return;
  }
  const line = job.script[job.step];
  if (line !== undefined) {
    job.output += line;
    job.step++;
    return;
  }
  job.status = "succeeded";
  job.exit_code = 0;
  job.finished_at = now();
  const node = nodes.find((n) => n.id === job.node_id);
  if (node && node.node_key === "") {
    node.enrollPolls = 0;
    node.flipAfter = 2;
  }
}

function publicJob(j: MockJob): Job {
  return {
    id: j.id,
    node_id: j.node_id,
    status: j.status,
    output: j.output,
    exit_code: j.exit_code,
    error: j.error,
    started_at: j.started_at,
    finished_at: j.finished_at,
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
      at: T0 - 2.55 * 3600,
      node_id: ams.id,
      node_name: ams.name,
      kind: "key_changed",
      summary: "ключ ноды на хосте сменился (3f9a1c2b…): клиенты с прежним пином не подключатся",
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
      summary: "host.blob_reserve: свободно 4.4 ГиБ при резерве 5.0 ГиБ",
    },
    {
      at: T0 - 6 * 3600,
      node_id: fra.id,
      node_name: fra.name,
      kind: "status_changed",
      from: "ok",
      to: "warn",
      summary: "host.memory: занято 91%, swap активен",
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
  "profile.updated",
  "turn.created",
  "node.provisioned",
  "agent.enrolled",
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
  const ok = !down && !bad && node.scenario !== "fail";
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
  if (route === "GET /catalog") return json(200, { settings: CATALOG });

  if (route === "GET /profiles") {
    const def = defaultProfile();
    const list = [
      def,
      ...profiles.filter((p) => p !== def).sort((a, b) => a.name.localeCompare(b.name)),
    ];
    return json(200, { profiles: list.map(profileJson) });
  }
  if (route === "POST /profiles") {
    if (!isAdmin) return forbidden();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 64) return err(400, "invalid_input", "name: от 1 до 64 символов");
    if (profiles.some((p) => p.name.toLowerCase() === name.toLowerCase()))
      return err(409, "conflict", `профиль «${name}» уже есть`);
    const settings = (body.settings ?? {}) as Settings;
    const bad = checkSettings(settings);
    if (bad) return err(400, "invalid_input", bad);
    const p: MockProfile = {
      id: ulid(),
      name,
      settings: { ...settings },
      is_default: false,
      created_at: now(),
      updated_at: now(),
    };
    profiles.push(p);
    addAudit("profile.created", name, { profile_id: p.id });
    return json(201, { profile: profileJson(p) });
  }
  if ((m = p.match(/^\/profiles\/([^/]+)(\/default)?$/))) {
    const prof = profiles.find((x) => x.id === m![1]);
    if (!prof) return err(404, "not_found", "profile not found");
    const onIt = () => nodes.filter((n) => profileOf(n) === prof);
    if (method === "POST" && m[2]) {
      if (!isAdmin) return forbidden();
      const before = new Map(nodes.map((n) => [n.id, mergedOf(n)]));
      for (const x of profiles) x.is_default = x === prof;
      for (const n of nodes) if (n.profileId === null) bumpDesired(n, before.get(n.id)!);
      addAudit("profile.made_default", prof.name, { profile_id: prof.id });
      return json(200, { profile: profileJson(prof) });
    }
    if (method === "PATCH" && !m[2]) {
      if (!isAdmin) return forbidden();
      if (body.name !== undefined) {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name || name.length > 64)
          return err(400, "invalid_input", "name: от 1 до 64 символов");
        if (profiles.some((x) => x !== prof && x.name.toLowerCase() === name.toLowerCase()))
          return err(409, "conflict", `профиль «${name}» уже есть`);
        prof.name = name;
      }
      if (body.settings !== undefined) {
        const bad = checkSettings(body.settings);
        if (bad) return err(400, "invalid_input", bad);
        const before = new Map(onIt().map((n) => [n.id, mergedOf(n)]));
        prof.settings = { ...(body.settings as Settings) };
        for (const n of onIt()) bumpDesired(n, before.get(n.id)!);
      }
      prof.updated_at = now();
      addAudit("profile.updated", prof.name, {
        profile_id: prof.id,
        settings: body.settings !== undefined,
      });
      return json(200, { profile: profileJson(prof) });
    }
    if (method === "DELETE" && !m[2]) {
      if (!isAdmin) return forbidden();
      if (prof.is_default) return err(409, "conflict", "профиль по умолчанию удалить нельзя");
      for (const n of nodes) {
        if (n.profileId === prof.id) {
          const before = mergedOf(n);
          n.profileId = null;
          bumpDesired(n, before);
        }
      }
      profiles.splice(profiles.indexOf(prof), 1);
      addAudit("profile.deleted", prof.name, { profile_id: prof.id });
      return json(204);
    }
  }

  if (route === "GET /turn-servers") return json(200, { turn_servers: turnServers.map(turnJson) });
  if (route === "POST /turn-servers") {
    if (!isAdmin) return forbidden();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 64) return err(400, "invalid_input", "name: от 1 до 64 символов");
    const secret = typeof body.secret === "string" && body.secret !== "" ? body.secret : null;
    const bad = checkTurn(body.urls, secret);
    if (bad) return err(400, "invalid_input", bad);
    const t: MockTurn = {
      id: ulid(),
      name,
      urls: [...(body.urls as string[])],
      secret,
      managedBy: null,
      created_at: now(),
    };
    turnServers.push(t);
    addAudit("turn.created", name, { turn_server_id: t.id });
    return json(201, { turn_server: turnJson(t) });
  }
  if ((m = p.match(/^\/turn-servers\/([^/]+)$/))) {
    const t = turnServers.find((x) => x.id === m![1]);
    if (!t) return err(404, "not_found", "turn server not found");
    if (method === "PATCH") {
      if (!isAdmin) return forbidden();
      const name = body.name === undefined ? t.name : String(body.name).trim();
      if (!name || name.length > 64) return err(400, "invalid_input", "name: от 1 до 64 символов");
      const secret =
        body.secret === undefined ? t.secret : body.secret === "" ? null : String(body.secret);
      const urls = body.urls === undefined ? t.urls : body.urls;
      const bad = checkTurn(urls, secret);
      if (bad) return err(400, "invalid_input", bad);
      t.name = name;
      t.urls = [...(urls as string[])];
      t.secret = secret;
      for (const n of nodes) if (n.turnIds.includes(t.id)) bumpDesired(n, mergedOf(n));
      addAudit("turn.updated", t.name, {
        turn_server_id: t.id,
        secret_changed: body.secret !== undefined,
      });
      return json(200, { turn_server: turnJson(t) });
    }
    if (method === "DELETE") {
      if (!isAdmin) return forbidden();
      if (t.managedBy) return err(409, "conflict", "coturn ноды удаляется вместе с нодой");
      for (const n of nodes) {
        if (n.turnIds.includes(t.id)) {
          n.turnIds = n.turnIds.filter((x) => x !== t.id);
          bumpDesired(n, mergedOf(n));
        }
      }
      turnServers.splice(turnServers.indexOf(t), 1);
      addAudit("turn.deleted", t.name, { turn_server_id: t.id });
      return json(204);
    }
  }

  if ((m = p.match(/^\/jobs\/([^/]+)$/)) && method === "GET") {
    const job = jobs.get(m[1]!);
    if (!job) return err(404, "not_found", "job not found");
    advanceJob(job);
    return json(200, { job: publicJob(job) });
  }

  if (route === "POST /nodes/provision") {
    if (!isAdmin) return forbidden();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 64) return err(400, "invalid_input", "name: от 1 до 64 символов");
    const host = typeof body.public_host === "string" ? body.public_host.trim() : "";
    if (!host || !/^[A-Za-z0-9.:[\]-]+$/.test(host))
      return err(400, "invalid_input", "public_host: IP или имя сервера");
    const port = typeof body.port === "number" ? body.port : 18081;
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return err(400, "invalid_input", "port: от 1 до 65535");
    const addr = `${host}:${port}`;
    if (nodes.some((n) => n.addr === addr))
      return err(409, "conflict", `нода с адресом ${addr} уже есть`);
    const profileId =
      typeof body.profile_id === "string" && body.profile_id ? body.profile_id : null;
    if (profileId && !profiles.some((x) => x.id === profileId))
      return err(400, "invalid_input", `profile_id: профиля ${profileId} нет`);
    const turnIds = Array.isArray(body.turn_server_ids) ? (body.turn_server_ids as string[]) : [];
    const missing = turnIds.find((id) => !turnServers.some((t) => t.id === id));
    if (missing) return err(400, "invalid_input", `turn_server_ids: сервера ${missing} нет`);
    if (body.auto_blob_reserve !== undefined && typeof body.auto_blob_reserve !== "boolean")
      return err(400, "invalid_input", "auto_blob_reserve: true или false");
    const seed = 2000 + nodes.length;
    const n = mkNode(
      seed,
      name,
      addr,
      "provisioning",
      (body.labels as Record<string, string>) ?? {},
      {
        node_key: "",
        hasToken: false,
        created_at: now(),
        updated_at: now(),
        profileId,
        turnIds: [...turnIds],
        provision: {
          public_host: host,
          port,
          backend: body.backend === "jetstream" ? "jetstream" : "sled",
          with_turn: body.with_turn === true,
        },
      },
    );
    nodes.push(n);
    addAudit("node.provisioned", n.name, {
      node_id: n.id,
      addr,
      with_turn: body.with_turn === true,
      // Как на сервере: по умолчанию резерв подбирается по первому отчёту.
      auto_blob_reserve: body.auto_blob_reserve !== false,
    });
    return json(201, { node_id: n.id, enroll: issueEnroll(n) });
  }

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
    if (method === "GET" && sub === "") {
      if (node.node_key === "" && node.enrollPolls !== null) {
        node.enrollPolls++;
        if (node.enrollPolls >= node.flipAfter) enrollNode(node);
      }
      return json(200, { node: detail(node) });
    }
    if (method === "GET" && sub === "/runtime") return json(200, runtimeView(node));
    if (method === "GET" && sub === "/blob-reserve") return json(200, blobReserveView(node));
    if (method === "POST" && sub === "/blob-reserve") {
      if (!isAdmin) return forbidden();
      if (!node.agent)
        return err(
          409,
          "conflict",
          "у ноды нет агента: задайте BLOB_DISK_RESERVE_BYTES в окружении ноды",
        );
      const view = blobReserveView(node);
      if (view.suggested_bytes === null)
        return err(409, "conflict", "резерв подбирать не нужно: свободного места хватает");
      const before = mergedOf(node);
      node.overrides = { ...node.overrides, blob_disk_reserve_bytes: view.suggested_bytes };
      bumpDesired(node, before);
      addAudit("node.blob_reserve", node.id, {
        reserve_bytes: view.suggested_bytes,
        available_bytes: view.available_bytes,
      });
      return json(200, { reserve_bytes: view.suggested_bytes });
    }
    if (method === "POST" && sub === "/enroll-token") {
      if (!isAdmin) return forbidden();
      if (!node.provision)
        return err(409, "conflict", "нода добавлена по адресу и пину: её ставили без админки");
      addAudit("node.enroll_token", node.id, {});
      return json(200, { enroll: issueEnroll(node) });
    }
    if (method === "POST" && sub === "/ssh-install") {
      if (!isAdmin) return forbidden();
      if (!node.provision)
        return err(409, "conflict", "нода добавлена по адресу и пину: ставить нечего");
      const username = typeof body.username === "string" ? body.username.trim() : "";
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(username))
        return err(400, "invalid_input", "username: имя пользователя SSH");
      const host =
        typeof body.host === "string" && body.host ? body.host.trim() : node.provision.public_host;
      if (!/^[A-Za-z0-9.:[\]-]+$/.test(host))
        return err(400, "invalid_input", "host: IP или имя сервера");
      const hasKey = typeof body.private_key === "string" && body.private_key.trim() !== "";
      const hasPassword = typeof body.password === "string" && body.password !== "";
      if (!hasKey && !hasPassword)
        return err(400, "invalid_input", "нужен пароль или закрытый ключ");
      const port = typeof body.port === "number" ? body.port : 22;
      issueEnroll(node);
      node.enrollPolls = null;
      const failAt: MockJob["failAt"] = host.includes("down")
        ? [0, `ssh: connect to ${host}:${port}: connection refused`, null]
        : body.password === "wrong"
          ? [1, "ssh: authentication failed (password)", null]
          : username === "fail"
            ? [4, null, 100]
            : null;
      const job: MockJob = {
        id: ulid(),
        node_id: node.id,
        status: "running",
        output: "",
        exit_code: null,
        error: null,
        started_at: now(),
        finished_at: null,
        script: installScript(node, host),
        step: 0,
        failAt,
      };
      if (failAt && failAt[2] !== null)
        job.script.splice(4, 0, "E: Unable to locate package docker-ce\n");
      jobs.set(job.id, job);
      addAudit("node.ssh_install", node.id, { host, port, username, job_id: job.id });
      return json(202, { job_id: job.id });
    }
    if (method === "PATCH" && sub === "") {
      if (!isAdmin) return forbidden();
      const bad = validNodeInput(body, true);
      if (bad) return err(400, "invalid_input", bad);
      const before = mergedOf(node);
      let desiredChanged = false;
      let nextProfile = node.profileId;
      if (body.profile_id !== undefined) {
        const pid = String(body.profile_id);
        if (pid && !profiles.some((x) => x.id === pid))
          return err(400, "invalid_input", `profile_id: профиля ${pid} нет`);
        nextProfile = pid || null;
      }
      const profileSettings = (profiles.find((x) => x.id === nextProfile) ?? defaultProfile())
        .settings;
      if (body.overrides !== undefined) {
        const bad = checkSettings(body.overrides, profileSettings);
        if (bad) return err(400, "invalid_input", bad);
      }
      let nextTurn = node.turnIds;
      if (body.turn_server_ids !== undefined) {
        const ids = Array.isArray(body.turn_server_ids) ? (body.turn_server_ids as string[]) : [];
        const missing = ids.find((id) => !turnServers.some((t) => t.id === id));
        if (missing) return err(400, "invalid_input", `turn_server_ids: сервера ${missing} нет`);
        nextTurn = [...new Set(ids)];
      }
      if (
        body.profile_id !== undefined ||
        body.overrides !== undefined ||
        body.turn_server_ids !== undefined
      ) {
        node.profileId = nextProfile;
        if (body.overrides !== undefined) node.overrides = { ...(body.overrides as Settings) };
        node.turnIds = nextTurn;
        desiredChanged = true;
      }
      if (desiredChanged) bumpDesired(node, before);
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
      for (let i = turnServers.length - 1; i >= 0; i--) {
        const t = turnServers[i]!;
        if (t.managedBy === node.id) {
          turnServers.splice(i, 1);
          for (const n of nodes) n.turnIds = n.turnIds.filter((x) => x !== t.id);
        }
      }
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
