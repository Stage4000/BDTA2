import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildMigrationRuntime } from "../apps/migrate/src/bootstrap.js";
import type { SqlExecutor } from "@bdta/infrastructure";

class RecordingExecutor implements SqlExecutor {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];
  constructor(
    private readonly settings: Record<string, string> = {},
    private readonly options: {
      throwOnSettingsRead?: boolean;
    } = {}
  ) {}

  async execute<T>(sql: string, params: unknown[] = []): Promise<[T, { affectedRows?: number }]> {
    this.calls.push({ sql, params });
    if (sql.includes("information_schema.tables")) {
      return [[{ tableName: String(params[0] ?? "table") }] as unknown as T, { affectedRows: 0 }];
    }

    if (sql.includes("FROM settings")) {
      if (this.options.throwOnSettingsRead) {
        const error = new Error("Table 'bdta.settings' doesn't exist") as Error & {
          code?: string;
          errno?: number;
        };
        error.code = "ER_NO_SUCH_TABLE";
        error.errno = 1146;
        throw error;
      }

      const keys = params.map((value) => String(value));
      const rows = keys
        .filter((key) => key in this.settings)
        .map((key) => ({
          setting_key: key,
          setting_value: this.settings[key]
        }));
      return [rows as unknown as T, { affectedRows: 0 }];
    }

    if (sql.includes("TRIM(")) {
      return [[{ rowCount: 0 }] as unknown as T, { affectedRows: 0 }];
    }

    return [[{ rowCount: 1 }] as unknown as T, { affectedRows: 0 }];
  }
}

