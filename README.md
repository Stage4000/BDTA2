# BDTA TypeScript Refactor

This workspace is the TypeScript target for rebuilding the BDTA legacy PHP platform.

## Structure

- `apps/api`: API and integration entrypoint
- `apps/jobs`: background jobs and scheduled task entrypoint
- `apps/web`: public, admin, and portal surface manifest
- `packages/domain`: core domain entities and shared provider contracts
- `packages/contracts`: API, job, and migration contracts
- `packages/platform`: runtime configuration and scope-aligned manifests
- `tests`: executable foundation tests

## Commands

```bash
npm install
npm test
npm run typecheck
```
