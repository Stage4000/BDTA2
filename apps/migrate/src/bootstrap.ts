import { buildCutoverRehearsalReport } from "@bdta/application";
import {
  createMySqlMigrationAuditDependencies,
  createMySqlPoolFromDatabaseUrl,
  type SqlExecutor
} from "@bdta/infrastructure";

import { migrationRuntimeManifest } from "./index.js";

type MigrationRuntimeOptions = {
  executor: SqlExecutor;
  rehearsalId: string;
  dryRun: boolean;
  rollbackPlanDocumented: boolean;
  now?: () => string;
};

export async function buildMigrationRuntime(options: MigrationRuntimeOptions) {
  const report = await buildCutoverRehearsalReport({
    rehearsalId: options.rehearsalId,
    dryRun: options.dryRun,
    rollbackPlanDocumented: options.rollbackPlanDocumented
  }, createMySqlMigrationAuditDependencies(options.executor, {
    now: options.now
  }));

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
    now: input.now
  });

  return {
    ...runtime,
    async closePool() {
      await pool.end();
    }
  };
}