describe("migration bootstrap", () => {
  it("accepts repo-hosted operations runbooks as launch-readiness evidence when flags are omitted", async () => {
    const executor = new RecordingExecutor({
      base_url: "https://portal.example.test",
      stripe_enabled: "1",
      stripe_mode: "live",
      stripe_live_secret_key: "sk_live_launch_ready",
      stripe_webhook_secret: "whsec_live_launch_ready",
      turnstile_site_key: "turnstile-site-key",
      turnstile_secret_key: "ts_live_launch_ready",
      imap_enabled: "1",
      imap_host: "imap.example.test",
      smtp_host: "smtp.example.test",
      google_oauth_client_id: "google-client-id",
      google_oauth_client_secret: "google-client-secret"
    });
    const tempRoot = await mkdtemp(path.join(tmpdir(), "bdta-migrate-docs-"));
    const operationsDir = path.join(tempRoot, "docs", "operations");

    await mkdir(operationsDir, { recursive: true });
    await writeFile(path.join(operationsDir, "rollback-plan.md"), "# Rollback\n", "utf8");
    await writeFile(path.join(operationsDir, "backup-plan.md"), "# Backups\n", "utf8");
    await writeFile(path.join(operationsDir, "monitoring.md"), "# Monitoring\n", "utf8");
    await writeFile(path.join(operationsDir, "error-logging.md"), "# Error Logging\n", "utf8");

    try {
      const runtime = await buildMigrationRuntime({
        executor,
        rehearsalId: "rehearsal-doc-backed-ready",
        dryRun: true,
        rollbackPlanDocumented: false,
        now: () => "2026-05-29T18:00:00.000Z",
        applyBootstrap: false,
        requireReady: true,
        workspaceRoot: tempRoot,
        environment: {
          DB_HOST: "db.example.test",
          DB_PORT: "3306",
          DB_NAME: "bdta",
          DB_USER: "user",
          DB_PASSWORD: "password"
        }
      });

      expect(runtime.report.preflightReport.cutoverReport.readyForCutover).toBe(true);
      expect(runtime.report.preflightReport.operationalAudits.every((audit) => audit.ready)).toBe(true);
      expect(runtime.report.preflightReport.readyForLaunch).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("builds a MySQL-backed cutover execution report and can apply bootstrap statements", async () => {
    const executor = new RecordingExecutor({
      base_url: "https://portal.example.test",
      stripe_enabled: "1",
      stripe_mode: "live",
      stripe_live_secret_key: "sk_live_launch_ready",
      stripe_webhook_secret: "whsec_live_launch_ready",
      turnstile_site_key: "turnstile-site-key",
      turnstile_secret_key: "ts_live_launch_ready",
      imap_enabled: "1",
      imap_host: "imap.example.test",
      smtp_host: "smtp.example.test",
      google_oauth_client_id: "google-client-id",
      google_oauth_client_secret: "google-client-secret"
    });

    const runtime = await buildMigrationRuntime({
      executor,
      rehearsalId: "rehearsal-1",
      dryRun: true,
      rollbackPlanDocumented: true,
      now: () => "2026-05-29T18:00:00.000Z",
      applyBootstrap: true,
      requireReady: true,
      environment: {
        DB_HOST: "db.example.test",
        DB_PORT: "3306",
        DB_NAME: "bdta",
        DB_USER: "user",
        DB_PASSWORD: "password",
        BACKUP_PLAN_DOCUMENTED: "true",
        MONITORING_CONFIGURED: "true",
        ERROR_LOGGING_CONFIGURED: "true"
      }
    });

    expect(runtime.report.preflightReport.cutoverReport.rehearsalId).toBe("rehearsal-1");
    expect(runtime.report.preflightReport.cutoverReport.entityAudits.length).toBeGreaterThan(5);
    expect(runtime.report.preflightReport.cutoverReport.tokenAudits.length).toBe(4);
    expect(runtime.report.preflightReport.environmentAudits.find((audit) => audit.runtime === "api")?.missingVariables).toEqual([]);
    expect(runtime.report.preflightReport.runtimeConfigAudits.every((audit) => audit.valid)).toBe(true);
    expect(runtime.report.preflightReport.providerAudits.every((audit) => audit.configured && audit.liveModeReady)).toBe(true);
    expect(runtime.report.preflightReport.operationalAudits.every((audit) => audit.ready)).toBe(true);
    expect(runtime.report.bootstrapApplied).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("SELECT COUNT(*) AS rowCount FROM clients"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("information_schema.tables"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("CREATE TABLE IF NOT EXISTS app_sessions"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("CREATE TABLE IF NOT EXISTS email_outbox"))).toBe(true);
  });

  it("marks launch preflight invalid when runtime config parsing fails", async () => {
    const executor = new RecordingExecutor({
      base_url: "https://portal.example.test",
      stripe_enabled: "1",
      stripe_mode: "live",
      stripe_live_secret_key: "sk_live_launch_ready",
      stripe_webhook_secret: "whsec_live_launch_ready",
      turnstile_site_key: "turnstile-site-key",
      turnstile_secret_key: "ts_live_launch_ready",
      imap_enabled: "1",
      imap_host: "imap.example.test",
      smtp_host: "smtp.example.test",
      google_oauth_client_id: "google-client-id",
      google_oauth_client_secret: "google-client-secret"
    });

    const runtime = await buildMigrationRuntime({
      executor,
      rehearsalId: "rehearsal-invalid-config",
      dryRun: true,
      rollbackPlanDocumented: true,
      now: () => "2026-05-29T18:00:00.000Z",
      applyBootstrap: false,
      requireReady: true,
      environment: {
        DB_HOST: "db.example.test",
        DB_PORT: "3306",
        DB_NAME: "bdta",
        DB_USER: "user",
        DB_PASSWORD: "password",
        BACKUP_PLAN_DOCUMENTED: "true",
        MONITORING_CONFIGURED: "true",
        ERROR_LOGGING_CONFIGURED: "true",
        PORT: "not-a-number"
      }
    });

    expect(runtime.report.preflightReport.readyForLaunch).toBe(false);
    expect(runtime.report.preflightReport.runtimeConfigAudits.find((audit) => audit.runtime === "api")?.valid).toBe(false);
    expect(runtime.report.preflightReport.runtimeConfigAudits.find((audit) => audit.runtime === "web")?.valid).toBe(false);
    expect(runtime.report.blockingIssues).toContain("Invalid runtime configuration for api: Invalid PORT value.");
    expect(runtime.report.blockingIssues).toContain("Invalid runtime configuration for web: Invalid PORT value.");
  });

  it("marks launch preflight invalid when provider credentials are missing or not live-ready", async () => {
    const executor = new RecordingExecutor({
      base_url: "https://portal.example.test",
      stripe_enabled: "1",
      stripe_mode: "test",
      stripe_test_secret_key: "sk_test_launch_blocked",
      stripe_webhook_secret: "whsec_test_launch_blocked",
      turnstile_secret_key: "",
      imap_enabled: "1",
      imap_host: "imap.example.test",
      smtp_host: "",
      google_calendar_enabled: "1",
      google_oauth_client_id: "google-client-id",
      google_oauth_client_secret: ""
    });

    const runtime = await buildMigrationRuntime({
      executor,
      rehearsalId: "rehearsal-invalid-providers",
      dryRun: true,
      rollbackPlanDocumented: true,
      now: () => "2026-05-29T18:00:00.000Z",
      applyBootstrap: false,
      requireReady: true,
      environment: {
        DB_HOST: "db.example.test",
        DB_PORT: "3306",
        DB_NAME: "bdta",
        DB_USER: "user",
        DB_PASSWORD: "password",
        BACKUP_PLAN_DOCUMENTED: "false",
        MONITORING_CONFIGURED: "",
        ERROR_LOGGING_CONFIGURED: "true"
      }
    });

    expect(runtime.report.preflightReport.readyForLaunch).toBe(false);
    expect(runtime.report.preflightReport.providerAudits.find((audit) => audit.provider === "stripe")).toMatchObject({
      configured: true,
      liveModeReady: false,
      mode: "test"
    });
    expect(runtime.report.preflightReport.providerAudits.find((audit) => audit.provider === "turnstile")).toMatchObject({
      configured: false,
      liveModeReady: false
    });
    expect(runtime.report.blockingIssues).toContain("Provider readiness failed for stripe: Stripe secret key is configured in test mode.");
    expect(runtime.report.blockingIssues).toContain("Provider readiness failed for turnstile: Missing required turnstile settings.");
    expect(runtime.report.blockingIssues).toContain("Provider readiness failed for smtp: Missing required smtp settings.");
    expect(runtime.report.blockingIssues).toContain("Provider readiness failed for google_oauth: Missing required google_oauth settings.");
    expect(runtime.report.blockingIssues).toContain("Operational readiness failed for backups: Backup plan is not documented.");
    expect(runtime.report.blockingIssues).toContain("Operational readiness failed for monitoring: Monitoring configuration is not documented.");
  });

  it("treats synthetic validation env provider values as configured but not live-ready", async () => {
    const executor = new RecordingExecutor({
      base_url: "https://portal.validation.local",
      turnstile_site_key: "turnstile-site-key"
    });

    const runtime = await buildMigrationRuntime({
      executor,
      rehearsalId: "rehearsal-synthetic-validation-env",
      dryRun: true,
      rollbackPlanDocumented: true,
      now: () => "2026-05-29T18:00:00.000Z",
      applyBootstrap: false,
      requireReady: true,
      environment: {
        BDTA_VALIDATION_ENV_MODE: "synthetic",
        DATABASE_URL: "mysql://validation:validation@localhost:3306/bdta_validation",
        PORTAL_BASE_URL: "https://portal.validation.local",
        STRIPE_SECRET_KEY: "sk_test_release_validation",
        STRIPE_WEBHOOK_SECRET: "whsec_validation_secret",
        TURNSTILE_SITE_KEY: "turnstile-site-key",
        TURNSTILE_SECRET_KEY: "turnstile-validation-token",
        IMAP_HOST: "imap.validation.local",
        SMTP_HOST: "smtp.validation.local",
        GOOGLE_OAUTH_CLIENT_ID: "google-validation-client-id",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-validation-client-secret",
        BACKUP_PLAN_DOCUMENTED: "true",
        MONITORING_CONFIGURED: "true",
        ERROR_LOGGING_CONFIGURED: "true"
      }
    });

    expect(runtime.report.preflightReport.readyForLaunch).toBe(false);
    expect(runtime.report.preflightReport.providerAudits.find((audit) => audit.provider === "stripe")).toMatchObject({
      configured: true,
      liveModeReady: false,
      mode: "synthetic"
    });
    expect(runtime.report.preflightReport.providerAudits.find((audit) => audit.provider === "turnstile")).toMatchObject({
      configured: true,
      liveModeReady: false,
      mode: "synthetic"
    });
    expect(runtime.report.blockingIssues).toContain("Provider readiness failed for stripe: Synthetic validation value is in use.");
    expect(runtime.report.blockingIssues).toContain("Provider readiness failed for turnstile: Synthetic validation value is in use.");
    expect(runtime.report.blockingIssues).toContain("Provider readiness failed for google_oauth: Synthetic validation value is in use.");
  });

  it("handles missing settings-table reads without crashing before bootstrap", async () => {
    const executor = new RecordingExecutor({}, {
      throwOnSettingsRead: true
    });

    const runtime = await buildMigrationRuntime({
      executor,
      rehearsalId: "rehearsal-missing-settings-table",
      dryRun: true,
      rollbackPlanDocumented: true,
      now: () => "2026-05-29T18:00:00.000Z",
      applyBootstrap: false,
      requireReady: false,
      environment: {
        DB_HOST: "db.example.test",
        DB_PORT: "3306",
        DB_NAME: "bdta",
        DB_USER: "user",
        DB_PASSWORD: "password",
        BACKUP_PLAN_DOCUMENTED: "true",
        MONITORING_CONFIGURED: "true",
        ERROR_LOGGING_CONFIGURED: "true"
      }
    });

    expect(runtime.report.preflightReport.readyForLaunch).toBe(false);
    expect(runtime.report.preflightReport.providerAudits.find((audit) => audit.provider === "stripe")?.configured).toBe(false);
    expect(runtime.report.blockingIssues).toContain("Invalid runtime configuration for api: Missing configured portal base URL. Set settings.base_url or PORTAL_BASE_URL.");
    expect(runtime.report.blockingIssues).toContain("Invalid runtime configuration for jobs: Missing configured portal base URL. Set settings.base_url or PORTAL_BASE_URL.");
  });
});
