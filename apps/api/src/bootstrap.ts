import { once } from "node:events";
import type { Server } from "node:http";

import { createHttpApiServer } from "./server.js";
import {
  createMySqlApiDependencies,
  createMySqlSessionStore,
  createMySqlPoolFromDatabaseUrl,
  getMySqlBootstrapStatements,
  type SqlExecutor
} from "@bdta/infrastructure";

type BootstrapListenOptions = {
  host: string;
  port: number;
};

type BootstrapBaseOptions = {
  executor: SqlExecutor;
  now?: () => string;
  portalBaseUrl: string;
  sessionTtlSeconds: number;
};

type StartProductionOptions = BootstrapBaseOptions & {
  listen: BootstrapListenOptions;
};

export type ProductionApiRuntime = {
  server: Server;
  sessionStore: ReturnType<typeof createMySqlSessionStore>;
};

export async function applyProductionBootstrap(executor: SqlExecutor): Promise<void> {
  for (const statement of getMySqlBootstrapStatements()) {
    await executor.execute(statement);
  }
}

export async function buildProductionApiRuntime(options: BootstrapBaseOptions): Promise<ProductionApiRuntime> {
  await applyProductionBootstrap(options.executor);

  const dependencies = createMySqlApiDependencies(options.executor, {
    now: options.now,
    portalBaseUrl: options.portalBaseUrl
  });
  const sessionStore = createMySqlSessionStore(options.executor, {
    now: options.now,
    ttlSeconds: options.sessionTtlSeconds
  });

  return {
    server: createHttpApiServer({
      dependencies,
      sessionStore
    }),
    sessionStore
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
  portalBaseUrl: string;
  sessionTtlSeconds: number;
  listen: BootstrapListenOptions;
  now?: () => string;
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
    listen: input.listen
  });

  return {
    ...runtime,
    async closePool() {
      await pool.end();
    }
  };
}
