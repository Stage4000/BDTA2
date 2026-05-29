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
});
