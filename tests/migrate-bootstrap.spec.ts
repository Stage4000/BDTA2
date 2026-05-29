import { buildMigrationRuntime } from "../apps/migrate/src/bootstrap.js";
import type { SqlExecutor } from "@bdta/infrastructure";

class RecordingExecutor implements SqlExecutor {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];

  async execute<T>(sql: string, params: unknown[] = []): Promise<[T, { affectedRows?: number }]> {
    this.calls.push({ sql, params });
    return [[{ rowCount: 1 }] as unknown as T, { affectedRows: 0 }];
  }
}

describe("migration bootstrap", () => {
  it("builds a MySQL-backed migration rehearsal report", async () => {
    const executor = new RecordingExecutor();

    const runtime = await buildMigrationRuntime({
      executor,
      rehearsalId: "rehearsal-1",
      dryRun: true,
      rollbackPlanDocumented: true,
      now: () => "2026-05-29T18:00:00.000Z"
    });

    expect(runtime.report.rehearsalId).toBe("rehearsal-1");
    expect(runtime.report.entityAudits.length).toBeGreaterThan(5);
    expect(runtime.report.tokenAudits.length).toBe(4);
    expect(executor.calls[0]?.sql).toContain("SELECT COUNT(*) AS rowCount FROM clients");
  });
});
