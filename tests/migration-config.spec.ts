import { readMigrationConfig } from "../apps/migrate/src/config.js";

describe("migration config", () => {
  it("parses migration rehearsal settings from environment variables", () => {
    const config = readMigrationConfig({
      DATABASE_URL: "mysql://user:password@db.example.test:3307/bdta",
      MIGRATION_REHEARSAL_ID: "rehearsal-42",
      MIGRATION_DRY_RUN: "false",
      ROLLBACK_PLAN_DOCUMENTED: "true"
    });

    expect(config).toEqual({
      databaseUrl: "mysql://user:password@db.example.test:3307/bdta",
      rehearsalId: "rehearsal-42",
      dryRun: false,
      rollbackPlanDocumented: true
    });
  });

  it("rejects missing database configuration and invalid booleans", () => {
    expect(() => readMigrationConfig({
      MIGRATION_REHEARSAL_ID: "rehearsal-42"
    })).toThrow("Missing required DATABASE_URL environment variable.");

    expect(() => readMigrationConfig({
      DATABASE_URL: "mysql://user:password@db.example.test:3306/bdta",
      MIGRATION_DRY_RUN: "sometimes"
    })).toThrow("Invalid MIGRATION_DRY_RUN value.");
  });
});
