import { once } from "node:events";
import type { Server } from "node:http";

import { createHttpApiServer } from "./server.js";
import {
  applyMySqlBootstrap,
  createMySqlApiDependencies,
  createMySqlSessionStore,
  createMySqlPoolFromDatabaseUrl,
  resolveMySqlPortalBaseUrl,
  type SqlExecutor
} from "@bdta/infrastructure";

type BootstrapListenOptions = {
  host: string;
  port: number;
};

type BootstrapBaseOptions = {
  executor: SqlExecutor;
  now?: () => string;
  portalBaseUrl?: string;
  sessionTtlSeconds: number;
  logger?: Pick<Console, "error"> & Partial<Pick<Console, "info">>;
};

type StartProductionOptions = BootstrapBaseOptions & {
  listen: BootstrapListenOptions;
};

export type ProductionApiRuntime = {
  server: Server;
  sessionStore: ReturnType<typeof createMySqlSessionStore>;
  stop(): Promise<void>;
};

export async function applyProductionBootstrap(executor: SqlExecutor): Promise<void> {
  await applyMySqlBootstrap(executor);
}

export async function buildProductionApiRuntime(options: BootstrapBaseOptions): Promise<ProductionApiRuntime> {
  await applyProductionBootstrap(options.executor);
  const portalBaseUrl = await resolveMySqlPortalBaseUrl(options.executor, options.portalBaseUrl);

  const dependencies = createMySqlApiDependencies(options.executor, {
    now: options.now,
    portalBaseUrl
  });
  const sessionStore = createMySqlSessionStore(options.executor, {
    now: options.now,
    ttlSeconds: options.sessionTtlSeconds
  });

  const server = createHttpApiServer({
    dependencies,
    sessionStore,
    onError: async (error, context) => {
      (options.logger ?? console).error("[bdta-api] request failed", context, error);
    },
    onRequestComplete: async (context) => {
      (options.logger?.info ?? console.info).call(options.logger ?? console, "[bdta-api] request completed", context);
    },
    healthCheck: async () => {
      try {
        await options.executor.execute<Array<{ ok: number }>>("SELECT 1 AS ok");
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

  return {
    server,
    sessionStore,
    async stop() {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error?: Error) => error ? reject(error) : resolve());
        });
      }
    }
  };
}

export async function startProductionApiServer(options: StartProductionOptions): Promise<ProductionApiRuntime> {
  const runtime = await buildProductionApiRuntime(options);
  runtime.server.listen(options.listen.port, options.listen.host);
  await once(runtime.server, "listening");
  return runtime;
}

export async function startProductionApiServerFromDatabaseUrl(input: {
  databaseUrl: string;
  portalBaseUrl?: string;
  sessionTtlSeconds: number;
  listen: BootstrapListenOptions;
  now?: () => string;
  logger?: Pick<Console, "error"> & Partial<Pick<Console, "info">>;
}): Promise<ProductionApiRuntime & { closePool(): Promise<void> }> {
  const pool = createMySqlPoolFromDatabaseUrl(input.databaseUrl);
  const executor: SqlExecutor = {
    async execute<T>(sql: string, params: unknown[] = []) {
      const [rows] = await pool.execute(sql, params as []);
      return [rows as T, rows as { insertId?: number; affectedRows?: number }];
    }
  };

  const runtime = await startProductionApiServer({
    executor,
    now: input.now,
    portalBaseUrl: input.portalBaseUrl,
    sessionTtlSeconds: input.sessionTtlSeconds,
    logger: input.logger,
    listen: input.listen
  });

  return {
    ...runtime,
    async closePool() {
      await pool.end();
    },
    async stop() {
      await runtime.stop();
      await pool.end();
    }
  };
}
