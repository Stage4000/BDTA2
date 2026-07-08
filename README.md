# BDTA TypeScript Refactor

This workspace is the TypeScript target for rebuilding the BDTA legacy PHP platform.

## Structure

- `apps/api`: API and integration entrypoint
- `apps/jobs`: background jobs and scheduled task entrypoint
- `apps/migrate`: migration rehearsal, launch preflight, and cutover tooling
- `apps/release`: screenshot, smoke, parity, and readiness validation runtime
- `apps/web`: public, admin, and portal surface manifest
- `packages/domain`: core domain entities and shared provider contracts
- `packages/contracts`: API, job, and migration contracts
- `packages/platform`: runtime configuration and scope-aligned manifests
- `docs/operations`: rollback, backup, monitoring, and error-logging runbooks
- `tests`: executable foundation tests

## Commands

```bash
npm install
npm test
npm run typecheck
npm run build
npm run validate:plesk
npm run validate:env -- --use-startup-env --mode runtime
npm run start:release
```

## Production Setup

- Copy `.env.production.example` into the deployment environment and replace placeholders with live values.
- For Plesk single-app installs, use `docs/deployment/plesk-single-app.md` and validate the uploaded tree with `npm run validate:plesk`.
- When `.env.production` or exported DB runtime values are available, `npm run validate:plesk` now also runs merged startup-env validation and a dry-run launch preflight against the configured database.
- The admin settings database screen reflects effective runtime values after Plesk process-level overrides are applied, not just the raw `.env.production` file.
- Keep the operational runbooks in `docs/operations` current before each launch rehearsal.
- Use `npm run start:migrate` for cutover preflight and controlled bootstrap execution.
