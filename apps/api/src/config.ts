function parsePositiveInteger(value: string | undefined, envName: string, defaultValue: number): number {
  if (value == null || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${envName} value.`);
  }

  return parsed;
}

function readRequiredString(value: string | undefined, envName: string): string {
  if (value == null || value.trim() === "") {
    throw new Error(`Missing required ${envName} environment variable.`);
  }

  return value;
}

export type ApiServerConfig = {
  databaseUrl: string;
  portalBaseUrl: string;
  listen: {
    host: string;
    port: number;
  };
  sessionTtlSeconds: number;
};

export function readApiServerConfig(env: NodeJS.ProcessEnv): ApiServerConfig {
  return {
    databaseUrl: readRequiredString(env.DATABASE_URL, "DATABASE_URL"),
    portalBaseUrl: readRequiredString(env.PORTAL_BASE_URL, "PORTAL_BASE_URL"),
    listen: {
      host: env.HOST?.trim() || "0.0.0.0",
      port: parsePositiveInteger(env.PORT, "PORT", 3000)
    },
    sessionTtlSeconds: parsePositiveInteger(env.SESSION_TTL_SECONDS, "SESSION_TTL_SECONDS", 60 * 60 * 24 * 14)
  };
}
