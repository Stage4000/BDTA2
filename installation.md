# Installing The TypeScript Platform In Plesk

## Purpose

This document explains how to deploy the BDTA TypeScript platform as a single Node.js app through the Plesk control panel.

This deployment model runs:

- the public site
- the client portal
- the admin UI
- the `/api/*` routes
- background jobs in the same process

If you are replacing the legacy PHP production system, read [migration.md](./migration.md) first.

## Supported Plesk Layout

The supported single-app layout is:

- Application Root: the `refactor` directory containing `package.json`
- Document Root: `public`
- Startup File: `app.js`

Do not point Plesk directly at:

- `dist/apps/platform/src/main.js`
- `dist/apps/web/src/main.js`
- `dist/apps/api/src/main.js`

Use `app.js`.

## Prerequisites

Before starting in Plesk:

1. Upload the full `refactor` tree.
2. Make sure the uploaded tree includes `package.json`, `app.js`, `public`, and `docs`.
3. Enable the Node.js extension in Plesk.
4. Use a Node.js version compatible with the repo.

Practical recommendation:

- use Node.js 22.x or newer

## Plesk Control Panel Settings

Open the domain in Plesk and go to **Node.js**.

Set:

- Node.js Version: `22.x` or newer
- Package Manager: `npm`
- Application Mode: `production`
- Application Root: the uploaded `refactor` directory
- Document Root: `public`
- Application Startup File: `app.js`

The most important points are:

- `Application Root` must be the repo root, not `public`
- `Document Root` must be `public`
- `Startup File` must be `app.js`

## Required Environment Variables In Plesk

Set these in **Custom environment variables**:

```text
DB_TYPE=mysql
DB_HOST=localhost
DB_PORT=3306
DB_NAME=bdta
DB_USER=bdta_user
DB_PASSWORD=your_mysql_password
SESSION_LIFETIME_SECONDS=1209600
```

Optional runtime overrides:

```text
HOST=0.0.0.0
PORT=3000
JOB_POLL_INTERVAL_MS=30000
JOB_BATCH_SIZE=25
EMAIL_BATCH_SIZE=25
```

You can use `DATABASE_URL=mysql://...` instead of the `DB_*` variables if you prefer.

## Important Rule About Environment Variables

Plesk custom environment variables are attached to the managed Node.js app process.

They are not automatically visible in a normal shell session.

That means:

- the running app in Plesk may be configured correctly
- a shell command such as `npm run start:platform` may still fail with missing-env errors

Do not use a shell startup failure as proof that the Plesk app is misconfigured unless the shell also has the same env values or a valid `.env.production`.

## Configuration Split: Plesk Env vs Admin Settings

Use Plesk environment variables for:

- database connection
- process-level runtime overrides

Use **Admin > Settings** in the app for secondary operational configuration such as:

- `base_url`
- `business_email`
- Stripe settings
- Turnstile settings
- IMAP settings
- SMTP settings
- Google OAuth settings
- newsletter embed HTML
- Tawk chat settings

Do not try to manage all provider values only through Plesk env if the platform expects them in the `settings` table.

## Install Dependencies

You can do this either:

1. from the Plesk Node.js page using the install dependencies action
2. from a shell in the application root with `npm install`

Recommended sequence:

```bash
npm install
npm run build
```

If you are using the Plesk panel only:

1. install dependencies
2. run the `build` script
3. restart the Node.js app

## Build The App

Run:

```bash
npm run build
```

This is required before the startup wrapper can run the compiled platform.

The startup wrapper `app.js` expects the build output under `dist/`.

## Validate The Uploaded Tree

Before restart, run:

```bash
npm run validate:plesk
```

This checks:

1. required single-app artifacts exist
2. the production env template is valid
3. when startup env is available to the shell, runtime env validation and dry-run launch preflight also run

Important:

- if your shell cannot see `.env.production` or exported DB vars, `validate:plesk` may skip runtime env and launch preflight checks
- that does not automatically mean the Plesk app process is broken

## Optional Shell Support With `.env.production`

If you want shell-based validation commands to behave like the running Plesk app, create `.env.production` in the application root with the DB settings:

```text
DB_TYPE=mysql
DB_HOST=localhost
DB_PORT=3306
DB_NAME=bdta
DB_USER=bdta_user
DB_PASSWORD=your_mysql_password
SESSION_LIFETIME_SECONDS=1209600
```

With that file present, these shell commands become more reliable:

```bash
npm run validate:env -- --use-startup-env --mode runtime
npm run validate:plesk
```

## Restart The App

After dependencies are installed, the build succeeds, and env values are set:

1. click **Restart App** in Plesk
2. wait for the process to restart
3. open the application URL

Do not manually "start" the platform from a shell as the main deployment method. Plesk should own the process lifecycle.

## First Login And Post-Install Setup

Once the app is running:

1. open the admin UI
2. go to **Admin > Settings**
3. populate the launch-critical settings

At minimum, verify:

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

## Health Check

The single app exposes:

```text
/health
```

Use that endpoint for a basic runtime check after restart.

## Recommended Deployment Sequence

For a normal deploy or upgrade:

1. upload the latest source tree
2. confirm Plesk Node.js settings
3. confirm custom environment variables
4. `npm install`
5. `npm run build`
6. `npm run validate:plesk`
7. `npm run validate:env -- --use-startup-env --mode runtime`
8. restart the app in Plesk
9. verify `/health`
10. verify admin, portal, and public pages

## If You Are Cutting Over From PHP

Use this order:

1. follow [migration.md](./migration.md)
2. run migration preflight against the target database
3. apply bootstrap only after preflight is clean
4. restart the Plesk Node.js app
5. verify production flows

## Common Misconfigurations

### Wrong Startup File

Wrong:

- `dist/apps/platform/src/main.js`

Right:

- `app.js`

### Wrong Application Root

Wrong:

- `public`

Right:

- the root folder containing `package.json`

### Wrong Document Root

Wrong:

- the domain root outside the app

Right:

- `public`

### Shell Sees No Database Env

Symptom:

- `validate:plesk` skips runtime validation
- `npm run start:platform` reports missing DB env

Cause:

- Plesk app env is not automatically available in a shell

Fix:

- create `.env.production`, or
- export the DB env vars manually in the shell, or
- rely on the Plesk-managed app process instead of using shell startup as the source of truth

### Provider Values Missing Even Though DB Env Is Correct

Cause:

- database connection is correct, but `settings` table values are incomplete

Fix:

- populate the required values in **Admin > Settings**

## Rollback

If deployment fails after cutover:

1. stop or restart the Node.js app out of live traffic
2. restore the pre-cutover DB snapshot if required
3. return traffic to the legacy PHP system if this was a platform replacement
4. follow `docs/operations/rollback-plan.md`

## Related Documents

- [migration.md](./migration.md)
- [docs/deployment/plesk-single-app.md](./docs/deployment/plesk-single-app.md)
- [docs/operations/backup-plan.md](./docs/operations/backup-plan.md)
- [docs/operations/rollback-plan.md](./docs/operations/rollback-plan.md)
