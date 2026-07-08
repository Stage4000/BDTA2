import { readMigrationConfig } from "../apps/migrate/src/config.js";

describe("migration config", () => {
  it("parses migration rehearsal settings from environment variables", () => {
    const config = readMigrationConfig({
      DATABASE_URL: "mysql://user:password@db.example.test:3307/bdta",
      MIGRATION_REHEARSAL_ID: "rehearsal-42",
      MIGRATION_DRY_RUN: "false",
      ROLLBACK_PLAN_DOCUMENTED: "true",
      MIGRATION_APPLY_BOOTSTRAP: "true",
      MIGRATION_REQUIRE_READY: "false"
    });

    expect(config).toEqual({
      databaseUrl: "mysql://user:password@db.example.test:3307/bdta",
      rehearsalId: "rehearsal-42",
      dryRun: false,
      rollbackPlanDocumented: true,
      applyBootstrap: true,
      requireReady: false
    });
  });

  it("rejects missing database configuration and invalid booleans", () => {
    expect(() => readMigrationConfig({
      MIGRATION_REHEARSAL_ID: "rehearsal-42"
    })).toThrow("Missing required database configuration. Set DATABASE_URL or DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD.");

    expect(() => readMigrationConfig({
      DATABASE_URL: "mysql://user:password@db.example.test:3306/bdta",
      MIGRATION_DRY_RUN: "sometimes"
    })).toThrow("Invalid MIGRATION_DRY_RUN value.");

    expect(() => readMigrationConfig({
      DATABASE_URL: "mysql://user:password@db.example.test:3306/bdta",
      MIGRATION_APPLY_BOOTSTRAP: "maybe"
    })).toThrow("Invalid MIGRATION_APPLY_BOOTSTRAP value.");
  });
});
