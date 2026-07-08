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
    expect(executor.calls[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS settings");
    expect(executor.calls.some((call) => call.sql.includes("CREATE TABLE IF NOT EXISTS email_outbox"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("CREATE TABLE IF NOT EXISTS job_queue"))).toBe(true);
    expect(runtime.server).toBeDefined();
    expect(runtime.sessionStore).toBeDefined();
  });

  it("skips existing bootstrap indexes so repeated startup stays idempotent", async () => {
    class ExistingIndexExecutor extends RecordingExecutor {
      override async execute<T>(sql: string, params: unknown[] = []): Promise<[T, { affectedRows?: number }]> {
        this.calls.push({ sql, params });
        if (sql.includes("information_schema.statistics")) {
          return [[{ indexName: String(params[1] ?? "existing_index") }] as unknown as T, { affectedRows: 0 }];
        }

        return [[] as unknown as T, { affectedRows: 0 }];
      }
    }

    const executor = new ExistingIndexExecutor();

    await buildProductionApiRuntime({
      executor,
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      sessionTtlSeconds: 3600
    });

    expect(executor.calls.some((call) => call.sql.includes("information_schema.statistics"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("CREATE INDEX"))).toBe(false);
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
    await started.stop();
  });

  it("logs unexpected request failures through the production api bootstrap", async () => {
    class FailingSessionExecutor extends RecordingExecutor {
      override async execute<T>(sql: string, params: unknown[] = []): Promise<[T, { affectedRows?: number }]> {
        this.calls.push({ sql, params });
        if (sql.includes("information_schema.statistics")) {
          return [[{ indexName: String(params[1] ?? "existing_index") }] as unknown as T, { affectedRows: 0 }];
        }

        if (sql.includes("FROM app_sessions")) {
          throw new Error("session lookup failed");
        }

        return [[] as unknown as T, { affectedRows: 0 }];
      }
    }

    const logged: unknown[][] = [];
    const executor = new FailingSessionExecutor();
    const runtime = await startProductionApiServer({
      executor,
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      sessionTtlSeconds: 3600,
      logger: {
        error: (...args: unknown[]) => {
          logged.push(args);
        },
        info: () => undefined
      },
      listen: {
        host: "127.0.0.1",
        port: 0
      }
    });

    const address = runtime.server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/me`, {
        headers: {
          cookie: "bdta_session=session-1"
        }
      });
      expect(response.status).toBe(500);
      expect(logged).toHaveLength(1);
      expect(logged[0]?.[0]).toBe("[bdta-api] request failed");
      expect(logged[0]?.[1]).toMatchObject({
        method: "GET",
        path: "/api/admin/me"
      });
      expect(logged[0]?.[1]).toHaveProperty("requestId");
      expect(logged[0]?.[2]).toBeInstanceOf(Error);
    } finally {
      await runtime.stop();
    }
  });

  it("logs request completions through the production api bootstrap", async () => {
    const logged: unknown[][] = [];
    const executor = new RecordingExecutor();
    const runtime = await startProductionApiServer({
      executor,
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      sessionTtlSeconds: 3600,
      logger: {
        error: () => undefined,
        info: (...args: unknown[]) => {
          logged.push(args);
        }
      },
      listen: {
        host: "127.0.0.1",
        port: 0
      }
    });

    const address = runtime.server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      expect(response.status).toBe(200);
      expect(logged).toHaveLength(1);
      expect(logged[0]?.[0]).toBe("[bdta-api] request completed");
      expect(logged[0]?.[1]).toMatchObject({
        method: "GET",
        path: "/health",
        statusCode: 200
      });
      expect(logged[0]?.[1]).toHaveProperty("requestId");
      expect(typeof logged[0]?.[1]).toBe("object");
    } finally {
      await runtime.stop();
    }
  });
});
