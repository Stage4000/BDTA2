import {
  applyMySqlBootstrap,
  createMySqlApiDependencies,
  createMySqlPoolFromDatabaseUrl,
  type SqlExecutor
} from "@bdta/infrastructure";

import { createHttpWebServer } from "./server.js";
import type { WebServerConfig } from "./config.js";

type WebBootstrapOverrides = {
  executorFactory?: (pool: Awaited<ReturnType<typeof createMySqlPoolFromDatabaseUrl>>) => SqlExecutor;
  poolFactory?: (config: WebServerConfig) => Promise<{ end(): Promise<void>; execute?: never }> | Promise<ReturnType<typeof createMySqlPoolFromDatabaseUrl>> | { end(): Promise<void>; execute?: never } | ReturnType<typeof createMySqlPoolFromDatabaseUrl>;
  logger?: Pick<Console, "error"> & Partial<Pick<Console, "info">>;
};

export async function startProductionWebServerFromDatabaseUrl(
  config: WebServerConfig,
  overrides: WebBootstrapOverrides = {}
) {
  const pool = await (overrides.poolFactory?.(config) ?? createMySqlPoolFromDatabaseUrl(config.databaseUrl));
  const executor = overrides.executorFactory?.(pool as ReturnType<typeof createMySqlPoolFromDatabaseUrl>) ?? {
    async execute<T>(sql: string, params: unknown[] = []) {
      const [rows] = await (pool as ReturnType<typeof createMySqlPoolFromDatabaseUrl>).execute(sql, params as []);
      return [rows as T, rows as { insertId?: number; affectedRows?: number }];
    }
  } satisfies SqlExecutor;

  await applyMySqlBootstrap(executor);

  const server = createHttpWebServer({
    content: createMySqlApiDependencies(executor).content,
    onError: async (error, context) => {
      (overrides.logger ?? console).error("[bdta-web] request failed", context, error);
    },
    onRequestComplete: async (context) => {
      (overrides.logger?.info ?? console.info).call(overrides.logger ?? console, "[bdta-web] request completed", context);
    },
    healthCheck: async () => {
      try {
        await executor.execute<Array<{ ok: number }>>("SELECT 1 AS ok");
        return {
          status: "ok" as const,
          checks: {
            database: "ok" as const
          }
        };
      } catch {
        return {
          status: "degraded" as const,
          checks: {
            database: "error" as const
          }
        };
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.listen.port, config.listen.host, () => resolve());
  });

  return {
    pool,
    server,
    async stop() {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error?: Error) => error ? reject(error) : resolve());
        });
      }
      await pool.end();
    }
  };
}
