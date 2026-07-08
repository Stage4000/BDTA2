# Container Stack

## Scope

This repository is deployable as a standalone TypeScript runtime. Public assets are vendored into `public/assets`, so container builds do not require the legacy PHP workspace to be present.

The production container stack covers:

- `api`: authenticated API and callback surface
- `web`: public site, portal, and admin web surface
- `jobs`: background worker loop
- `migrate`: dry-run preflight or controlled cutover/bootstrap execution

This stack assumes an external MySQL database and external providers. It does not provision MySQL, SMTP, IMAP, Stripe, or Google services.

## Required Files

- `Dockerfile`
- `docker-compose.production.yml`
- `.env.production`
- `docs/operations/rollback-plan.md`
- `docs/operations/backup-plan.md`
- `docs/operations/monitoring.md`
- `docs/operations/error-logging.md`

Start from `.env.production.example` and create a real `.env.production` before deployment.

For secretless test and validation environments, the repo includes a committed synthetic file at `.env.release-validation`. `npm run start:release` and `npm run validate:release` will use it automatically when `.env.production` and explicit process env values are absent.

Validate the checked-in template:

```bash
npm run validate:env -- --file .env.production.example --mode template
```

Validate a real deployment env file before bringing up containers:

```bash
npm run validate:env -- --file .env.production --mode runtime
```

`npm run start:release` now also reads `.env.production` automatically when the file is present, so launch readiness can be evaluated against the same env file the container stack will use. `npm run validate:release` performs the same release-validation run but returns a failing process exit code when validation readiness is red.

When Playwright browser automation is available, `npm run validate:release` writes rendered desktop and mobile screenshots for every tracked page. When browser automation is unavailable but the Node runtime can still serve the app, the validator falls back to HTML response captures under the same artifact tree so route verification, settings-catalog validation, and feature-parity reconciliation can still complete without pretending that visual screenshot QA happened.

In restricted environments where spawning Chromium is blocked but an existing browser can expose a debugging endpoint, set either `PLAYWRIGHT_CDP_URL` or `PLAYWRIGHT_WS_ENDPOINT` before running `npm run validate:release`. The validator will try those attachment endpoints before it attempts to launch a local browser binary.

Release-validation artifacts are written under `reports/release-validation/YYYY-MM-DD/` based on the run date. The latest run also writes a pointer file at `reports/release-validation/latest.json`.

To force a specific artifact date during replay or CI debugging:

```bash
RELEASE_VALIDATION_DATE=2026-06-06 npm run validate:release
```

If `.env.release-validation` is the source of values, provider audits will be marked as `synthetic` rather than `live`. Release validation can still pass, and the report will mark live-launch readiness as `n/a` instead of treating synthetic placeholders as a deployment blocker.

## Build

```bash
docker build -t bdta-refactor:production .
```

The image defaults to the web runtime:

```bash
docker run --rm -p 3001:3001 --env-file .env.production bdta-refactor:production
```

Override the command to run other processes:

```bash
docker run --rm --env-file .env.production bdta-refactor:production node dist/apps/api/src/main.js
docker run --rm --env-file .env.production bdta-refactor:production node dist/apps/jobs/src/main.js
docker run --rm --env-file .env.production bdta-refactor:production node dist/apps/migrate/src/main.js
```

## Compose Stack

Bring up the long-running services:

```bash
docker compose -f docker-compose.production.yml up -d --build api web jobs
```

Health endpoints:

- API: `http://127.0.0.1:3000/health`
- Web: `http://127.0.0.1:3001/health`

The compose file uses `scripts/http-healthcheck.mjs` so health probes do not depend on curl being present in the runtime image.

## Migration and Cutover

Run a dry-run preflight:

```bash
docker compose -f docker-compose.production.yml --profile ops run --rm -e MIGRATION_DRY_RUN=true migrate
```

Run a launch-gated bootstrap/cutover execution:

```bash
docker compose -f docker-compose.production.yml --profile ops run --rm ^
  -e MIGRATION_DRY_RUN=false ^
  -e MIGRATION_APPLY_BOOTSTRAP=true ^
  -e MIGRATION_REQUIRE_READY=true ^
  migrate
```

The migrate runtime will block execution if launch readiness fails.

## Recommended Rollout Order

1. Populate `.env.production` with live provider values.
2. Run the migration dry-run preflight until launch readiness is green.
3. Execute the controlled migrate command for bootstrap/cutover.
4. Start `api`, `web`, and `jobs`.
5. Verify `/health` on API and web.
6. Run `npm run validate:release` or the CI release-validation job against the deployed code before final DNS or traffic cutover.

## CI

`.github/workflows/ci.yml` runs:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run validate:release`

The release-validation job installs PHP and Playwright Chromium so screenshots, API smoke checks, and legacy PHP baseline analysis run inside CI.
