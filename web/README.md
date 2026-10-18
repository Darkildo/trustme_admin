# TrustMe Admin — web panel

React 19 + Vite 8 + TypeScript (strict), Tailwind CSS 4, Radix primitives in the
shadcn style, TanStack Query/Router, ECharts, Motion, i18next (ru default, en).
The production build lands in `web/dist`; the Rust server embeds it and serves it
with an SPA fallback to `index.html` (assets under `/assets/`, base path `/`).

## Commands

```bash
pnpm install
pnpm dev          # Vite on :5173, /api → http://127.0.0.1:8088
pnpm dev:mock     # same, but the API answers from in-memory fixtures (VITE_MOCK=1)
pnpm typecheck    # tsc -b
pnpm lint         # ESLint (flat config, typescript-eslint, react-hooks)
pnpm test         # Vitest + Testing Library
pnpm build        # tsc -b && vite build → dist/
pnpm format       # Prettier
```

### Mock mode

`VITE_MOCK=1` makes `src/lib/api.ts` answer from `src/lib/mock.ts` (dynamic import,
tree-shaken out of normal builds). Fixtures cover every screen: healthy nodes, a node
with warnings (disk, blob reserve QUOTA, memory), a failing one (handshake), a stale
paused one and a never-probed one. Logins: `alice` (owner), `bob` (admin, TOTP — any
6 digits), `carol` (viewer); any password. Invite link: `/invite?token=demo`. When
adding a node, addresses containing `down` fail TCP and `bad` fail the handshake.

## Structure

```
src/
  main.tsx            entry: fonts, tokens, i18n, QueryClient, router, toasts
  app/                router (code-based), app shell, sidebar/bottom nav, top bar,
                      command palette (⌘K / Ctrl+K), lazy page registry
  routes/             screens: overview, nodes, node card, audit, users, settings, auth
  features/           screen building blocks: nodes/ (wizard, tabs, validation, checks,
                      cron), overview/, auth/, users/, settings/
  components/         shared components (status badges, pin chip, empty state, charts…)
  components/ui/      shadcn-style primitives on Radix (button, dialog, tabs, select…)
  lib/                api client + types (mirror docs/api.md), queries, formatting,
                      status mapping, theme, mock
  i18n/               ru.ts (source of keys), en.ts
  styles/globals.css  design tokens (see docs/design.md) + Tailwind theme mapping
  test/               Vitest setup and helpers
```

## Conventions

- All API calls go through `lib/api.ts`: `credentials: "same-origin"`, the
  `X-TrustMe-Admin: 1` header on POST/PATCH/DELETE, errors as typed `ApiError`.
  A 401 `unauthorized` outside `/auth/*`, `/setup`, `/invite` redirects to `/login`.
- Colours, radii, shadows only via tokens (`bg-surface-1`, `text-fg-muted`, `text-ok`…),
  never literal values. See `../docs/design.md`.
- Every UI string goes through i18next; add keys to `i18n/ru.ts` first (the type of
  `en.ts` is derived from it).
- Role-aware UI: `useCan("admin")` hides mutating controls from viewers.
- CSP: no external origins, no inline scripts; QR codes are rendered to inline SVG,
  fonts come from `@fontsource`.
