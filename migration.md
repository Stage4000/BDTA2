# Migrating From The Legacy PHP Platform To The TypeScript Platform

## Purpose

This document describes the supported migration path from the legacy PHP BDTA platform to the TypeScript refactor in this repository.

The instructions below are based on the current cutover tooling in:

- `apps/migrate`
- `packages/application/src/migration.ts`
- `packages/infrastructure/src/mysql.ts`
- `docs/deployment/plesk-single-app.md`
- `docs/operations/backup-plan.md`
- `docs/operations/rollback-plan.md`

## Supported Migration Model

The supported production migration model is an in-place cutover on the existing MySQL database.

That means:

- the legacy business tables remain the source of truth for clients, pets, bookings, invoices, quotes, contracts, forms, packages, credits, settings, workflows, notifications, and admin users
- the TypeScript runtime is expected to run against that same MySQL dataset
- the migration tooling bootstraps the additional runtime tables, indexes, and settings metadata the TypeScript platform needs

This is not currently a full export/import ETL pipeline into a brand-new normalized target database.

## Not Supported By The Current Tooling

Do not treat the current migration tooling as a data copier for a blank replacement schema.

At the time of writing, the repository contains:

- cutover rehearsal
- launch preflight
- bootstrap DDL and settings seeding
- rollback and operational readiness checks

It does not contain a general-purpose importer that copies all legacy PHP business rows into a separate fresh target schema.

If you want a clean-room migration into a different database layout, build and validate a dedicated importer first.

## What The Migration Tool Actually Does

`npm run start:migrate` runs the migration runtime from `dist/apps/migrate/src/main.js`.

The runtime:

- connects to MySQL using `DATABASE_URL` or the legacy `DB_*` variables
- audits row counts for the mapped legacy tables
- checks required public-link tokens such as quote, contract, form, and booking iCal tokens
- validates runtime environment readiness
- validates provider readiness for Stripe, Turnstile, IMAP, SMTP, and Google OAuth
- validates operational readiness, including rollback documentation
- checks that the runtime support tables exist
- optionally applies bootstrap SQL to create missing support tables, columns, indexes, and seed managed settings rows

The bootstrap SQL is idempotent. It uses `CREATE TABLE IF NOT EXISTS`, column existence checks, index existence checks, and settings upsert-style seeding.

## Required Preconditions

Before cutover:

1. The TypeScript codebase must be uploaded and built successfully.
2. The Node.js runtime must be able to read the production database connection.
3. The legacy MySQL database must be backed up immediately before cutover.
4. File assets and uploads must be backed up.
5. The rollback plan must be documented.
6. A rehearsal should be run against a restored production snapshot before touching live traffic.

Use these existing docs:

- `docs/deployment/plesk-single-app.md`
- `docs/operations/backup-plan.md`
- `docs/operations/rollback-plan.md`

## Environment Setup

The migration runtime reads database config from either:

