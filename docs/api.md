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
| `unprocessable` | 422 | отчёт не того формата; задание на обновление не выполнимо |
| `rate_limited` | 429 | |
| `internal` | 500 | |
| `unavailable` | 503 | GitHub (релизы бэкенда) не ответил |

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
  provisioning: boolean;         // подготовлена в панели, агент ещё не прислал ключ (node_key = "")
  agent: { last_seen_at: number | null; hostname: string } | null;
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

## Управление нодами (этап 2)

Лимиты, TURN-серверы, новые ноды и агенты `tmnode`. Протокол агента описан
в trustme_backend, `docs/agent-protocol.md`.

### Каталог лимитов

`GET /catalog` → `{ "settings": Setting[] }`

```ts
type Scope = "hot" | "new_sessions" | "restart";
type Group = "messages" | "sessions" | "network" | "blobs" | "security" | "calls";
type Unit = "count" | "per_second" | "bytes" | "bytes_per_day" | "seconds";

interface Setting {
  key: string;            // "rate_limit_send_msgs_per_sec"
  env: string;            // "RATE_LIMIT_SEND_MSGS_PER_SEC"
  group: Group; unit: Unit; scope: Scope;
  min: number; max: number;
  zero_unlimited: boolean; // 0 — «без ограничения»
  default: number;
  summary: string;         // одна строка по-русски
}
```

Когда изменение вступает в силу (`scope`):

| `scope` | Смысл |
|---|---|
| `hot` | сразу |
| `new_sessions` | для новых соединений |
| `restart` | после перезапуска ноды; до тех пор настройка числится в `pending_restart` |

### Профили лимитов

```ts
interface Profile {
  id: string; name: string;
  settings: Record<string, number>; // только заданные; остальное — умолчание ноды
  is_default: boolean;
  nodes: number;                    // сколько нод на профиле
  created_at: number; updated_at: number;
}
```

Чтение — viewer+, изменение — admin+.

| Запрос | Ответ |
|---|---|
| `GET /profiles` | `{ profiles: Profile[] }`, профиль по умолчанию первым |
| `POST /profiles` `{ name, settings? }` | `201 { profile }` |
| `PATCH /profiles/{id}` `{ name?, settings? }` | `{ profile }` |
| `POST /profiles/{id}/default` | `{ profile }` — сделать профилем по умолчанию |
| `DELETE /profiles/{id}` | `204` |

Ошибки:

- Неизвестная настройка, значение вне пределов, несовместимые значения →
  `400`, причина в `message`.
- Имя уже занято (без учёта регистра) → `409`.
- Профиль по умолчанию удалить нельзя → `409`.
- Ноды удалённого профиля переходят на профиль по умолчанию.

### TURN-серверы

```ts
interface TurnServer {
  id: string; name: string;
  urls: string[];                   // stun: / stuns: / turn: / turns:
  has_secret: boolean;              // секрет наружу не отдаётся никогда
  managed_by_node: { id: string; name: string } | null; // coturn, поставленный с нодой
  nodes: number;                    // скольким нодам назначен
  created_at: number;
}
```

| Запрос | Ответ |
|---|---|
| `GET /turn-servers` | `{ turn_servers: TurnServer[] }` |
| `POST /turn-servers` `{ name, urls, secret? }` | `201 { turn_server }` |
| `PATCH /turn-servers/{id}` `{ name?, urls?, secret? }` | `{ turn_server }` |
| `DELETE /turn-servers/{id}` | `204` |

В `PATCH`: `secret` не передан — секрет остаётся прежним; `""` — снять
секрет.

Правила, те же, что проверит нода:
- у `turn:` / `turns:` нужен секрет не короче 16 символов;
- у STUN секрет не нужен;
- до 8 URL у одного сервера.

coturn ноды отдельно не удаляется → `409`.

### Лимиты и TURN конкретной ноды

`PATCH /nodes/{id}` дополнительно принимает:

| Поле | Смысл |
|---|---|
| `profile_id` | профиль ноды; `""` — профиль по умолчанию |
| `overrides` | `Record<string, number>` — переопределения поверх профиля; объект целиком, `{}` — убрать все |
| `turn_server_ids` | `string[]` — список целиком |

`GET /nodes/{id}/runtime` → что задано ноде и что применено (viewer+):

