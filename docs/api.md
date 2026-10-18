# API v1

Все пути начинаются с `/api/v1`. Тела запросов и ответов — JSON (UTF-8).

**Время.** Все отметки времени — секунды Unix (`u64`).

**Идентификаторы.** ULID-строки длиной 26 символов.

**Ошибки.** Ответ с кодом не 2xx имеет вид:

```json
{ "error": { "code": "invalid_input", "message": "addr: ожидается host:port" } }
```

| `code` | HTTP | Когда |
|---|---|---|
| `invalid_input` | 400 | |
| `unauthorized` | 401 | нет сессии или токена |
| `totp_required` | 401 | пароль верен, нужен код TOTP |
| `forbidden` | 403 | роль не позволяет; нет заголовка CSRF |
| `not_found` | 404 | |
| `conflict` | 409 | |
| `unprocessable` | 422 | отчёт не того формата |
| `rate_limited` | 429 | |
| `internal` | 500 | |

**CSRF.** Запросы `POST`, `PATCH` и `DELETE` с сессионной cookie обязаны
нести заголовок `X-TrustMe-Admin: 1`, иначе вернётся `403 forbidden`.
Ingest по Bearer-токену заголовка не требует.

**Сессия.** Cookie `tm_admin_session`.

## Общие типы

```ts
type Role = "owner" | "admin" | "viewer";
type NodeStatus = "ok" | "unknown" | "warn" | "stale" | "fail";
type CheckStatus = "ok" | "skip" | "warn" | "error" | "fail";
type ProbeStage = "connect" | "handshake" | "auth" | "config";

interface User {
  id: string; username: string; role: Role;
  totp_enabled: boolean; disabled: boolean;
  created_at: number; last_login_at: number | null;
}

interface ProbeConfig {          // из подписанного ServerConfig
  proto_version: number;
  expires_at: number;
  supports_delivery_ack: boolean;
  supports_queue_addressing: boolean;
  supports_blobs: boolean;
  blob_max_size: number;
}

interface Probe {
  id: string; at: number; ok: boolean;
  stage: ProbeStage | null;      // где остановилась неудачная проба
  error: string | null;
  connect_ms: number | null; handshake_ms: number | null;
  config: ProbeConfig | null;
}

interface ReportSummary {
  id: string; received_at: number; generated_at: number;
  status: CheckStatus; tmnode_version: string;
  counts: { ok: number; skip: number; warn: number; error: number; fail: number };
}

interface Check {                // элемент checks из tmnode.report/1 как есть
  id: string; status: CheckStatus; summary: string;
  hint?: string; data?: Record<string, unknown>;
}

interface Report extends ReportSummary {
  target: { config?: string; container?: string; addr?: string; node_key?: string };
  checks: Check[];
}

interface NodeListItem {
  id: string; name: string; addr: string;
  node_key: string;              // 64 hex
  fingerprint: string;           // "A1B2-C3D4-…" (группы по 4 hex, верхний регистр)
  labels: Record<string, string>;
  status: NodeStatus;
  paused: boolean;
  last_probe: Probe | null;
  last_report: ReportSummary | null;
  uptime_24h: number | null;     // доля успешных проб за 24 ч, 0..1
}

interface NodeDetail extends NodeListItem {
  notes: string;
  probe_interval_secs: number;
  created_at: number; updated_at: number;
  latest_report: Report | null;
  has_ingest_token: boolean;
}
```

Статус ноды — худшее из двух источников:

1. **Последняя проба:** `fail`, если неудачна; `ok`, если удачна; `unknown`,
   если проб ещё не было.
2. **Последний отчёт:**
   - `ok` → `ok`, `skip` → `ok`, `warn` → `warn`, `error` → `warn`,
     `fail` → `fail`;
   - отчёт старше 3 часов → `stale`;
   - если отчётов нет, этот источник не учитывается.

Порядок от лучшего к худшему: `ok` < `unknown` < `warn` < `stale` < `fail`.
Нода на паузе: статус определяется по последним данным, проба по
расписанию не запускается.

## Служебное

`GET /health` → `{ "status": "ok", "version": "0.1.0" }`

`GET /setup` → `{ "needed": true }`

`POST /setup` `{ "token": "…", "username": "…", "password": "…" }` →
`201 { "user": User }`, cookie сессии выставляется сразу. Если настройка уже
проведена → `409`.

Токен первичной настройки сервер печатает в лог при первом старте
ссылкой `http://<listen>/setup?token=…`. Срок — 24 часа, новый старт без
пользователей выпускает новый токен.

## Вход

`POST /auth/login` `{ "username", "password", "totp"?: "123456" }` →
`200 { "user": User }` и cookie.

| Ситуация | Ответ |
|---|---|
| неверный логин или пароль | `401 unauthorized` |
| пароль верен, TOTP включён, кода нет или он неверен | `401 totp_required` |
| слишком много попыток | `429` с заголовком `Retry-After` |

`POST /auth/logout` → `204`.

`GET /auth/me` → `{ "user": User }`.

