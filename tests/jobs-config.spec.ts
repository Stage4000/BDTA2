import { readJobWorkerConfig } from "../apps/jobs/src/config.js";

describe("job worker config", () => {
  it("parses production worker settings from environment variables", () => {
    const config = readJobWorkerConfig({
      DATABASE_URL: "mysql://user:password@db.example.test:3307/bdta",
      PORTAL_BASE_URL: "https://portal.example.test/portal",
      JOB_POLL_INTERVAL_MS: "15000",
      JOB_BATCH_SIZE: "20",
      EMAIL_BATCH_SIZE: "10"
    });

    expect(config).toEqual({
      databaseUrl: "mysql://user:password@db.example.test:3307/bdta",
      portalBaseUrl: "https://portal.example.test/portal",
      pollIntervalMs: 15000,
      jobBatchSize: 20,
      emailBatchSize: 10
    });
  });

  it("rejects invalid worker numeric environment values", () => {
    expect(() => readJobWorkerConfig({
      DATABASE_URL: "mysql://user:password@db.example.test:3306/bdta",
      PORTAL_BASE_URL: "https://portal.example.test/portal",
      JOB_POLL_INTERVAL_MS: "-1"
    })).toThrow("Invalid JOB_POLL_INTERVAL_MS value.");

    expect(() => readJobWorkerConfig({
      DATABASE_URL: "mysql://user:password@db.example.test:3306/bdta",
      PORTAL_BASE_URL: "https://portal.example.test/portal",
      JOB_BATCH_SIZE: "0"
    })).toThrow("Invalid JOB_BATCH_SIZE value.");

    expect(() => readJobWorkerConfig({
      DATABASE_URL: "mysql://user:password@db.example.test:3306/bdta"
    })).toThrow("Missing required PORTAL_BASE_URL environment variable.");
  });
});
