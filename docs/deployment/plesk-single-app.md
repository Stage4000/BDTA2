# Plesk Single-App Setup

## Goal

Run the BDTA refactor as a single Node.js application in Plesk instead of maintaining separate `web`, `api`, and `jobs` apps.

The supported startup target for this mode is:

```text
app.js
```

This runtime serves:

- public site
- portal
- admin UI
- `/api/*` routes
- background jobs in the same process

## Plesk Node.js Settings

- Application Mode: `production`
- Application Root: the `refactor` directory that contains `package.json`
- Application Startup File: `app.js`
- Document Root: `public`

`app.js` is a thin wrapper that starts the unified platform runtime from `dist/apps/platform/src/main.js` and fails with an explicit build message if the compiled output is missing.

## Build

From the application root:

```bash
npm install
npm run build
npm run validate:plesk
```

Then restart the Node.js app from the Plesk panel.

`npm run validate:plesk` now performs:

1. single-app deployment artifact validation
2. `.env.production.example` template validation
3. when runtime env is available in the shell, merged startup-env validation and a dry-run launch preflight against the configured database

## Important Plesk Shell Caveat

Plesk custom environment variables are attached to the managed Node.js app process, not to a normal SSH or Plesk terminal shell session.

That means this shell command is **not** a valid substitute for restarting the app from the Plesk Node.js page unless you also export the full runtime env manually:

```bash
npm run start:platform
```

If you run it in a plain shell, you may see missing-env startup errors even when the Plesk app itself is configured correctly.

The runtime now also auto-loads `.env.production` from the application root before reading config. That means a shell start like `npm run start:platform` will work as long as `.env.production` contains the required DB values.

If the shell stack trace still says `Missing required DATABASE_URL environment variable.`, the uploaded source tree is stale. The current runtime accepts either `DATABASE_URL` or the legacy `DB_*` variables through `@bdta/platform` environment resolution. In that case, re-upload the latest `refactor` source tree, rebuild, and restart the app from Plesk.

The same caveat applies to `npm run validate:plesk`: if the shell cannot see `.env.production` or exported `DB_*` / `DATABASE_URL` values, the command will validate artifacts and the env template, then explicitly report that runtime env validation and launch preflight were skipped. In environments that intentionally use `.env.release-validation`, synthetic provider values are treated as validation warnings and the live-launch verdict is shown as `n/a` rather than a failed release pass.

The visual page editor is bundled into `public/assets/vendor/editor`, so Plesk does not need separate CDN allowances or additional app services for the CMS editor to work.

Inside the running admin UI, **Admin > Settings > Database** now shows the effective runtime values seen by the Node.js process. If a value is coming from the Plesk Node.js panel instead of `.env.production`, the UI marks it as a `Plesk App Env` override so operators can tell which source is actually winning at runtime.

## Required Environment Variables

Set these in Plesk:

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

You can also use `DATABASE_URL=mysql://...` instead of the legacy `DB_*` variables if you prefer.

## Settings-Managed Configuration

The old PHP platform stored secondary configuration in the database, and the TypeScript runtime now follows that model for single-app deployment.

Configure these through **Admin > Settings**, not Plesk env:

- `base_url`
- `business_email`
- `stripe_enabled`
- `stripe_mode`
- `stripe_test_publishable_key`
- `stripe_live_secret_key`
- `stripe_live_publishable_key`
- `stripe_test_secret_key`
- `stripe_webhook_secret`
- `turnstile_site_key`
- `turnstile_secret_key`
- `imap_enabled`
- `imap_host`
- `imap_port`
- `imap_encryption`
- `imap_username`
- `imap_password`
- `imap_folder`
- `imap_sync_days`
- `smtp_host`
- `smtp_port`
- `smtp_encryption`
- `smtp_username`
- `smtp_password`
- `smtp_debug`
- `google_oauth_client_id`
- `google_oauth_client_secret`
- `google_oauth_redirect_uri`
- `google_calendar_enabled`
- `google_calendar_id`
- `google_calendar_credentials_file`
- `sendgrid_api_key`
- `mailgun_api_key`
- `mailjet_api_key`
- `mailjet_api_secret`
- `mailjet_newsletter_list_id`
- `moxie_base_url`
- `moxie_api_key`
- `tawk_to_enabled`
- `tawk_to_property_id`
- `tawk_to_widget_id`
- `newsletter_embed_html`

The jobs runtime and launch-readiness checks now read those values from the `settings` table, with env only acting as an optional override.

Public runtime note:
- `newsletter_embed_html` is now rendered on the public CMS and blog pages from Admin > Settings.
- `tawk_to_enabled`, `tawk_to_property_id`, and `tawk_to_widget_id` now control the live visitor chat embed without any matching `.env` entries.

## Launch Checklist For Admin Settings

Before treating the single-app deployment as live-launch ready, verify that **Admin > Settings** contains populated values for:

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

`stripe_test_secret_key` may remain populated for non-production validation, but live launch should use the live Stripe secret with `stripe_mode=live`. `stripe_webhook_secret` should match the signing secret for the Stripe endpoint that posts to `/api/callbacks/stripe`.

## Recommended Restart Flow

After changing code or env:

1. `npm install`
2. `npm run build`
3. `npm run validate:plesk`
4. `npm run validate:env -- --use-startup-env --mode runtime`
5. restart the Node.js app in Plesk

## Optional `.env.production` For Shell Startup

If you want `npm run start:platform` to work from a terminal without manually exporting DB vars, create `.env.production` in the application root with:

```text
DB_TYPE=mysql
DB_HOST=localhost
DB_PORT=3306
DB_NAME=bdta
DB_USER=bdta_user
DB_PASSWORD=your_mysql_password
SESSION_LIFETIME_SECONDS=1209600
```

With that file in place, both `npm run validate:env -- --use-startup-env --mode runtime` and the runtime/launch-preflight portion of `npm run validate:plesk` can run from a normal shell session.

## Health Check

The single app exposes:

```text
/health
```

This gives the Plesk app one health endpoint while the unified runtime handles both web and API traffic behind the scenes.
