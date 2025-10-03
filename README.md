
# Keep-li Monorepo

Keep-li combines a Chrome extension for saving LinkedIn content with a Cloudflare Worker API and a shared TypeScript package. The repository is organised as a pnpm workspace so shared types, constants, and utilities can be reused across the surface area.

## Repository Structure

- `shared/` – Common TypeScript types, constants, and utilities exposed as the `@keep-li/shared` package.
- `extension/` – Chrome extension built with Vite (background service worker, content scripts, popup, onboarding/settings UIs).
- `api/` – Cloudflare Worker API built with Hono and Wrangler, including telemetry ingestion and AI summarisation endpoints.
- `brand/`, `plan.md`, `keep-li_prd.md`, etc. – Product and design collateral (not required for builds).

## Prerequisites

- Node.js 18+ (Cloudflare Wrangler requires modern Node; the repo assumes pnpm ≥9).
- pnpm (install via `corepack enable` or `npm i -g pnpm`).
- Wrangler CLI (installed as a dev dependency; run with `pnpm wrangler` or `npx wrangler`).

## Installation

```bash
pnpm install
```

The workspace installs `shared`, `extension`, and `api` packages together.

## Common Scripts

Run from the repository root unless noted otherwise:

- `pnpm dev` – Start the API Worker (via Wrangler) and extension Vite dev server in parallel.
- `pnpm build` – Build all workspaces (`shared`, `extension`, `api`).
- `pnpm lint` / `pnpm lint:fix` – Lint every workspace (optionally with `--fix`).
- `pnpm typecheck` – Run `tsc --noEmit` for every workspace.
- `pnpm test` – Run available test suites (currently only in workspaces that define tests).

### Extension Package

- `pnpm dev:extension`
- `pnpm build:extension`
- `pnpm --filter @keep-li/extension run typecheck`

Production builds output to `extension/dist/` for packaging the Chrome extension.

### API Package

- `pnpm dev:api`
- `pnpm build:api`
- `pnpm --filter @keep-li/api run typecheck` (automatically rebuilds the shared declarations first)
- `pnpm --filter @keep-li/api run secrets:sync[:staging|:production]`
- `pnpm --filter @keep-li/api run deploy:staging`
- `pnpm --filter @keep-li/api run deploy:production`

API builds and deployments rely on Wrangler. The Worker configuration lives in `api/wrangler.toml`; environment-specific bindings are under `[env.production]` and `[env.staging]`.

## Secrets Management

The sync script pushes secrets to Wrangler using your local environment variables. When targeting an environment, prefix the variable name with the uppercase environment key (e.g. `STAGING_OPENAI_API_KEY`). Example variables expected:

- `OPENAI_API_KEY` / `STAGING_OPENAI_API_KEY`
- `ANTHROPIC_API_KEY` / `STAGING_ANTHROPIC_API_KEY`
- `SENTRY_DSN` / `STAGING_SENTRY_DSN`

Run secret sync after exporting the relevant values:

```bash
STAGING_OPENAI_API_KEY="sk-..." pnpm --filter @keep-li/api run secrets:sync:staging
```

The script feeds Wrangler through stdin, avoiding unsupported CLI flags.

## Telemetry & Sentry

- Telemetry can be toggled by the extension through the `TELEMETRY_ENABLED` preference stored in Chrome local storage.
- Sentry initialisation is skipped when running inside a Chrome extension context (per platform best practices); telemetry opt-in is respected automatically.

## Deployment Checklist

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm build`
4. `pnpm --filter @keep-li/api run deploy:staging` (or `:production`)

Ensure staging/production Workers exist before syncing secrets to avoid Wrangler prompts.

## Troubleshooting

- **`TS6305` errors referencing `shared/dist`** – Ensure `@keep-li/shared` declarations exist by running `pnpm --filter @keep-li/shared run build`.
- **Wrangler warns about `vars` inheritance** – Add environment-specific entries (e.g. `API_VERSION`) under each `[env.*.vars]` block, as already configured for staging.
- **Sentry errors in extension** – Confirm you are on the latest build; the content scripts now skip `Sentry.init` in disallowed contexts.

For further product context, see `plan.md` and `keep-li_prd.md` in the repository root.
