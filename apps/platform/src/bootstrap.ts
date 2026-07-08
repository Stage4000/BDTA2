import { once } from "node:events";
import type { Server } from "node:http";

import { createHttpApiServer } from "../../api/src/server.js";
import { startProductionJobWorker } from "../../jobs/src/bootstrap.js";
import { createHttpWebServer } from "../../web/src/server.js";
import { createUnifiedPlatformServer } from "./server.js";
import type { PlatformServerConfig } from "./config.js";
import {
  applyMySqlBootstrap,
  createMySqlApiDependencies,
  createMySqlPoolFromDatabaseUrl,
  resolveMySqlPortalBaseUrl,
  createMySqlSessionStore,
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
  jobBatchSize: number;
  emailBatchSize: number;
  pollIntervalMs: number;
  logger?: Pick<Console, "error"> & Partial<Pick<Console, "info">>;
};

type StartProductionOptions = BootstrapBaseOptions & {
  listen: BootstrapListenOptions;
};

type PlatformBootstrapOverrides = {
  executorFactory?: (pool: Awaited<ReturnType<typeof createMySqlPoolFromDatabaseUrl>>) => SqlExecutor;
  poolFactory?: (config: PlatformServerConfig) => Promise<{ end(): Promise<void>; execute?: never }> | Promise<ReturnType<typeof createMySqlPoolFromDatabaseUrl>> | { end(): Promise<void>; execute?: never } | ReturnType<typeof createMySqlPoolFromDatabaseUrl>;
  jobWorkerFactory?: (options: {
    executor: SqlExecutor;
    portalBaseUrl?: string;
    now?: () => string;
    jobBatchSize: number;
    emailBatchSize: number;
    pollIntervalMs: number;
  }) => Promise<{ stop(): Promise<void> }>;
  logger?: Pick<Console, "error"> & Partial<Pick<Console, "info">>;
};

export type ProductionPlatformRuntime = {
  server: Server;
  sessionStore: ReturnType<typeof createMySqlSessionStore>;
  stop(): Promise<void>;
};

async function buildSharedHealthCheck(executor: SqlExecutor): Promise<{
  status: "ok" | "degraded";
  checks: Record<string, "ok" | "error">;
}> {
  try {
    await executor.execute<Array<{ ok: number }>>("SELECT 1 AS ok");
    return {
      status: "ok",
      checks: {
        database: "ok",
        worker: "ok"
      }
    };
  } catch {
    return {
      status: "degraded",
      checks: {
        database: "error",
        worker: "ok"
      }
    };
  }
}

export async function startProductionPlatformServer(
  options: StartProductionOptions,
  overrides: PlatformBootstrapOverrides = {}
): Promise<ProductionPlatformRuntime> {
  await applyMySqlBootstrap(options.executor);
  const portalBaseUrl = await resolveMySqlPortalBaseUrl(options.executor, options.portalBaseUrl);

  const dependencies = createMySqlApiDependencies(options.executor, {
    now: options.now,
    portalBaseUrl
  });
  const sessionStore = createMySqlSessionStore(options.executor, {
    now: options.now,
    ttlSeconds: options.sessionTtlSeconds
  });
  const logger = overrides.logger ?? options.logger ?? console;
  const healthCheck = async () => buildSharedHealthCheck(options.executor);

  const apiServer = createHttpApiServer({
    dependencies,
    sessionStore,
    onError: async (error, context) => {
      logger.error("[bdta-platform:api] request failed", context, error);
    },
    onRequestComplete: async (context) => {
      (logger.info ?? console.info).call(logger, "[bdta-platform:api] request completed", context);
    },
    healthCheck
  });
  const webServer = createHttpWebServer({
    dependencies,
    sessionStore,
    onError: async (error, context) => {
      logger.error("[bdta-platform:web] request failed", context, error);
    },
    onRequestComplete: async (context) => {
      (logger.info ?? console.info).call(logger, "[bdta-platform:web] request completed", context);
    },
    healthCheck
  });
  const server = createUnifiedPlatformServer({
    apiServer,
    webServer,
    healthCheck
  });
  const jobWorker = await (overrides.jobWorkerFactory?.({
    executor: options.executor,
    portalBaseUrl,
    now: options.now,
    jobBatchSize: options.jobBatchSize,
    emailBatchSize: options.emailBatchSize,
    pollIntervalMs: options.pollIntervalMs
  }) ?? startProductionJobWorker({
    executor: options.executor,
    portalBaseUrl,
    now: options.now,
    jobBatchSize: options.jobBatchSize,
    emailBatchSize: options.emailBatchSize,
    pollIntervalMs: options.pollIntervalMs,
    onCycleError: async (error) => {
      logger.error("[bdta-platform:jobs] scheduled worker cycle failed", error);
    }
  }));

  server.listen(options.listen.port, options.listen.host);
  await once(server, "listening");

  return {
    server,
    sessionStore,
    async stop() {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error?: Error) => error ? reject(error) : resolve());
        });
      }
      await jobWorker.stop();
    }
  };
}

export async function startProductionPlatformServerFromDatabaseUrl(
  config: PlatformServerConfig,
  overrides: PlatformBootstrapOverrides = {}
): Promise<ProductionPlatformRuntime & { closePool(): Promise<void> }> {
  const pool = await (overrides.poolFactory?.(config) ?? createMySqlPoolFromDatabaseUrl(config.databaseUrl));
  const executor = overrides.executorFactory?.(pool as ReturnType<typeof createMySqlPoolFromDatabaseUrl>) ?? {
    async execute<T>(sql: string, params: unknown[] = []) {
      const [rows] = await (pool as ReturnType<typeof createMySqlPoolFromDatabaseUrl>).execute(sql, params as []);
      return [rows as T, rows as { insertId?: number; affectedRows?: number }];
    }
  } satisfies SqlExecutor;

  const runtime = await startProductionPlatformServer({
    executor,
    now: undefined,
    portalBaseUrl: config.portalBaseUrl,
    sessionTtlSeconds: config.sessionTtlSeconds,
    jobBatchSize: config.jobBatchSize,
    emailBatchSize: config.emailBatchSize,
    pollIntervalMs: config.pollIntervalMs,
    listen: config.listen,
    logger: overrides.logger
  }, overrides);

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