`POST /auth/totp/setup` → `{ "secret": "BASE32…", "otpauth_uri": "otpauth://totp/TrustMe%20Admin:alice?secret=…&issuer=TrustMe%20Admin" }`.
Секрет хранится как ожидающий до подтверждения.

`POST /auth/totp/enable` `{ "code": "123456" }` → `{ "user": User }`.

`POST /auth/totp/disable` `{ "password", "code" }` → `{ "user": User }`.

`POST /auth/password` `{ "current", "new" }` → `204`. Все остальные
сессии пользователя гаснут.

## Сводка

`GET /overview` →

```ts
{
  nodes: { total: number; by_status: Record<NodeStatus, number> };
  tiles: Array<{ id: string; name: string; status: NodeStatus;
                 handshake_ms: number | null; uptime_24h: number | null;
                 spark: number[] }>;       // 24 значения: доля успешных проб по часам (0..1), -1 — нет данных
  events: Array<{ at: number; node_id: string; node_name: string;
                  kind: "status_changed" | "report_problem";
                  from?: NodeStatus; to?: NodeStatus; summary: string }>;  // последние 50
  latency: Array<{ at: number; handshake_ms_p50: number | null }>;         // 24 часовых точки по парку
}
```

## Ноды

`GET /nodes` → `{ "nodes": NodeListItem[] }`, отсортированы по имени.

`POST /nodes` `{ "name", "addr", "node_key", "labels"?: {}, "probe_interval_secs"?: 60 }` →
`201 { "node": NodeDetail, "ingest_token": "tmi_…" }`.

Токен показывается один раз. Проверки ввода:
- `addr` — `host:port`;
- `node_key` — 64 hex;
- `name` — 1–64 символа;
- `probe_interval_secs` — 15–3600.

Ноды с тем же `addr` — `409`. Сразу после создания запускается проба.

`GET /nodes/{id}` → `{ "node": NodeDetail }`.

`PATCH /nodes/{id}` — любое подмножество полей
`{ name, addr, node_key, labels, notes, probe_interval_secs, paused }` →
`{ "node": NodeDetail }`.

`DELETE /nodes/{id}` → `204`. Удаляются и история проб, и отчёты.

`POST /nodes/{id}/probe` → `{ "probe": Probe }`. Синхронно, до 20 с.

`GET /nodes/{id}/probes?since=<ts>&limit=<n≤5000>` → `{ "probes": Probe[] }`,
по возрастанию времени.

`GET /nodes/{id}/reports?limit=<n≤500>` → `{ "reports": ReportSummary[] }`,
новые первыми.

`GET /nodes/{id}/reports/{rid}` → `{ "report": Report }`.

`POST /nodes/{id}/ingest-token` → `{ "ingest_token": "tmi_…" }`. Прежний
токен перестаёт действовать.

## Приём отчётов

`POST /ingest/report`, заголовок `Authorization: Bearer tmi_…`, тело —
отчёт `tmnode.report/1` как его печатает `tmnode doctor --json`, до
256 КиБ.

| Ответ | Когда |
|---|---|
| `202 { "report_id": "…" }` | отчёт принят |
| `401` | неверный токен |
| `422` | не тот `format` или тело не разбирается |
| `429` | чаще раза в 10 с на ноду |

Команда для cron на хосте ноды (её же панель показывает на вкладке
«Подключение»):

```bash
*/5 * * * * root tmnode doctor --json | curl -fsS -X POST \
  -H "Authorization: Bearer tmi_…" -H "Content-Type: application/json" \
  --data-binary @- https://admin.example.org/api/v1/ingest/report >/dev/null
```

## Пользователи (owner)

`GET /users` → `{ "users": User[] }`.

`POST /users` `{ "username", "role" }` →
`201 { "user": User, "invite_url": "/invite?token=…" }`. Ссылка
одноразовая, срок 48 ч, по ней пользователь задаёт пароль.

`GET /invite?token=` → `{ "username": "…" }`. Ответ `404`, если ссылка
неверна или истекла.

`POST /invite` `{ "token", "password" }` → `{ "user": User }` и cookie.

`PATCH /users/{id}` `{ role?, disabled? }` → `{ "user": User }`.
Последнего `owner` понизить или заблокировать нельзя — `409`.

`DELETE /users/{id}` → `204`. Удалить себя нельзя — `409`.

## Журнал (admin+)

`GET /audit?limit=<n≤500>&before=<ts>` →

```ts
{ entries: Array<{ id: string; at: number; user: string | null;
                   action: string; target: string | null;
                   details: Record<string, unknown>; ip: string | null }> }
```

Значения `action`:

| Группа | Действия |
|---|---|
| Вход и учётная запись | `auth.login`, `auth.login_failed`, `auth.logout`, `auth.totp_enabled`, `auth.totp_disabled`, `auth.password_changed` |
| Настройка и пользователи | `setup.completed`, `user.invited`, `user.activated`, `user.updated`, `user.deleted` |
| Ноды | `node.created`, `node.updated`, `node.deleted`, `node.token_rotated` |
