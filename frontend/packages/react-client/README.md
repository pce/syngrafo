# react-client — Syngrafo Frontend Shell

React 19 + Tailwind CSS v4 client for the Syngrafo desktop app.
Bundled with Bun and embedded as a static webview in the native Saucer binary.

## Stack

| Layer | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| UI | React 19 |
| Styling | Tailwind CSS v4 + CSS custom-property theme tokens |
| Editor | `@syngrafo/editor` (workspace package) |
| i18n | [LinguiJS](https://lingui.dev) — `en` / `de` / `el` |
| IPC | Saucer webview bindings (`@saucer-dev/types`) |

## Structure

```
src/
  App.tsx               Root component — providers, error boundary, layout
  Dashboard.tsx         Main view shell
  frontend.tsx          Browser entry-point (mounts React root)
  index.ts              Bun static-file server (production mode)
  index.css             Tailwind entry + all CSS theme variables
  components/           UI components — DMS, analysis, audio, widgets, header, sidebar
  hooks/                useNetHealth · useAudioPlaybackWithVisualization · useTheme
  i18n/                 LinguiJS catalog loader + auto locale detection
  models/               Document state for NLP analysis view
  services/             dms-service · nlp-service · netmon-service · markov-service
  store/                dms-store · settings-store · theme-store · bookmark-store
  types/                Audio recording types
  utils/                Shared utilities
```

## Quick start

```sh
# From this package directory
bun run build     # Bundle JS + Tailwind → dist/
bun start         # Serve dist/ (production preview)
```

## Type check

```sh
bun x tsc --noEmit
```

## Tests

```sh
bun test src/components/dms/search-utils.test.ts
```

## i18n

```sh
bun run i18n            # extract + compile in one step
bun run i18n:extract    # extract translatable strings → .po files
bun run i18n:compile    # compile .po → TypeScript message catalogs
```

Supported locales: **en** (English), **de** (German), **el** (Greek).
Add a new locale by creating a `.po` file and listing it in the LinguiJS config.

## Themes

12 built-in colour presets (Dark, Light, Nord, Dracula, Gruvbox, Tokyo Night, Rosé Pine,
Catppuccin Mocha/Macchiato, One Dark, Solarized Dark, High Contrast), 5 font pairs,
adjustable border-radius and density. All preferences are persisted to the DMS SQLite
preference store so they survive app restarts.

## IPC bindings

All C++ native functions are called through `dms-service.ts` and `nlp-service.ts`, which
wrap `saucer.call()` / `saucer.expose()`. See [`app/bindings/`](../../app/bindings/) for
the corresponding C++ side. The editor package consumes bindings directly via
`services/ipc.ts` (lightweight thin wrapper).
