import { readApiServerConfig } from "../../api/src/config.js";
import { readJobWorkerConfig } from "../../jobs/src/config.js";

export type PlatformServerConfig = {
  databaseUrl: string;
  portalBaseUrl?: string;
  listen: {
    host: string;
    port: number;
  };
  sessionTtlSeconds: number;
  pollIntervalMs: number;
  jobBatchSize: number;
  emailBatchSize: number;
};

export function readPlatformServerConfig(env: NodeJS.ProcessEnv): PlatformServerConfig {
  const api = readApiServerConfig(env);
  const jobs = readJobWorkerConfig(env);

  return {
    databaseUrl: api.databaseUrl,
    portalBaseUrl: api.portalBaseUrl,
    listen: api.listen,
    sessionTtlSeconds: api.sessionTtlSeconds,
    pollIntervalMs: jobs.pollIntervalMs,
    jobBatchSize: jobs.jobBatchSize,
    emailBatchSize: jobs.emailBatchSize
  };
}
