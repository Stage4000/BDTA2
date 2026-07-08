import { parsePositiveInteger, resolveDatabaseUrl, resolveOptionalPortalBaseUrl } from "@bdta/platform";

export type JobWorkerConfig = {
  databaseUrl: string;
  portalBaseUrl?: string;
  pollIntervalMs: number;
  jobBatchSize: number;
  emailBatchSize: number;
};

export function readJobWorkerConfig(env: NodeJS.ProcessEnv): JobWorkerConfig {
  return {
    databaseUrl: resolveDatabaseUrl(env),
    portalBaseUrl: resolveOptionalPortalBaseUrl(env),
    pollIntervalMs: parsePositiveInteger(env.JOB_POLL_INTERVAL_MS, "JOB_POLL_INTERVAL_MS", 30_000),
    jobBatchSize: parsePositiveInteger(env.JOB_BATCH_SIZE, "JOB_BATCH_SIZE", 25),
    emailBatchSize: parsePositiveInteger(env.EMAIL_BATCH_SIZE, "EMAIL_BATCH_SIZE", 25)
  };
}