- `DATABASE_URL`
- or `DB_TYPE`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`

For shell-based runs, create `.env.production` from `.env.production.example` or export the DB variables manually.

Important Plesk note:

- Plesk-managed Node.js environment variables are attached to the app process
- they are not automatically visible in a normal shell session
- if you run migration commands from a shell, make sure `.env.production` exists or export the DB variables first

## Build And Basic Validation

From the application root:

```bash
npm install
npm run build
npm run validate:env -- --use-startup-env --mode runtime
npm run validate:plesk
```

Expected result:

- the build passes
- runtime env validation passes
- `validate:plesk` reports launch preflight readiness or gives explicit blocking issues

## Rehearsal On A Restored Snapshot

Do this first in non-production against a restored production snapshot.

1. Restore the latest production MySQL backup into a non-production database.
2. Point `.env.production` or shell vars at that restored database.
3. Run the migration preflight without applying bootstrap SQL.

Example:

```bash
export MIGRATION_REHEARSAL_ID=staging-cutover-rehearsal
export MIGRATION_DRY_RUN=true
export MIGRATION_APPLY_BOOTSTRAP=false
export MIGRATION_REQUIRE_READY=true
export ROLLBACK_PLAN_DOCUMENTED=true
npm run start:migrate
```

Review the JSON report carefully.

Do not proceed until:

- `blockingIssues` is empty
- `executionBlocked` is `false`
- `preflightReport.readyForLaunch` is `true`
- token audits show no missing required access tokens

## Important Safety Note About The Migration Flags

`MIGRATION_APPLY_BOOTSTRAP` is the flag that controls whether SQL is executed.

Do not assume `MIGRATION_DRY_RUN=true` by itself prevents writes. In the current implementation, the effective write gate is `MIGRATION_APPLY_BOOTSTRAP`.

Safe rehearsal:

- `MIGRATION_APPLY_BOOTSTRAP=false`

Bootstrap execution:

- `MIGRATION_APPLY_BOOTSTRAP=true`

## Production Cutover Plan

### 1. Freeze The Legacy System

Immediately before cutover:

1. Stop legacy cron or worker activity.
2. Put the PHP platform into maintenance mode or otherwise freeze write traffic if possible.
3. Take the final pre-cutover database snapshot.
4. Back up uploads and file assets.

### 2. Deploy The TypeScript App

On the target host:

```bash
npm install
npm run build
```

For Plesk single-app deployment, the expected runtime is:

- Application Root: the `refactor` directory
- Document Root: `public`
- Startup File: `app.js`

### 3. Run Launch Preflight Against Production

Before applying bootstrap SQL, run the production preflight:

```bash
export MIGRATION_REHEARSAL_ID=production-cutover
export MIGRATION_DRY_RUN=true
export MIGRATION_APPLY_BOOTSTRAP=false
export MIGRATION_REQUIRE_READY=true
export ROLLBACK_PLAN_DOCUMENTED=true
npm run start:migrate
```

If the report contains blocking issues, stop and fix them first.

### 4. Apply Bootstrap SQL

Once preflight is clean, run the bootstrap pass:

```bash
export MIGRATION_REHEARSAL_ID=production-cutover
export MIGRATION_DRY_RUN=false
export MIGRATION_APPLY_BOOTSTRAP=true
export MIGRATION_REQUIRE_READY=true
export ROLLBACK_PLAN_DOCUMENTED=true
npm run start:migrate
```

Expected result:

- the report shows `bootstrapApplied: true`
- `executionBlocked` remains `false`
- missing runtime support tables, columns, indexes, and managed settings rows are created

## What Bootstrap Adds

The bootstrap path is meant to prepare the existing database for the TypeScript runtime.

It creates or updates runtime support structures such as:

- `settings`
- `email_outbox`
- `job_queue`
- `inbound_emails`
- `unmatched_emails`
- `integration_callbacks`
- `package_pending_purchases`
- `calendar_sync_links`
- `workflows`
- `workflow_enrollments`
- `workflow_triggers`
- `workflow_steps`
- `workflow_step_executions`

It also adds required columns and indexes when they are missing and seeds managed settings definitions into `settings`.

Current codebase note:

- launch preflight expects `app_sessions` to exist
- the current migration bootstrap statement list does not create `app_sessions`
- if preflight reports `app_sessions` as missing, create it before cutover or extend the bootstrap SQL before relying on this procedure

## Start The TypeScript Platform

After bootstrap completes cleanly, start the unified platform runtime:

```bash
npm run start
```

Or on Plesk, restart the Node.js app from the panel.

## Post-Cutover Verification

After the TypeScript app is live:

1. Check `/health`.
2. Verify public homepage and services pages load.
3. Verify portal login.
4. Verify admin login.
5. Verify booking submission.
6. Verify invoice and quote access.
7. Verify site page editor and admin content surfaces.
8. Verify job processing is running if background jobs are enabled.

Also verify that **Admin > Settings** contains valid live values for launch-critical items such as:

- `base_url`
- `stripe_enabled`
- `stripe_mode`
- `stripe_live_secret_key`
- `stripe_webhook_secret`
- `turnstile_site_key`
- `turnstile_secret_key`
- `imap_enabled`
- `imap_host`
- `smtp_host`
- `google_oauth_client_id`
- `google_oauth_client_secret`

The TypeScript runtime expects most secondary operational configuration to be managed in the database through Admin > Settings, not solely through environment variables.

## Recommended Verification Commands

Use these after deployment:

```bash
npm run validate:env -- --use-startup-env --mode runtime
npm run validate:plesk
```

Optional repository-level release validation:

```bash
npm run validate:release
```

`validate:release` is useful for parity and screenshot coverage, but it is not a substitute for a real migration rehearsal against a restored production database.

## Rollback

If cutover fails or critical regressions are found:

1. Freeze TypeScript write traffic.
2. Stop TypeScript background polling.
3. Restore the last known-good pre-cutover MySQL snapshot.
4. Repoint traffic to the legacy PHP platform.
5. Verify public booking, portal login, admin login, payments, and reminders on the legacy system.

Follow `docs/operations/rollback-plan.md` exactly.

## Practical Recommendation

For this codebase, the safest production migration strategy is:

1. Restore a production snapshot into staging.
2. Run `validate:env`, `validate:plesk`, and `start:migrate` there first.
3. Fix every blocking issue.
4. Repeat until the report is clean.
5. Perform the same sequence on production immediately before cutover.

If the goal changes from in-place cutover to full data relocation into a different schema, stop and build a dedicated importer before launch.