```ts
{
  profile: { id: string; name: string };
  overrides: Record<string, number>;
  settings: Array<{ key: string; value: number; source: "profile" | "override" }>; // только заданные
  turn_server_ids: string[];
  desired_version: string;            // версия желаемого runtime.toml
  provision: { public_host: string; port: number; backend: "sled" | "jetstream"; with_turn: boolean } | null;
  agent: { hostname: string; arch: string; tmnode_version: string;
           node_image: string | null;   // образ ноды из heartbeat (агент 0.7.0+)
           enrolled_at: number; last_seen_at: number | null; online: boolean } | null;
  applied: { result: "applied" | "invalid" | "absent"; version: string | null;
             error: string | null; pending_restart: string[]; at: number } | null;
  state: "no_agent" | "pending" | "applied" | "invalid";
}
```

`state`:
- `no_agent` — агента нет (нода добавлена вручную или ещё не
  установлена). Настройки применяются только через агента;
- `pending` — агент ещё не применил текущую версию;
- `applied` — применена;
- `invalid` — нода отвергла файл, причина в `applied.error`.

### Новая нода

`POST /nodes/provision` (admin+) — подготовить ноду, которую поставит агент:

```ts
{ name: string; public_host: string;    // IP или имя сервера
  port?: number;                         // 18081
  backend?: "sled" | "jetstream";        // sled
  with_turn?: boolean;                   // поставить coturn рядом с нодой
  auto_blob_reserve?: boolean;           // true: подобрать резерв диска по первому отчёту
  profile_id?: string; turn_server_ids?: string[];
  labels?: Record<string, string> }
```

Ответ — `201`:

```ts
{ node_id: string;
  enroll: { token: string; expires_at: number;
            command: string } }  // готовая команда для сервера (сутки, одноразовая)
```

Нода сразу появляется в списке с `provisioning: true`. После установки
агент пришлёт её ключ, и нода начнёт проверяться пробами. `coturn`,
поставленный с нодой, появляется среди TURN-серверов и назначается ей
автоматически.

`POST /nodes/{id}/enroll-token` (admin+) → `{ enroll }` — новая команда,
прежняя гаснет. Для ноды, добавленной по адресу и пину, — `409`.

### Резерв диска под файлы

На маленьком диске резерв по умолчанию (`blob_disk_reserve_bytes`, 5 ГиБ)
бывает больше свободного места: загрузка файлов получает `QUOTA`, а отчёт —
предупреждение `host.blob_reserve`. Панель подбирает резерв и задаёт его
переопределением ноды; агент доставит, нода применит без перезапуска.

Правило: 10 % диска (`host.disk.total_bytes`), от 512 МиБ до 5 ГиБ, кратно
256 МиБ, и не больше половины свободного места. Если так выходит меньше
512 МиБ, диск почти полон — подбирать нечего, нужно место.

`GET /nodes/{id}/blob-reserve` →

```ts
{ available_bytes: number | null;  // host.blob_reserve последнего отчёта
  total_bytes: number | null;      // host.disk
  reserve_bytes: number | null;    // резерв, с которым сравнивал tmnode
  suggested_bytes: number | null;  // null — места хватает, нет данных или в панели уже не больше
  panel_bytes: number | null;      // blob_disk_reserve_bytes в настройках панели (профиль + переопределение)
  managed: boolean }               // у ноды есть агент
```

`POST /nodes/{id}/blob-reserve` (admin+) → `{ reserve_bytes }` — записать
подобранный резерв в переопределения ноды. `409` — подбирать нечего или у
ноды нет агента (тогда `BLOB_DISK_RESERVE_BYTES` задают в окружении ноды).

С `auto_blob_reserve` (по умолчанию) панель делает то же сама, один раз —
по первому отчёту новой ноды, где видно место под файлы.

`tmnode doctor` до 0.7.0 сравнивает с резервом из окружения контейнера и не
видит `runtime.toml`, поэтому предупреждение в отчёте может остаться и после
подбора, хотя нода уже работает с новым резервом. Новый `doctor` учитывает
`runtime.toml` и пишет, откуда взят резерв, в `data.reserve_source` проверки
`host.blob_reserve`; по нему панель и отличает старый отчёт.

### Установка по SSH

`POST /nodes/{id}/ssh-install` (admin+) — админка один раз подключается к
серверу и запускает ту же команду установки:

```ts
{ username: string;
  password?: string;          // или private_key
  private_key?: string;       // OpenSSH PEM, Ed25519 или ECDSA (RSA не поддерживается)
  passphrase?: string;
  sudo_password?: string;     // если пользователь не root; по умолчанию — пароль входа
  host?: string;              // по умолчанию public_host ноды
  port?: number;              // 22
  host_fingerprint?: string } // "SHA256:…" — сверить ключ хоста
```

Ответ — `202 { job_id }`.

