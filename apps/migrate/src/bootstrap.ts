import { buildCutoverExecutionReport } from "@bdta/application";
import {
  applyMySqlBootstrapStatement,
  createMySqlMigrationAuditDependencies,
  createMySqlPoolFromDatabaseUrl,
  getMySqlBootstrapStatements,
  type SqlExecutor
} from "@bdta/infrastructure";
import {
  buildOperationalAudits,
  buildProviderAudits,
  buildRuntimeConfigAudits,
  defaultOperationsDocumentationPaths,
  normalizeResolvedEnvironment,
  requiredLaunchSettingsCatalog,
  resolveDocumentationReadiness
} from "@bdta/platform";

import { migrationRuntimeManifest } from "./index.js";

type MigrationRuntimeOptions = {
  executor: SqlExecutor;
  rehearsalId: string;
  dryRun: boolean;
  rollbackPlanDocumented: boolean;
  applyBootstrap: boolean;
  requireReady: boolean;
  environment?: Record<string, string | undefined>;
  now?: () => string;
  workspaceRoot?: string;
};

function isMissingTableError(error: unknown, tableName?: string): boolean {
  const code = typeof error === "object" && error != null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const errno = typeof error === "object" && error != null && "errno" in error
    ? Number((error as { errno?: unknown }).errno)
    : Number.NaN;
  const message = error instanceof Error ? error.message : String(error);
  const targetsNamedTable = tableName == null || new RegExp(tableName, "i").test(message);

  return code === "ER_NO_SUCH_TABLE"
    || errno === 1146
    || (targetsNamedTable && /(doesn't exist|unknown table|no such table)/i.test(message));
}

async function loadLaunchSettings(executor: SqlExecutor): Promise<Record<string, string>> {
  const relevantKeys = [
    ...requiredLaunchSettingsCatalog.keys(),
    "google_calendar_enabled"
  ];
  let settingsSourceMissing = false;

  const placeholders = relevantKeys.map(() => "?").join(", ");
  const rows = await (async () => {
    try {
      const [queryRows] = await executor.execute<Array<{ setting_key: string; setting_value: string | null }>>(
        [
          "SELECT setting_key, setting_value",
          "FROM settings",
          `WHERE setting_key IN (${placeholders})`
        ].join(" "),
        relevantKeys
      );
      return queryRows;
    } catch (error) {
      if (isMissingTableError(error, "settings")) {
        settingsSourceMissing = true;
        return [];
      }

      throw error;
    }
  })();

  const loaded = rows.reduce<Record<string, string>>((accumulator, row) => {
    accumulator[row.setting_key] = row.setting_value?.trim() ?? "";
    return accumulator;
  }, {});

  if (settingsSourceMissing) {
    loaded.__settings_source_missing = "1";
  }

  return loaded;
}

export async function buildMigrationRuntime(options: MigrationRuntimeOptions) {
  const baseDependencies = createMySqlMigrationAuditDependencies(options.executor, {
    now: options.now
  });
  const dependencies = {
    ...baseDependencies,
    async countLegacyRows(table: string) {
      try {
        return await baseDependencies.countLegacyRows(table);
      } catch (error) {
        if ((table === "settings" || table === "workflow_triggers") && isMissingTableError(error, table)) {
          return 0;
        }

        throw error;
      }
    }
  };
  const settings = await loadLaunchSettings(options.executor);
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const rollbackPlanDocumented = options.rollbackPlanDocumented || resolveDocumentationReadiness(options.environment, workspaceRoot, {
    explicitFlagName: "ROLLBACK_PLAN_DOCUMENTED",
    pathName: "ROLLBACK_PLAN_PATH",
    defaultRelativePath: defaultOperationsDocumentationPaths.rollback
  });

  const report = await buildCutoverExecutionReport({
    rehearsalId: options.rehearsalId,
    dryRun: options.dryRun,
    rollbackPlanDocumented,
    applyBootstrap: options.applyBootstrap,
    requireReady: options.requireReady,
    bootstrapStatements: getMySqlBootstrapStatements(),
    runtimeConfigAudits: buildRuntimeConfigAudits(options.environment, settings),
    providerAudits: buildProviderAudits(options.environment, settings),
    operationalAudits: buildOperationalAudits(options.environment, workspaceRoot),
    environment: normalizeResolvedEnvironment(options.environment ?? {})
  }, {
    ...dependencies,
    async applyBootstrapStatement(statement) {
      return applyMySqlBootstrapStatement(options.executor, statement);
    }
  });

  return {
    manifest: migrationRuntimeManifest,
    report
  };
}

export async function runMigrationRehearsalFromDatabaseUrl(input: {
  databaseUrl: string;
  rehearsalId: string;
  dryRun: boolean;
  rollbackPlanDocumented: boolean;
  applyBootstrap: boolean;
  requireReady: boolean;
  environment?: Record<string, string | undefined>;
  now?: () => string;
}): Promise<Awaited<ReturnType<typeof buildMigrationRuntime>> & { closePool(): Promise<void> }> {
  const pool = createMySqlPoolFromDatabaseUrl(input.databaseUrl);
  const executor: SqlExecutor = {
    async execute<T>(sql: string, params: unknown[] = []) {
      const [rows] = await pool.execute(sql, params as []);
      return [rows as T, rows as { insertId?: number; affectedRows?: number }];
    }
  };

  const runtime = await buildMigrationRuntime({
    executor,
    rehearsalId: input.rehearsalId,
    dryRun: input.dryRun,
    rollbackPlanDocumented: input.rollbackPlanDocumented,
    applyBootstrap: input.applyBootstrap,
    requireReady: input.requireReady,
    environment: input.environment,
    now: input.now
  });

  return {
    ...runtime,
    async closePool() {
      await pool.end();
    }
  };
}
