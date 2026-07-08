import type { CutoverExecutionReport } from "@bdta/contracts";

import { runMigrationRehearsalFromDatabaseUrl } from "./bootstrap.js";
import { readMigrationConfig } from "./config.js";

type MigrationCliRunner = (input: {
  databaseUrl: string;
  rehearsalId: string;
  dryRun: boolean;
  rollbackPlanDocumented: boolean;
  applyBootstrap: boolean;
  requireReady: boolean;
  environment?: Record<string, string | undefined>;
  now?: () => string;
}) => Promise<{
  report: CutoverExecutionReport;
  closePool(): Promise<void>;
}>;

type MigrationCliDependencies = {
  env: NodeJS.ProcessEnv;
  writeLine(line: string): void;
  runMigration?: MigrationCliRunner;
};

function shouldFailProcess(report: CutoverExecutionReport): boolean {
  return report.blockingIssues.length > 0 || report.executionBlocked;
}

export async function runMigrationCli(dependencies: MigrationCliDependencies): Promise<number> {
  const config = readMigrationConfig(dependencies.env);
  const runMigration = dependencies.runMigration ?? runMigrationRehearsalFromDatabaseUrl;
  const runtime = await runMigration({
    ...config,
    environment: dependencies.env
  });

  try {
    dependencies.writeLine(JSON.stringify(runtime.report, null, 2));
    return shouldFailProcess(runtime.report) ? 1 : 0;
  } finally {
    await runtime.closePool();
  }
}