- Учётные данные не сохраняются ни в базе, ни в журнале; пароль `sudo`
  идёт через stdin.
- Без `host_fingerprint` ключ хоста принимается при первом контакте и
  печатается первой строкой вывода.

`GET /jobs/{id}` → ход установки (опрашивать раз в 1–2 с):

```ts
{ job: { id: string; node_id: string;
         status: "running" | "succeeded" | "failed";
         output: string;           // вывод установки, до 256 КиБ
         exit_code: number | null; error: string | null;
         started_at: number; finished_at: number | null } }
```

Задачи живут в памяти сервера: после перезапуска админки их нет.

### Эндпоинты агента

`POST /agent/enroll` и `POST /agent/heartbeat` — для `tmnode`, не для
панели. Формат описан в trustme_backend, `docs/agent-protocol.md`; CSRF
не требуется — авторизация по Bearer-токену.

### Обновление ноды и агента

Панель обновляет ноду (образ контейнера) и агента `tmnode` до версий из
релизов бэкенда. Протокол — trustme_backend, `docs/agent-protocol.md`,
раздел «Обновление»: задание уходит агенту в ответе heartbeat, ход
приходит в следующих heartbeat. Источники образа и бинаря агент выбирает
сам, панель называет только версии и хэш бинаря из `SHA256SUMS` релиза.

**Релизы** — `GET /releases` (viewer+):

```ts
{ enabled: boolean;            // false — TM_ADMIN_RELEASES_REPO=off, версии задаются вручную
  repo: string | null;         // "Darkildo/trustme_backend"
  latest: string | null;       // старшая версия, "0.7.0"
  releases: Array<{
    version: string;           // "0.7.0" — только теги vX.Y.Z без pre-release, новые первыми
    tag: string;               // "v0.7.0"
    published_at: number | null;
    url: string;               // страница релиза
    tmnode: { x86_64: boolean; aarch64: boolean } // есть бинарь и SHA256SUMS
  }> }
```

Список берётся из GitHub API и живёт в памяти сервера 5 минут (ошибка —
30 секунд). GitHub не ответил — `503 unavailable`.

**Задание** — `POST /nodes/{id}/update` (admin+):

```ts
{ node_version?: string;       // "0.7.0" или "v0.7.0": образ <репозиторий>:v0.7.0
  tmnode_version?: string;     // версия tmnode из релиза с этим тегом
  tmnode_sha256?: string;      // только когда релизы выключены: хэш tmnode-<arch>-linux
  allow_downgrade?: boolean }  // разрешить версию ниже текущей
```

Ответ — `201 { update: NodeUpdate }`. Хэш `tmnode` панель берёт из
`SHA256SUMS` релиза под архитектуру агента (`agent.arch`).

| Ответ | Когда |
|---|---|
| `400` | нет ни одной версии; версия не `X.Y.Z`; релизы выключены, а `tmnode_sha256` не задан или не 64 hex |
| `404` | ноды нет |
| `409` | нода добавлена по адресу и пину; агент ещё не подключился; агент до 0.7.0 (в `message` — команда `install.sh agent-upgrade`); у ноды уже есть `pending` или `running` задание |
| `422` | понижение без `allow_downgrade`; релиза с такой версией нет; в релизе нет `tmnode` под архитектуру агента; `tmnode_sha256` не совпал с `SHA256SUMS`; `tmnode` ниже 0.7.0 (такой агент заданий не знает) |
| `503` | GitHub не ответил |

Текущие версии для проверки понижения: нода — по тегу `:vX.Y.Z` образа,
`tmnode` — по версии агента. Если тег без версии (`:stable`), задание не
блокируется: «доступно обновление» и понижение для ноды не вычисляются
(панель предупреждает об этом в диалоге), понижение проверяет только агент.
Задание только на `tmnode` агент выполняет и для ноды на `:stable`.

С релиза v0.7.0 версия `tmnode` совпадает с версией релиза бэкенда:
`tmnode_version` — это и версия бинаря, и тег релиза, откуда агент его
качает. Обновляться из панели умеет `tmnode` 0.7.0 и новее; агенты 0.2.x
нумеровались по-своему и ниже порога.

**Образ новой установки.** Если в `TM_ADMIN_NODE_IMAGE` тег без версии (по
умолчанию `:stable`), `POST /agent/enroll` отдаёт в `install.image` тот же
репозиторий с тегом последнего релиза (`:v0.7.1`): тогда версия ноды видна
с первого heartbeat. Версионный тег в настройке, выключенные или недоступные
релизы — образ из настройки как есть.

