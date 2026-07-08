import { runMigrationCli } from "../apps/migrate/src/cli.js";

describe("migration cli", () => {
  it("returns success and closes resources when cutover execution is clear", async () => {
    const outputs: string[] = [];
    let closed = false;

    const exitCode = await runMigrationCli({
      env: {
        DATABASE_URL: "mysql://user:password@db.example.test:3306/bdta",
        PORTAL_BASE_URL: "https://portal.example.test",
        MIGRATION_APPLY_BOOTSTRAP: "true",
        ROLLBACK_PLAN_DOCUMENTED: "true"
      },
      writeLine: (line) => {
        outputs.push(line);
      },
      runMigration: async (input) => ({
        manifest: { name: "bdta-migrate" },
        report: {
          executedAt: "2026-05-31T18:00:00.000Z",
          applyBootstrap: input.applyBootstrap,
          requireReady: input.requireReady,
          preflightReport: {
            executedAt: "2026-05-31T18:00:00.000Z",
            cutoverReport: {
              rehearsalId: input.rehearsalId,
              dryRun: input.dryRun,
              entitiesValidated: ["clients"],
              rollbackPlanDocumented: input.rollbackPlanDocumented,
              executedAt: "2026-05-31T18:00:00.000Z",
              entityAudits: [],
              tokenAudits: [],
              blockingIssues: [],
              readyForCutover: true
            },
            environmentAudits: [],
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
            runtimeTableAudits: [],
            blockingIssues: [],
            readyForLaunch: true
          },
          bootstrapStatementAudits: [],
          blockingIssues: [],
          executionBlocked: false,
          bootstrapApplied: true
        },
        closePool: async () => {
          closed = true;
        }
      })
    });

    expect(exitCode).toBe(0);
    expect(closed).toBe(true);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toContain("\"bootstrapApplied\": true");
  });

  it("returns a nonzero exit code when launch readiness is blocked", async () => {
    let closed = false;

    const exitCode = await runMigrationCli({
      env: {
        DATABASE_URL: "mysql://user:password@db.example.test:3306/bdta",
        MIGRATION_APPLY_BOOTSTRAP: "false"
      },
      writeLine: () => undefined,
      runMigration: async () => ({
        manifest: { name: "bdta-migrate" },
        report: {
          executedAt: "2026-05-31T18:00:00.000Z",
          applyBootstrap: false,
          requireReady: true,
          preflightReport: {
            executedAt: "2026-05-31T18:00:00.000Z",
            cutoverReport: {
              rehearsalId: "cutover-rehearsal",
              dryRun: true,
              entitiesValidated: ["clients"],
              rollbackPlanDocumented: false,
              executedAt: "2026-05-31T18:00:00.000Z",
              entityAudits: [],
              tokenAudits: [],
              blockingIssues: ["Rollback plan is not documented."],
              readyForCutover: false
            },
            environmentAudits: [],
            runtimeConfigAudits: [
              { runtime: "api", valid: false, issues: ["Missing required PORTAL_BASE_URL environment variable."] },
              { runtime: "jobs", valid: true, issues: [] },
              { runtime: "web", valid: true, issues: [] }
            ],
            providerAudits: [
              { provider: "stripe", configured: false, liveModeReady: false, mode: "unknown", issues: ["Missing required STRIPE_SECRET_KEY environment variable."] },
              { provider: "turnstile", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
              { provider: "imap", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
              { provider: "smtp", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
              { provider: "google_oauth", configured: true, liveModeReady: true, mode: "n/a", issues: [] }
            ],
            operationalAudits: [
              { area: "backups", ready: false, issues: ["Backup plan is not documented."] },
              { area: "monitoring", ready: true, issues: [] },
              { area: "error_logging", ready: true, issues: [] }
            ],
            runtimeTableAudits: [],
            blockingIssues: ["Rollback plan is not documented."],
            readyForLaunch: false
          },
          bootstrapStatementAudits: [],
          blockingIssues: ["Rollback plan is not documented."],
          executionBlocked: false,
          bootstrapApplied: false
        },
        closePool: async () => {
          closed = true;
        }
      })
    });

    expect(exitCode).toBe(1);
    expect(closed).toBe(true);
  });
});
