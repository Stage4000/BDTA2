import {
  createMySqlApiDependencies,
  createMySqlPoolFromDatabaseUrl,
  getMySqlBootstrapStatements,
  type SqlExecutor
} from "@bdta/infrastructure";

import { createHttpWebServer } from "./server.js";
import type { WebServerConfig } from "./config.js";

export async function startProductionWebServerFromDatabaseUrl(config: WebServerConfig) {
  const pool = createMySqlPoolFromDatabaseUrl(config.databaseUrl);
  const executor: SqlExecutor = {
    async execute<T>(sql: string, params: unknown[] = []) {
      const [rows] = await pool.execute(sql, params as []);
      return [rows as T, rows as { insertId?: number; affectedRows?: number }];
    }
  };

  for (const statement of getMySqlBootstrapStatements()) {
    await executor.execute(statement);
  }

  const server = createHttpWebServer({
    content: createMySqlApiDependencies(executor).content
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.listen.port, config.listen.host, () => resolve());
  });

  return {
    pool,
    server
  };
}
