# Участие в разработке

Pull request'ы, сообщения об ошибках и предложения приветствуются.

## Перед началом

- **Уязвимости** сообщайте приватно, по [SECURITY.md](SECURITY.md), а не через
  issues.
- **Ошибки и предложения** — через issues. Укажите версию, способ запуска и
  шаги воспроизведения.
- **Крупные изменения** сначала обсудите в issue. План и решения владельца
  описаны в [docs/PROMPT.md](docs/PROMPT.md), контракт API — в
  [docs/api.md](docs/api.md).

## Лицензия и CLA

Код распространяется по PolyForm Strict 1.0.0 с дополнительными
разрешениями из [LICENSING.md](LICENSING.md). Изменять код для pull
request'а в этот репозиторий разрешено.

Чтобы вклад можно было принять, автор один раз подписывает
[Contributor License Agreement](CLA.md) — при первом pull request'е. Бот
попросит оставить в PR комментарий:

```
I have read the CLA Document and I hereby sign the CLA
```

## Ветки

- `dev` — разработка, pull request'ы направляйте сюда;
- `master` — текущая публичная версия;
- `stable` — последний стабильный релиз с тегом `vX.Y.Z`.

## Проверки

CI проверяет то же, что ниже. Прогоните локально перед отправкой:

```bash
pnpm --dir web install --frozen-lockfile
pnpm --dir web lint && pnpm --dir web typecheck && pnpm --dir web test && pnpm --dir web build
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test --all-targets
```

Правила:

- **Секреты не логируются никогда:** пароли, токены, TOTP-коды и секреты.
  Пин ноды публичный, его показывать можно.
- **Сообщения коммитов** — на русском, в стиле `feat(api): …`.
