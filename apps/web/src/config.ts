import { parsePositiveInteger, resolveDatabaseUrl } from "@bdta/platform";

export type WebServerConfig = {
  databaseUrl: string;
  listen: {
    host: string;
    port: number;
  };
};

export function readWebServerConfig(env: NodeJS.ProcessEnv): WebServerConfig {
  return {
    databaseUrl: resolveDatabaseUrl(env),
    listen: {
      host: env.HOST?.trim() || "0.0.0.0",
      port: parsePositiveInteger(env.PORT, "PORT", 3001)
    }
  };
}
