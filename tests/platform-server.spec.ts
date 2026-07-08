import { once } from "node:events";

import { createHttpApiServer } from "../apps/api/src/server.js";
import { createUnifiedPlatformServer } from "../apps/platform/src/server.js";
import { createReleaseValidationState } from "../apps/release/src/fixtures.js";
import { createHttpWebServer } from "../apps/web/src/server.js";
import { createInMemoryApiDependencies, createInMemorySessionStore } from "@bdta/infrastructure";

async function startServer(server: ReturnType<typeof createUnifiedPlatformServer>): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("Expected TCP server address.");
  }

  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: ReturnType<typeof createUnifiedPlatformServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error == null ? resolve() : reject(error));
  });
}

describe("unified platform server", () => {
  it("serves web and api routes from the same port", async () => {
    const state = createReleaseValidationState();
    const dependencies = createInMemoryApiDependencies(state);
    const sessionStore = createInMemorySessionStore(state);
    const apiServer = createHttpApiServer({
      dependencies,
      sessionStore
    });
    const webServer = createHttpWebServer({
      dependencies,
      sessionStore
    });
    const server = createUnifiedPlatformServer({
      apiServer,
      webServer,
      healthCheck: async () => ({
        status: "ok",
        checks: {
          database: "ok",
          worker: "ok"
        }
      })
    });

    const baseUrl = await startServer(server);

    try {
      const webResponse = await fetch(`${baseUrl}/portal/login`);
      expect(webResponse.status).toBe(200);
      expect(webResponse.headers.get("content-type")).toContain("text/html");

      const apiResponse = await fetch(`${baseUrl}/api/session`);
      expect(apiResponse.status).toBe(200);
      expect(apiResponse.headers.get("content-type")).toContain("application/json");
      expect(await apiResponse.json()).toEqual({
        authenticated: false
      });

      const healthResponse = await fetch(`${baseUrl}/health`);
      expect(healthResponse.status).toBe(200);
      expect(await healthResponse.json()).toEqual({
        status: "ok",
        checks: {
          database: "ok",
          worker: "ok"
        }
      });
    } finally {
      await closeServer(server);
    }
  });
});
