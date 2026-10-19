# TrustMe Admin — дизайн-система панели

Тёмная «ops»-эстетика (Linear / Vercel / Grafana): плотно, спокойно, с
выразительными акцентами на статусах и героях. Светлая тема — переключателем.
Источник истины — `web/src/styles/globals.css`.

## Токены

Все цвета, радиусы, тени и отступы — CSS-переменные с префиксом `--tm-` на `:root`
(тёмная тема, по умолчанию) и `[data-theme="light"]`. Тема ставится атрибутом
`data-theme` на `<html>` и хранится в `localStorage` (`tm-admin.theme`).
Блок `@theme inline` отображает токены в утилиты Tailwind, поэтому компоненты
пишут `bg-surface-1`, `text-fg-muted`, `border-line`, `text-ok` и никогда — `#hex`.

| Группа | Токены | Тёмная | Назначение |
|---|---|---|---|
| Фон | `--tm-bg`, `--tm-bg-elevated` | `#0B0D12`, `#0F1218` | страница, сайдбар/шапки таблиц |
| Поверхности | `--tm-surface-1..3` | `#12151C` → `#1F2430` | карточки, поля, hover |
| Линии | `--tm-line`, `--tm-line-strong` | white/7%, white/12% | границы-волоски |
| Текст | `--tm-fg`, `--tm-fg-muted`, `--tm-fg-subtle`, `--tm-fg-inverse` | | основной, вторичный (AA), третичный |
| Бренд | `--tm-accent`, `--tm-accent-hover`, `--tm-accent-fg`, `--tm-accent-2`, `--tm-accent-soft` | `#2DD4BF`, фиолетовый `#8B5CF6` | действия, фокус, выделение |
| Градиенты | `--tm-gradient`, `--tm-gradient-soft`, `--tm-glow` | teal → indigo → violet | герои, пустые состояния, аватары |
| Статусы | `--tm-ok/warn/fail/stale/unknown/skip` и `*-soft` | изумрудный, янтарный, красный, серо-голубой, нейтральный | бейджи, иконки, полосы |
| Графики | `--tm-chart-1`, `--tm-chart-2`, `--tm-chart-grid`, `--tm-chart-axis` | | ECharts читает их при смене темы |
| QR | `--tm-qr-bg`, `--tm-qr-fg` | белый / графит в обеих темах | контраст для сканеров |
| Радиусы | `--tm-radius-xs..xl` | 4 / 6 / 8 / 12 / 16 px | `rounded-sm…xl` |
| Тени | `--tm-shadow-sm/md/lg`, `--tm-glow` | | `shadow-sm…lg`, `shadow-glow` |
| Отступы | `--tm-space-1..8` | шаг 4 px | ритм 4/8/12/16/24/32 |
| Каркас | `--tm-sidebar-w(-collapsed)`, `--tm-topbar-h`, `--tm-bottomnav-h` | 232/64, 56, 64 px | |
| Движение | `--tm-ease`, `--tm-dur-fast`, `--tm-dur` | expo-out, 120/200 мс | |

В светлой теме акцент темнее (`#0D9488`), статусы — насыщеннее, чтобы держать
контраст AA на белом.

## Статусы

Статус никогда не передаётся только цветом: у каждого — своя иконка (lucide) и
подпись. Соответствие задано в `web/src/lib/status.ts`, классы — в
`web/src/lib/tone.ts`.

| Статус ноды | Тон | Иконка | | Статус проверки | Тон | Иконка |
|---|---|---|---|---|---|---|
| `ok` | ok | CircleCheck | | `ok` | ok | CircleCheck |
| `unknown` | unknown | CircleHelp | | `skip` | skip | CircleMinus |
| `warn` | warn | TriangleAlert | | `warn` | warn | TriangleAlert |
| `stale` | stale | Clock | | `error` | fail | OctagonAlert |
| `fail` | fail | CircleX | | `fail` | fail | CircleX |

Порядок «хуже — лучше» для сортировки и сводок: `ok < unknown < warn < stale < fail`.

## Типографика

- Inter (400/500/600/700) — интерфейс; JetBrains Mono (400/500) — адреса, ключи,
  отпечатки, ID, числа. Оба — из `@fontsource`, без CDN.
- Метрики — табличные цифры (`.tabular` или `tabular-nums`).
- Заголовки карточек — 13 px, uppercase, `tracking-wide`, `text-fg-muted`.
- Пин показывается отпечатком `A1B2-C3D4-…` (группы по 4 hex, верхний регистр);
  клик копирует полный 64-hex ключ.

## Компоненты

- **Примитивы** (`web/src/components/ui/`) — в стиле shadcn/ui поверх Radix
  (`radix-ui`): Button (варианты `primary`, `secondary`, `outline`, `ghost`,
  `danger`, `danger-outline`, `link`), Input/Textarea, Checkbox, Field (метка + подсказка +
  ошибка с `aria-describedby`), Card, Dialog, AlertDialog, Tabs, Select, Switch,
  DropdownMenu, Tooltip, Segmented (ToggleGroup), Skeleton, Toast (Radix Toast).
