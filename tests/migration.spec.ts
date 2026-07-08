import {
  buildCutoverExecutionReport,
  buildCutoverRehearsalReport,
  buildLaunchPreflightReport,
  defaultLegacyMappings,
  defaultLaunchPreflightRuntimeTables,
  defaultTokenizedPublicLinkMappings,
  type MigrationAuditDependencies
} from "@bdta/application";

describe("migration rehearsal", () => {
  it("builds a ready cutover report when legacy counts and tokens validate cleanly", async () => {
    const rowCounts: Record<string, number> = {
      clients: 180,
      pets: 220,
      bookings: 340,
      invoices: 120,
      quotes: 46,
      contracts: 38,
      form_submissions: 96,
      packages: 8,
      client_package_credits: 74,
      settings: 32,
      workflows: 6,
      workflow_triggers: 4,
      workflow_steps: 18,
      workflow_step_executions: 42,
      scheduled_tasks: 5,
      notifications: 18,
      admin_users: 4
    };
    const missingTokenCounts: Record<string, number> = {
      "quotes.access_token": 0,
      "contracts.access_token": 0,
      "form_submissions.access_token": 0,
      "bookings.ical_token": 0
    };
    const dependencies: MigrationAuditDependencies = {
      now: () => "2026-05-29T18:00:00.000Z",
      countLegacyRows: async (table) => rowCounts[table] ?? 0,
      countRowsMissingToken: async (table, field) => missingTokenCounts[`${table}.${field}`] ?? 0
    };

    const report = await buildCutoverRehearsalReport({
      rehearsalId: "rehearsal-1",
      dryRun: true,
      rollbackPlanDocumented: true
    }, dependencies);

    expect(report.rehearsalId).toBe("rehearsal-1");
    expect(report.readyForCutover).toBe(true);
    expect(report.entityAudits).toHaveLength(defaultLegacyMappings.length);
    expect(report.tokenAudits).toHaveLength(defaultTokenizedPublicLinkMappings.length);
    expect(report.entitiesValidated).toEqual(defaultLegacyMappings.map((mapping) => mapping.entity));
    expect(report.entityAudits.find((audit) => audit.entity === "clients")?.legacyRowCount).toBe(180);
    expect(report.entityAudits.find((audit) => audit.entity === "settings")?.legacyRowCount).toBe(32);
    expect(report.entityAudits.find((audit) => audit.entity === "workflow_steps")?.legacyRowCount).toBe(18);
    expect(report.entityAudits.find((audit) => audit.entity === "workflow_triggers")?.legacyRowCount).toBe(4);
    expect(report.entityAudits.find((audit) => audit.entity === "workflow_step_executions")?.legacyRowCount).toBe(42);
    expect(report.tokenAudits.find((audit) => audit.resourceKind === "booking_ical")?.missingTokenCount).toBe(0);
    expect(report.blockingIssues).toEqual([]);
  });

  it("marks cutover blocked when rollback is undocumented or required access tokens are missing", async () => {
    const dependencies: MigrationAuditDependencies = {
      now: () => "2026-05-29T18:00:00.000Z",
      countLegacyRows: async (table) => table === "quotes" ? 4 : 1,
      countRowsMissingToken: async (table, field) => table === "quotes" && field === "access_token" ? 2 : 0
    };

    const report = await buildCutoverRehearsalReport({
      rehearsalId: "rehearsal-2",
      dryRun: false,
      rollbackPlanDocumented: false
    }, dependencies);

    expect(report.readyForCutover).toBe(false);
    expect(report.blockingIssues).toContain("Rollback plan is not documented.");
    expect(report.blockingIssues).toContain("Required public-link tokens are missing for quote records.");
    expect(report.tokenAudits.find((audit) => audit.resourceKind === "quote")?.missingTokenCount).toBe(2);
  });

  it("builds a launch preflight report when cutover, runtime tables, and app environment are ready", async () => {
    const dependencies: MigrationAuditDependencies & { tableExists(table: string): Promise<boolean> } = {
      now: () => "2026-05-31T16:00:00.000Z",
      countLegacyRows: async () => 12,
      countRowsMissingToken: async () => 0,
      tableExists: async () => true
    };

    const report = await buildLaunchPreflightReport({
      rehearsalId: "launch-preflight-1",
      dryRun: true,
      rollbackPlanDocumented: true,
      runtimeConfigAudits: [
        { runtime: "api", valid: true, issues: [] },
        { runtime: "jobs", valid: true, issues: [] },
        { runtime: "web", valid: true, issues: [] }
      ],
      providerAudits: [
        { provider: "stripe", configured: true, liveModeReady: true, mode: "live", issues: [] },
        { provider: "turnstile", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
        { provider: "imap", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
        { provider: "smtp", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
        { provider: "google_oauth", configured: true, liveModeReady: true, mode: "n/a", issues: [] }
      ],
      operationalAudits: [
        { area: "backups", ready: true, issues: [] },
        { area: "monitoring", ready: true, issues: [] },
        { area: "error_logging", ready: true, issues: [] }
      ],
      environment: {
        DATABASE_URL: "mysql://user:password@db.example.test:3306/bdta",
        PORTAL_BASE_URL: "https://portal.example.test"
      }
    }, dependencies);

    expect(report.readyForLaunch).toBe(true);
    expect(report.cutoverReport.readyForCutover).toBe(true);
    expect(report.environmentAudits.find((audit) => audit.runtime === "api")?.missingVariables).toEqual([]);
    expect(report.environmentAudits.find((audit) => audit.runtime === "jobs")?.missingVariables).toEqual([]);
    expect(report.environmentAudits.find((audit) => audit.runtime === "web")?.missingVariables).toEqual([]);
    expect(report.runtimeConfigAudits.every((audit) => audit.valid)).toBe(true);
    expect(report.providerAudits.every((audit) => audit.configured && audit.liveModeReady)).toBe(true);
    expect(report.operationalAudits.every((audit) => audit.ready)).toBe(true);
    expect(report.runtimeTableAudits).toHaveLength(defaultLaunchPreflightRuntimeTables.length);
    expect(report.runtimeTableAudits.find((audit) => audit.table === "settings")?.exists).toBe(true);
    expect(report.runtimeTableAudits.every((audit) => audit.exists)).toBe(true);
    expect(report.runtimeTableAudits.find((audit) => audit.table === "workflow_triggers")?.exists).toBe(true);
    expect(report.runtimeTableAudits.find((audit) => audit.table === "workflow_steps")?.exists).toBe(true);
    expect(report.runtimeTableAudits.find((audit) => audit.table === "workflow_step_executions")?.exists).toBe(true);
    expect(report.blockingIssues).toEqual([]);
  });

  it("blocks launch preflight when required environment or runtime tables are missing", async () => {
    const dependencies: MigrationAuditDependencies & { tableExists(table: string): Promise<boolean> } = {
      now: () => "2026-05-31T16:00:00.000Z",
      countLegacyRows: async () => 4,
      countRowsMissingToken: async () => 0,
      tableExists: async (table) => table !== "job_queue"
    };

    const report = await buildLaunchPreflightReport({
      rehearsalId: "launch-preflight-2",
      dryRun: false,
      rollbackPlanDocumented: false,
      runtimeConfigAudits: [
        { runtime: "api", valid: false, issues: ["Invalid PORT value."] },
        { runtime: "jobs", valid: true, issues: [] },
        { runtime: "web", valid: true, issues: [] }
      ],
      providerAudits: [
        { provider: "stripe", configured: true, liveModeReady: false, mode: "test", issues: ["Stripe secret key is configured in test mode."] },
        { provider: "turnstile", configured: false, liveModeReady: false, mode: "unknown", issues: ["Missing required TURNSTILE_SECRET_KEY environment variable."] },
        { provider: "imap", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
        { provider: "smtp", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
        { provider: "google_oauth", configured: true, liveModeReady: true, mode: "n/a", issues: [] }
      ],
      operationalAudits: [
        { area: "backups", ready: false, issues: ["Backup plan is not documented."] },
        { area: "monitoring", ready: false, issues: ["Monitoring configuration is not documented."] },
        { area: "error_logging", ready: true, issues: [] }
      ],
      environment: {}
    }, dependencies);

    expect(report.readyForLaunch).toBe(false);
    expect(report.cutoverReport.readyForCutover).toBe(false);
    expect(report.blockingIssues).toContain("Rollback plan is not documented.");
    expect(report.blockingIssues).toContain("Missing required environment variables for api: DATABASE_URL.");
    expect(report.blockingIssues).toContain("Missing required environment variables for jobs: DATABASE_URL.");
    expect(report.blockingIssues).toContain("Missing required environment variables for web: DATABASE_URL.");
    expect(report.blockingIssues).toContain("Invalid runtime configuration for api: Invalid PORT value.");
    expect(report.blockingIssues).toContain("Provider readiness failed for stripe: Stripe secret key is configured in test mode.");
    expect(report.blockingIssues).toContain("Provider readiness failed for turnstile: Missing required TURNSTILE_SECRET_KEY environment variable.");
    expect(report.blockingIssues).toContain("Operational readiness failed for backups: Backup plan is not documented.");
    expect(report.blockingIssues).toContain("Operational readiness failed for monitoring: Monitoring configuration is not documented.");
    expect(report.blockingIssues).toContain("Required runtime table is missing: job_queue.");
    expect(report.runtimeTableAudits.find((audit) => audit.table === "job_queue")?.exists).toBe(false);
  });

  it("executes bootstrap statements when launch preflight passes and execution is requested", async () => {
    const executedStatements: string[] = [];
    const report = await buildCutoverExecutionReport({
      rehearsalId: "cutover-exec-1",
      dryRun: false,
      rollbackPlanDocumented: true,
      applyBootstrap: true,
      requireReady: true,
      bootstrapStatements: [
        "CREATE TABLE IF NOT EXISTS email_outbox (id BIGINT PRIMARY KEY)",
        "CREATE INDEX idx_job_queue_status_run_at ON job_queue(status, run_at)"
      ],
      environment: {
        DATABASE_URL: "mysql://user:password@db.example.test:3306/bdta",
        PORTAL_BASE_URL: "https://portal.example.test"
      }
    }, {
      now: () => "2026-05-31T16:30:00.000Z",
      countLegacyRows: async () => 8,
      countRowsMissingToken: async () => 0,
      tableExists: async () => true,
      applyBootstrapStatement: async (statement) => {
        executedStatements.push(statement);
        return true;
      }
    });

    expect(report.executionBlocked).toBe(false);
    expect(report.bootstrapApplied).toBe(true);
    expect(report.bootstrapStatementAudits.every((audit) => audit.executed)).toBe(true);
    expect(executedStatements).toEqual([
      "CREATE TABLE IF NOT EXISTS email_outbox (id BIGINT PRIMARY KEY)",
      "CREATE INDEX idx_job_queue_status_run_at ON job_queue(status, run_at)"
    ]);
  });

  it("blocks bootstrap execution when readiness is required and launch preflight fails", async () => {
    const executedStatements: string[] = [];
    const report = await buildCutoverExecutionReport({
      rehearsalId: "cutover-exec-2",
      dryRun: false,
      rollbackPlanDocumented: false,
      applyBootstrap: true,
      requireReady: true,
      bootstrapStatements: ["CREATE TABLE IF NOT EXISTS email_outbox (id BIGINT PRIMARY KEY)"],
      environment: {
        DATABASE_URL: "mysql://user:password@db.example.test:3306/bdta"
      }
    }, {
      now: () => "2026-05-31T16:30:00.000Z",
      countLegacyRows: async () => 8,
      countRowsMissingToken: async () => 0,
      tableExists: async () => false,
      applyBootstrapStatement: async (statement) => {
        executedStatements.push(statement);
        return true;
      }
    });

    expect(report.executionBlocked).toBe(true);
    expect(report.bootstrapApplied).toBe(false);
    expect(report.blockingIssues).toContain("Launch preflight is not ready; bootstrap execution was blocked.");
    expect(executedStatements).toEqual([]);
  });
});
