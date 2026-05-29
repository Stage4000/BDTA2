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

export type WebServerConfig = {
  databaseUrl: string;
  listen: {
    host: string;
    port: number;
  };
};

export function readWebServerConfig(env: NodeJS.ProcessEnv): WebServerConfig {
  return {
    databaseUrl: readRequiredString(env.DATABASE_URL, "DATABASE_URL"),
    listen: {
      host: env.HOST?.trim() || "0.0.0.0",
      port: parsePositiveInteger(env.PORT, "PORT", 3001)
    }
  };
}
