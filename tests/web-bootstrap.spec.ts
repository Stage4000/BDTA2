import { startProductionWebServerFromDatabaseUrl } from "../apps/web/src/bootstrap.js";
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

describe("web production bootstrap", () => {
  it("uses idempotent bootstrap behavior before starting the web server", async () => {
    const executor = new RecordingExecutor();
    const server = await startProductionWebServerFromDatabaseUrl({
      databaseUrl: "mysql://user:password@db.example.test:3307/bdta",
      listen: {
        host: "127.0.0.1",
        port: 0
      }
    }, {
      executorFactory: () => executor,
      logger: {
        error: () => undefined,
        info: () => undefined
      },
      poolFactory: async () => ({
        end: async () => undefined
      })
    });

    expect(executor.calls[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS settings");
    expect(executor.calls.some((call) => call.sql.includes("CREATE TABLE IF NOT EXISTS email_outbox"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("information_schema.statistics"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("CREATE INDEX"))).toBe(false);

    await server.stop();
  });

  it("surfaces degraded health when the production database probe fails", async () => {
    class FailingHealthExecutor extends RecordingExecutor {
      override async execute<T>(sql: string, params: unknown[] = []): Promise<[T, { affectedRows?: number }]> {
        this.calls.push({ sql, params });
        if (sql.includes("information_schema.statistics")) {
          return [[{ indexName: String(params[1] ?? "existing_index") }] as unknown as T, { affectedRows: 0 }];
        }

        if (sql.includes("SELECT 1 AS ok")) {
          throw new Error("database unreachable");
        }

        return [[] as unknown as T, { affectedRows: 0 }];
      }
    }

    const executor = new FailingHealthExecutor();
    const runtime = await startProductionWebServerFromDatabaseUrl({
      databaseUrl: "mysql://user:password@db.example.test:3307/bdta",
      listen: {
        host: "127.0.0.1",
        port: 0
      }
    }, {
      executorFactory: () => executor,
      logger: {
        error: () => undefined,
        info: () => undefined
      },
      poolFactory: async () => ({
        end: async () => undefined
      })
    });

    const address = runtime.server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "degraded",
      checks: {
        database: "error"
      }
    });

    await runtime.stop();
  });

  it("logs unexpected request failures through the production web bootstrap", async () => {
    class FailingContentExecutor extends RecordingExecutor {
      override async execute<T>(sql: string, params: unknown[] = []): Promise<[T, { affectedRows?: number }]> {
        this.calls.push({ sql, params });
        if (sql.includes("information_schema.statistics")) {
          return [[{ indexName: String(params[1] ?? "existing_index") }] as unknown as T, { affectedRows: 0 }];
        }

        if (sql.includes("FROM site_pages")) {
          throw new Error("site page load failed");
        }

        return [[] as unknown as T, { affectedRows: 0 }];
      }
    }

    const logged: unknown[][] = [];
    const executor = new FailingContentExecutor();
    const runtime = await startProductionWebServerFromDatabaseUrl({
      databaseUrl: "mysql://user:password@db.example.test:3307/bdta",
      listen: {
        host: "127.0.0.1",
        port: 0
      }
    }, {
      executorFactory: () => executor,
      logger: {
        error: (...args: unknown[]) => {
          logged.push(args);
        },
        info: () => undefined
      },
      poolFactory: async () => ({
        end: async () => undefined
      })
    });

    const address = runtime.server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    expect(response.status).toBe(500);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.[0]).toBe("[bdta-web] request failed");
    expect(logged[0]?.[1]).toMatchObject({
      method: "GET",
      path: "/"
    });
    expect(logged[0]?.[1]).toHaveProperty("requestId");
    expect(logged[0]?.[2]).toBeInstanceOf(Error);

    await runtime.stop();
  });

  it("logs request completions through the production web bootstrap", async () => {
    const logged: unknown[][] = [];
    const executor = new RecordingExecutor();
    const runtime = await startProductionWebServerFromDatabaseUrl({
      databaseUrl: "mysql://user:password@db.example.test:3307/bdta",
      listen: {
        host: "127.0.0.1",
        port: 0
      }
    }, {
      executorFactory: () => executor,
      logger: {
        error: () => undefined,
        info: (...args: unknown[]) => {
          logged.push(args);
        }
      },
      poolFactory: async () => ({
        end: async () => undefined
      })
    });

    const address = runtime.server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(response.status).toBe(200);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.[0]).toBe("[bdta-web] request completed");
    expect(logged[0]?.[1]).toMatchObject({
      method: "GET",
      path: "/health",
      statusCode: 200
    });
    expect(logged[0]?.[1]).toHaveProperty("requestId");

    await runtime.stop();
  });
});
