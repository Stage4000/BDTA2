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

export type JobWorkerConfig = {
  databaseUrl: string;
  portalBaseUrl: string;
  pollIntervalMs: number;
  jobBatchSize: number;
  emailBatchSize: number;
};

export function readJobWorkerConfig(env: NodeJS.ProcessEnv): JobWorkerConfig {
  return {
    databaseUrl: readRequiredString(env.DATABASE_URL, "DATABASE_URL"),
    portalBaseUrl: readRequiredString(env.PORTAL_BASE_URL, "PORTAL_BASE_URL"),
    pollIntervalMs: parsePositiveInteger(env.JOB_POLL_INTERVAL_MS, "JOB_POLL_INTERVAL_MS", 30_000),
    jobBatchSize: parsePositiveInteger(env.JOB_BATCH_SIZE, "JOB_BATCH_SIZE", 25),
    emailBatchSize: parsePositiveInteger(env.EMAIL_BATCH_SIZE, "EMAIL_BATCH_SIZE", 25)
  };
}
