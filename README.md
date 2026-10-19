# TrustMe Admin

Панель управления нодами мессенджера TrustMe
([trustme_backend](https://github.com/Darkildo/trustme_backend)). Ставится
самостоятельно, одной командой. Подходит и для одной своей ноды, и для парка
нод команды или компании.

Что умеет сейчас:

- **Пробы снаружи.** Админка сама проверяет каждую ноду так же, как её
  проверяет клиент: TCP, рукопожатие Noise IK с пином, подписанный
  `ServerConfig`. Видно, отвечает ли нода, с какой задержкой и с какими
  возможностями.
- **Отчёты с хоста.** `tmnode doctor --json` присылает по cron 15 проверок
  с хоста ноды: контейнер, ключ и пин, каталог данных, диск, резерв под
  файлы, память, часы.
- **Сводка парка.** Статусы нод, доступность по часам, медиана рукопожатия,
  лента событий.
- **Новые ноды из панели.** Одна команда для чистого сервера или
  установка по SSH прямо из панели. Агент `tmnode` держит связь с
  админкой исходящими запросами — на сервере ноды не нужен ни один
  входящий порт.
- **Лимиты без перезапуска.** Профили лимитов и переопределения на
  ноде; агент применяет их на лету, панель показывает, что применено.
- **Звонки.** STUN/TURN-серверы, в том числе coturn рядом с нодой;
  нода выдаёт клиентам временные учётки (2 ч по умолчанию).
- **Доступ и аудит.** Пользователи с ролями `owner` / `admin` / `viewer`,
  вход по паролю и TOTP, журнал действий.

План развития и решения — в [docs/PROMPT.md](docs/PROMPT.md); API — в
[docs/api.md](docs/api.md).

## Запуск

### Docker

```bash
git clone https://github.com/Darkildo/trustme_admin && cd trustme_admin
docker compose up -d
docker compose logs admin | grep setup
```

Откройте ссылку `…/setup?token=…` из лога и создайте владельца. Ссылка
одноразовая и живёт сутки. Если она истекла, перезапустите контейнер:
пока владельца нет, каждый старт выпускает новую.

### Бинарь

```bash
pnpm --dir web install && pnpm --dir web build
cargo build --release
./target/release/trustme-admin --data ./data
```

### Доступ из сети

По умолчанию админка слушает только `127.0.0.1:8088`. Наружу её открывают
через прокси с TLS, например Caddy:

```
admin.example.org {
    reverse_proxy 127.0.0.1:8088
}
```

и запускают с `TM_ADMIN_PUBLIC_URL=https://admin.example.org` (cookie
получат флаг `Secure`) и `TM_ADMIN_TRUST_PROXY=true` (адрес клиента для
журнала берётся из `X-Forwarded-For`).

## Настройки

| Переменная | Флаг | По умолчанию | Смысл |
|---|---|---|---|
| `TM_ADMIN_LISTEN` | `--listen` | `127.0.0.1:8088` | где слушать |
| `TM_ADMIN_DATA` | `--data` | `./data` | каталог `admin.db` и `secret.key` |
| `TM_ADMIN_PUBLIC_URL` | `--public-url` | `http://<listen>` | адрес в браузере; `https://` включает `Secure` у cookie |
| `TM_ADMIN_TRUST_PROXY` | `--trust-proxy` | `false` | доверять `X-Forwarded-For` |
| `TM_ADMIN_PROBE_RETENTION_DAYS` | — | `14` | сколько суток хранить пробы |
| `TM_ADMIN_NODE_IMAGE` | — | `ghcr.io/darkildo/trustme_backend:stable` | образ ноды для новых установок |
| `TM_ADMIN_RELEASES_REPO` | — | `Darkildo/trustme_backend` | релизы для обновления нод (GitHub); `off` — не ходить в GitHub, версии вводятся вручную |
| `RUST_LOG` | — | `info` | уровень логов |

**Бэкап** — каталог данных целиком. `secret.key` шифрует TOTP-секреты: без
него вход с TOTP после восстановления не заработает.

## Новая нода

«Новая нода» → «Поставить на новый сервер». Укажите адрес сервера,
бэкенд, нужен ли coturn и профиль лимитов, затем выберите способ:

- **Команда.** Панель показывает строку для чистого Debian/Ubuntu
  (одноразовая, живёт сутки):

  ```bash
  curl -fsSL https://raw.githubusercontent.com/Darkildo/trustme_backend/stable/deploy/install.sh \
    | sudo sh -s -- enroll --url https://admin.example.org --token tme_…
  ```

- **SSH.** Введите пользователя и пароль или ключ — панель подключится
  сама и покажет ход установки.

Нода появится в списке со статусом «ожидает установки» и оживёт, когда
агент пришлёт её ключ. Образ ноды — `TM_ADMIN_NODE_IMAGE` (по умолчанию
`ghcr.io/darkildo/trustme_backend:stable`).

## Обновление нод

На карточке ноды с агентом `tmnode` видны версии ноды и агента и бейдж
«Доступно обновление», если в релизах бэкенда есть версия новее. Кнопка
«Обновить» (admin и owner) заводит задание: агент заберёт его со
следующим heartbeat, сначала обновит себя, затем ноду, проверит её и при
неудаче вернёт прежний контейнер. Клиенты переподключаются за несколько
секунд.

- Агенту нужен `tmnode` 0.3.0 или новее. Старый агент обновляют на
  сервере: `curl -fsSL …/deploy/install.sh | sudo sh -s -- agent-upgrade`.
- Нода, добавленная по адресу и пину, обновляется только на сервере.
- Без доступа к GitHub (`TM_ADMIN_RELEASES_REPO=off`) версию вводят
  вручную; для `tmnode` — ещё и SHA-256 бинаря из `SHA256SUMS` релиза.

## Подключение отчётов ноды

1. Добавьте ноду в панели: адрес и пин (`node_key=` из лога ноды).
2. Мастер покажет токен приёма отчётов — один раз — и готовую строку для
   cron на хосте ноды:

```bash
*/5 * * * * root tmnode doctor --json | curl -fsS -X POST \
  -H "Authorization: Bearer tmi_…" -H "Content-Type: application/json" \
  --data-binary @- https://admin.example.org/api/v1/ingest/report >/dev/null
```

`tmnode` собирается из репозитория ноды: `cargo build --release -p tmnode`.

## Разработка

```bash
cargo run -- --data ./data           # API на 127.0.0.1:8088
pnpm --dir web dev                   # панель на 5173, /api проксируется на 8088
VITE_MOCK=1 pnpm --dir web dev       # панель на подставных данных, без сервера
```

Проверки — в [CONTRIBUTING.md](CONTRIBUTING.md).

| Путь | Содержимое |
|---|---|
| `src/` | сервер: конфиг, база, вход, API, пробы, встроенная панель |
| `migrations/` | схема SQLite |
| `tests/api.rs` | API целиком на базе в памяти |
| `web/` | панель: React, Vite, TypeScript |
| `docs/` | промт и план, контракт API, дизайн |

## Лицензия

PolyForm Strict 1.0.0 с дополнительными разрешениями — см.
[LICENSING.md](LICENSING.md). Коммерческое использование — по отдельной
лицензии.