- **Общие** (`web/src/components/`): StatusBadge/StatusIcon/CheckStatusIcon,
  PinChip, CopyButton, CodeBlock, SecretOnce (секрет «показывается один раз»),
  EmptyState (градиентная SVG-иллюстрация + одна кнопка), LiveDot, Sparkline,
  AvailabilityStrip, EChart (ленивая загрузка ECharts), QrCode (локальный SVG).
- Иконки-кнопки обязаны иметь `aria-label`. Иконки рядом с текстом — `aria-hidden`.
- **Управление нодами** (этап 2):
  - `NodeStatusBadge` / `ProvisioningBadge` (`components/NodeBadges.tsx`) — нода с
    `provisioning: true` показывается как «Ожидает установки» (пунктирная пилюля
    `accent-2` и песочные часы), а не «Нет данных»; `AgentDot` — агент на связи
    (пульсирующая точка `ok`, последний heartbeat не старше 90 с) или нет (полая точка).
  - `LimitsEditor` (`features/limits/`) — форма лимитов по каталогу `GET /catalog`,
    общая для профиля (слой поверх умолчаний ноды) и переопределений ноды (слой поверх
    профиля). Группы с иконками, поиск, фильтр «Все / Заданные», ввод с единицами
    (B…TiB, с/мин/ч/дн), переключатель «без ограничения» для `zero_unlimited`,
    подсказка умолчания, сброс, `ScopeBadge`: `hot` — тон `ok`, `new_sessions` —
    `stale`, `restart` — `warn`. Ошибка 400 сервера вида `key: …` показывается под
    строкой этой настройки.
  - `SaveBar` — липкая полоса «Есть несохранённые изменения» под формой-черновиком
    (профиль, лимиты ноды); над нижней навигацией на телефоне.
  - `ApplyBanner` — состояние применения runtime: тон по `state`
    (`no_agent` → `skip`/`unknown`, `pending` → `stale` со спиннером, `applied` → `ok`,
    `invalid` → `fail` с причиной моноширинно), «ждут перезапуска» — полоса `warn`.
  - `JobLog` — терминал установки по SSH: `role="log"`, автопрокрутка, пока
    пользователь не прокрутил вверх, пилюля статуса; опрос `GET /jobs/{id}` раз в
    1,5 с до завершения.
  - `UrlChip` — URL ICE-сервера: схема отдельной ячейкой (`turn:`/`turns:` — акцент).
- **Обновления** (`features/updates/`):
  - `VersionChips` — в шапке карточки чипы «нода vX.Y.Z» и «tmnode X.Y.Z»
    (моноширинно, `surface-2`; подсказка — полный образ и откуда он) и бейдж
    «Доступно обновление» (`accent-soft`, иконка Sparkles).
  - `UpdateAction` — кнопка «Обновить» (`secondary`, рядом с «Проверить сейчас») и
    `UpdateDialog`: выбор версии, галочки частей, предупреждение о перерыве (тон
    `stale`), понижение — блок `fail` с обязательной галочкой; агенту до 0.3.0 — блок
    `warn` и `CodeBlock` с командой `agent-upgrade`.
  - `UpdateBanner` — полоса хода над вкладками, как `ApplyBanner`: тон по состоянию
    (`pending` → `stale`, `running` → `unknown` со спиннером, `succeeded` → `ok`,
    `rolled_back`/`refused` → `warn`, `failed`/`lost` → `fail`, `cancelled` → `skip`),
    шаги `UpdateSteps` пилюлями (готово / идёт / ошибка / пропущен, состояние
    дублируется иконкой и скрытым текстом), причина моноширинно. Итог висит час,
    ошибка — сутки.
  - `UpdateHistory` — карточка на вкладке «История».

## Правила

1. Компоненты не знают конкретных цветов: только утилиты на токенах. Новый цвет —
   новый токен в обеих темах.
2. Для тонов статусов используйте `TONE_CLASSES` — строки литеральные, чтобы
   Tailwind их видел.
3. Фокус — видимое кольцо `--tm-focus` (`:focus-visible`), не убирать.
4. Движение — Motion (`motion/react`) и CSS-кейфреймы; `MotionConfig
   reducedMotion="user"` и медиазапрос `prefers-reduced-motion` отключают анимации.
5. Загрузка — скелетоны той же геометрии, что и контент; ошибки — `ErrorState` с
   «Повторить»; пустые экраны — `EmptyState` с одним ясным действием.
6. Адаптивность от 360 px: ниже `md` сайдбар → нижняя навигация, таблицы →
   карточки, диалоги на всю ширину с отступом 16 px. В нижней навигации — пункты с
   `mobile: "primary"` (Обзор, Ноды, Лимиты, Звонки), остальное — в меню «Ещё».
   Сетки страниц задают `grid-cols-1` на узких экранах, чтобы горизонтально
   прокручиваемые ряды не распирали страницу.
7. Секреты (ingest-токен, ссылка-приглашение) показываются один раз в `SecretOnce`
   с предупреждением; в логи и хранилище браузера не попадают.
   Секреты TURN — только на запись: в форме «Оставить прежний / Задать новый /
   Убрать секрет», наружу виден лишь `has_secret`. Учётные данные SSH живут только в
   памяти формы и стираются, как только задача установки запущена.
8. CSP: никаких внешних источников и инлайн-скриптов; `data:`-URI не используются.
