import { readApiServerConfig } from "../apps/api/src/config.js";

describe("api server config", () => {
  it("parses production API settings from environment variables", () => {
    const config = readApiServerConfig({
      DATABASE_URL: "mysql://user:password@db.example.test:3307/bdta",
      PORTAL_BASE_URL: "https://portal.example.test/portal",
      HOST: "127.0.0.1",
      PORT: "4100",
      SESSION_TTL_SECONDS: "7200"
    });

    expect(config).toEqual({
      databaseUrl: "mysql://user:password@db.example.test:3307/bdta",
      portalBaseUrl: "https://portal.example.test/portal",
      listen: {
        host: "127.0.0.1",
        port: 4100
      },
      sessionTtlSeconds: 7200
    });
  });

  it("accepts legacy database variables and session lifetime alias without requiring portal env", () => {
    const config = readApiServerConfig({
      DB_HOST: "legacy-db.example.test",
      DB_PORT: "3308",
      DB_NAME: "bdta_legacy",
      DB_USER: "legacy_user",
      DB_PASSWORD: "legacy_password",
      SESSION_LIFETIME_SECONDS: "3600"
    });

    expect(config).toEqual({
      databaseUrl: "mysql://legacy_user:legacy_password@legacy-db.example.test:3308/bdta_legacy",
      portalBaseUrl: undefined,
      listen: {
        host: "0.0.0.0",
        port: 3000
      },
      sessionTtlSeconds: 3600
    });
  });

  it("rejects invalid numeric environment values", () => {
    expect(() => readApiServerConfig({
      DATABASE_URL: "mysql://user:password@db.example.test:3306/bdta",
      PORTAL_BASE_URL: "https://portal.example.test/portal",
      PORT: "not-a-number"
    })).toThrow("Invalid PORT value.");

    expect(() => readApiServerConfig({
      DATABASE_URL: "mysql://user:password@db.example.test:3306/bdta",
      PORTAL_BASE_URL: "https://portal.example.test/portal",
      SESSION_TTL_SECONDS: "0"
    })).toThrow("Invalid SESSION_TTL_SECONDS value.");
  });

  it("rejects missing database configuration", () => {
    expect(() => readApiServerConfig({
      SESSION_LIFETIME_SECONDS: "1209600"
    })).toThrow("Missing required database configuration. Set DATABASE_URL or DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD.");
  });
});