**Версии и история** — `GET /nodes/{id}/updates` (viewer+):

```ts
type UpdateJobState = "pending" | "running" | "succeeded" | "failed"
                    | "rolled_back" | "refused" | "cancelled" | "lost";
type UpdateStep = "check" | "download_tmnode" | "restart_agent" | "pull_image"
                | "recreate" | "verify" | "rollback";

interface NodeUpdate {
  id: string;                  // ULID строчными — тот же id видит агент
  node_id: string;
  node_version: string | null; tmnode_version: string | null; tmnode_sha256: string | null;
  allow_downgrade: boolean;
  state: UpdateJobState;
  step: UpdateStep | null;     // шаг, на котором агент сейчас или остановился
  error: string | null;        // причина: failed / rolled_back / refused / lost
  from_node_image: string | null; to_node_image: string | null;  // из статуса агента
  from_tmnode: string | null; to_tmnode: string | null;
  created_by: string | null;   // имя пользователя
  created_at: number;
  started_at: number | null;   // время панели: первый статус агента
  finished_at: number | null;  // итог (или отмена, или lost)
  reported_at: number | null;  // последний статус агента по заданию
}

{ current: {
    managed: boolean;          // нода поставлена агентом (не «по адресу и пину»)
    agent: { arch: string; tmnode_version: string } | null;
    node_image: string | null; // образ из heartbeat, иначе из отчёта (runtime.container → data.image)
    node_image_source: "agent" | "report" | null;
    node_version: string | null;   // тег :vX.Y.Z образа; null — тег без версии
    tmnode_version: string | null;
    supports_updates: boolean;     // есть агент 0.7.0 или новее
    min_agent_version: string;     // "0.7.0"
    agent_upgrade_command: string  // curl … install.sh | sudo sh -s -- agent-upgrade
  };
  updates: NodeUpdate[] }      // новые первыми, до 50
```

Состояния задания:

| `state` | Кто ставит | Значение |
|---|---|---|
| `pending` | панель | заведено, агент ещё не начал |
| `running` | агент | выполняется, `step` — текущий шаг |
| `succeeded` | агент | всё, что просили, стоит и проверено |
| `failed` | агент | не удалось, работает прежняя версия (если в `error` не сказано иначе) |
| `rolled_back` | агент | новая нода не прошла проверку, вернулся прежний контейнер |
| `refused` | агент | агент отказался: нет `management.mode = "managed"`, версия закреплена в `node.toml`, понижение без разрешения |
| `cancelled` | панель | отменено, пока было `pending` |
| `lost` | панель | `running`, но агент не присылал статус по заданию 15 минут |

У ноды не больше одного `pending` или `running` задания. Пока задание
такое, панель кладёт его в каждый ответ heartbeat; итог агента его
снимает. Повтор итога ничего не меняет. Итог по `cancelled` или `lost`
заданию (агент успел начать или вернулся) записывается поверх: агенту
виднее. Статус с чужим или неизвестным `id` пропускается с записью в лог.

**Отмена** — `POST /nodes/{id}/updates/{uid}/cancel` (admin+) →
`{ update: NodeUpdate }`. Только `pending`; `409`, если агент уже начал
или задание завершено. Отменить у самого агента нельзя: если он забрал
задание в ответе heartbeat и начал раньше, чем пришла отмена, он доведёт
обновление, а его итог запишется поверх `cancelled`. Панель говорит об этом
в подсказке у кнопки «Отменить».

**Агент до 0.7.0** заданий не видит (агенты 0.2.x нумеровались отдельно от
релизов; с v0.7.0 версия `tmnode` совпадает с версией релиза бэкенда). Его обновляют на сервере:

```bash
curl -fsSL https://raw.githubusercontent.com/Darkildo/trustme_backend/stable/deploy/install.sh \
  | sudo sh -s -- agent-upgrade
```

### Новые действия журнала

| Группа | Действия |
|---|---|
| Профили | `profile.created`, `profile.updated`, `profile.made_default`, `profile.deleted` |
| TURN | `turn.created`, `turn.updated`, `turn.deleted` |
| Ноды и агенты | `node.provisioned`, `node.enroll_token`, `node.ssh_install`, `node.blob_reserve`, `agent.enrolled` |
| Обновления | `node.update_created`, `node.update_cancelled`, `node.update_finished` (итог агента — `user: "agent"`; `lost` — `user: "system"`; в `details` — `state`, `step`, `error`, версии) |

### Новое событие

`kind: "key_changed"` в ленте сводки: агент прислал ключ, отличный от пина
в панели. Клиенты с прежним пином к ноде не подключатся.
