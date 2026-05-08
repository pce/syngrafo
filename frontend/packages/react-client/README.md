# react-client — Syngrafo Frontend Shell

React 19 + Tailwind CSS v4 client for the Syngrafo desktop app.
Bundled with Bun and embedded as a static webview in the native Saucer binary.


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


## IPC bindings

All C++ native functions are called through `dms-service.ts` and `nlp-service.ts`, which
wrap `saucer.call()` / `saucer.expose()`. See [`app/bindings/`](../../app/bindings/) for
the corresponding C++ side. The editor package consumes bindings directly via
`services/ipc.ts` (lightweight thin wrapper).
