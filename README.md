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
| `RUST_LOG` | — | `info` | уровень логов |

**Бэкап** — каталог данных целиком. `secret.key` шифрует TOTP-секреты: без
него вход с TOTP после восстановления не заработает.

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
