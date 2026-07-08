import { startProductionPlatformServer } from "../apps/platform/src/bootstrap.js";
import type { SqlExecutor } from "@bdta/infrastructure";

class RecordingExecutor implements SqlExecutor {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];

  async execute<T>(sql: string, params: unknown[] = []): Promise<[T, { affectedRows?: number }]> {
    this.calls.push({ sql, params });
    if (sql.includes("information_schema.statistics")) {
      return [[{ indexName: String(params[1] ?? "existing_index") }] as unknown as T, { affectedRows: 0 }];
    }

    return [[] as unknown as T, { affectedRows: 0 }];
  }
}

describe("platform bootstrap", () => {
  it("starts one server that exposes both web and api routes and starts the job worker", async () => {
    const executor = new RecordingExecutor();
    let workerStarted = false;
    let workerStopped = false;

    const runtime = await startProductionPlatformServer({
      executor,
      portalBaseUrl: "https://dev.example.test",
      sessionTtlSeconds: 1209600,
      jobBatchSize: 25,
      emailBatchSize: 25,
      pollIntervalMs: 30000,
      listen: {
        host: "127.0.0.1",
        port: 0
      }
    }, {
      logger: {
        error: () => undefined,
        info: () => undefined
      },
      jobWorkerFactory: async () => {
        workerStarted = true;
        return {
          async stop() {
            workerStopped = true;
          }
        };
      }
    });

    const address = runtime.server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    try {
      const webResponse = await fetch(`http://127.0.0.1:${address.port}/portal/login`);
      expect(webResponse.status).toBe(200);

      const apiResponse = await fetch(`http://127.0.0.1:${address.port}/api/session`);
      expect(apiResponse.status).toBe(200);

      expect(workerStarted).toBe(true);
      expect(executor.calls[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS settings");
      expect(executor.calls.some((call) => call.sql.includes("CREATE TABLE IF NOT EXISTS email_outbox"))).toBe(true);
    } finally {
      await runtime.stop();
    }

    expect(workerStopped).toBe(true);
  });
});
