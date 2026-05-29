import { buildProductionApiRuntime, startProductionApiServer } from "../apps/api/src/bootstrap.js";
import type { SqlExecutor } from "@bdta/infrastructure";

class RecordingExecutor implements SqlExecutor {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];

  async execute<T>(sql: string, params: unknown[] = []): Promise<[T, { affectedRows?: number }]> {
    this.calls.push({ sql, params });
    return [[] as unknown as T, { affectedRows: 0 }];
  }
}

describe("production bootstrap", () => {
  it("applies bootstrap DDL before building the runtime", async () => {
    const executor = new RecordingExecutor();

    const runtime = await buildProductionApiRuntime({
      executor,
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      sessionTtlSeconds: 3600
    });

    expect(executor.calls.length).toBeGreaterThanOrEqual(4);
    expect(executor.calls[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS email_outbox");
    expect(executor.calls[1]?.sql).toContain("CREATE TABLE IF NOT EXISTS job_queue");
    expect(runtime.server).toBeDefined();
    expect(runtime.sessionStore).toBeDefined();
  });

  it("starts an http server from explicit bootstrap options", async () => {
    const executor = new RecordingExecutor();

    const started = await startProductionApiServer({
      executor,
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      sessionTtlSeconds: 3600,
      listen: {
        host: "127.0.0.1",
        port: 0
      }
    });

    const address = started.server.address();
    expect(address).not.toBeNull();

    await new Promise<void>((resolve, reject) => {
      started.server.close((error?: Error) => error ? reject(error) : resolve());
    });
  });
});
