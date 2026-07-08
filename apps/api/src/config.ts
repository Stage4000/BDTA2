import { parsePositiveInteger, resolveDatabaseUrl, resolveOptionalPortalBaseUrl, resolveSessionTtlSeconds } from "@bdta/platform";

export type ApiServerConfig = {
  databaseUrl: string;
  portalBaseUrl?: string;
  listen: {
    host: string;
    port: number;
  };
  sessionTtlSeconds: number;
};

export function readApiServerConfig(env: NodeJS.ProcessEnv): ApiServerConfig {
  return {
    databaseUrl: resolveDatabaseUrl(env),
    portalBaseUrl: resolveOptionalPortalBaseUrl(env),
    listen: {
      host: env.HOST?.trim() || "0.0.0.0",
      port: parsePositiveInteger(env.PORT, "PORT", 3000)
    },
    sessionTtlSeconds: resolveSessionTtlSeconds(env)
  };
}
