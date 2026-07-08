import { resolveDatabaseUrl } from "@bdta/platform";

function parseBoolean(value: string | undefined, envName: string, defaultValue: boolean): boolean {
  if (value == null || value.trim() === "") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }

  throw new Error(`Invalid ${envName} value.`);
}

export type MigrationConfig = {
  databaseUrl: string;
  rehearsalId: string;
  dryRun: boolean;
  rollbackPlanDocumented: boolean;
  applyBootstrap: boolean;
  requireReady: boolean;
};

export function readMigrationConfig(env: NodeJS.ProcessEnv): MigrationConfig {
  return {
    databaseUrl: resolveDatabaseUrl(env),
    rehearsalId: env.MIGRATION_REHEARSAL_ID?.trim() || "cutover-rehearsal",
    dryRun: parseBoolean(env.MIGRATION_DRY_RUN, "MIGRATION_DRY_RUN", true),
    rollbackPlanDocumented: parseBoolean(env.ROLLBACK_PLAN_DOCUMENTED, "ROLLBACK_PLAN_DOCUMENTED", false),
    applyBootstrap: parseBoolean(env.MIGRATION_APPLY_BOOTSTRAP, "MIGRATION_APPLY_BOOTSTRAP", false),
    requireReady: parseBoolean(env.MIGRATION_REQUIRE_READY, "MIGRATION_REQUIRE_READY", true)
  };
}
