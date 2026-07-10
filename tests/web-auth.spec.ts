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
    server.close((error) => (error == null ? resolve() : reject(error)));
  });
}

function createServer() {
  const state = createReleaseValidationState();
  const dependencies = createInMemoryApiDependencies(state);
  const sessionStore = createInMemorySessionStore(state);
  const apiServer = createHttpApiServer({ dependencies, sessionStore });
  const webServer = createHttpWebServer({ dependencies, sessionStore });

  return createUnifiedPlatformServer({ apiServer, webServer });
}

function createServerContext() {
  const state = createReleaseValidationState();
  const dependencies = createInMemoryApiDependencies(state);
  const sessionStore = createInMemorySessionStore(state);
  const apiServer = createHttpApiServer({ dependencies, sessionStore });
  const webServer = createHttpWebServer({ dependencies, sessionStore });

  return {
    state,
    server: createUnifiedPlatformServer({ apiServer, webServer })
  };
}

describe("web auth screens", () => {
  it("renders login screens without app sidebars", async () => {
    const server = createServer();
    const baseUrl = await startServer(server);

    try {
      const portalLogin = await fetch(`${baseUrl}/portal/login`);
      const adminLogin = await fetch(`${baseUrl}/admin/login`);

      expect(portalLogin.status).toBe(200);
      expect(adminLogin.status).toBe(200);

      const portalMarkup = await portalLogin.text();
      const adminMarkup = await adminLogin.text();

      expect(portalMarkup).toContain("auth-shell");
      expect(adminMarkup).toContain("auth-shell");
      expect(portalMarkup).not.toContain('<nav id="app-sidebar"');
      expect(adminMarkup).not.toContain('<nav id="app-sidebar"');
      expect(portalMarkup).not.toContain('<div class="app-mobile-navbar">');
      expect(adminMarkup).not.toContain('<div class="app-mobile-navbar">');
    } finally {
      await closeServer(server);
    }
  });

  it("returns portal users to the protected portal page they asked for", async () => {
    const server = createServer();
    const baseUrl = await startServer(server);

    try {
      const quotes = await fetch(`${baseUrl}/portal/quotes`, { redirect: "manual" });
      expect(quotes.status).toBe(302);
      expect(quotes.headers.get("location")).toBe("/portal/login?return_to=%2Fportal%2Fquotes");

      const login = await fetch(`${baseUrl}/portal/login?return_to=%2Fportal%2Fquotes`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          email: "portal@example.com",
          password: "portal-password"
        }),
        redirect: "manual"
      });

      expect(login.status).toBe(302);
      expect(login.headers.get("location")).toBe("/portal/quotes");

      const cookie = login.headers.get("set-cookie");
      expect(cookie).toContain("bdta_session=");

      const loginPage = await fetch(`${baseUrl}/portal/login?return_to=%2Fportal%2Fquotes`, {
        headers: {
          cookie: cookie ?? ""
        },
        redirect: "manual"
      });

      expect(loginPage.status).toBe(302);
      expect(loginPage.headers.get("location")).toBe("/portal/quotes");
    } finally {
      await closeServer(server);
    }
  });

  it("returns admin users to the protected admin page they asked for", async () => {
    const server = createServer();
    const baseUrl = await startServer(server);

    try {
      const quotes = await fetch(`${baseUrl}/admin/quotes`, { redirect: "manual" });
      expect(quotes.status).toBe(302);
      expect(quotes.headers.get("location")).toBe("/admin/login?return_to=%2Fadmin%2Fquotes");

      const login = await fetch(`${baseUrl}/admin/login?return_to=%2Fadmin%2Fquotes`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          username: "brook",
          password: "admin-password"
        }),
        redirect: "manual"
      });

      expect(login.status).toBe(302);
      expect(login.headers.get("location")).toBe("/admin/quotes");

      const cookie = login.headers.get("set-cookie");
      expect(cookie).toContain("bdta_session=");

      const loginPage = await fetch(`${baseUrl}/admin/login?return_to=%2Fadmin%2Fquotes`, {
        headers: {
          cookie: cookie ?? ""
        },
        redirect: "manual"
      });

      expect(loginPage.status).toBe(302);
      expect(loginPage.headers.get("location")).toBe("/admin/quotes");
    } finally {
      await closeServer(server);
    }
  });

  it("sends admin users without a requested page to the unified admin view", async () => {
    const server = createServer();
    const baseUrl = await startServer(server);

    try {
      const login = await fetch(`${baseUrl}/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          username: "brook",
          password: "admin-password"
        }),
        redirect: "manual"
      });

  expect(login.status).toBe(302);
  expect(login.headers.get("location")).toBe("/admin");
} finally {
  await closeServer(server);
}
});

it("clears stale admin sessions instead of redirect loops", async () => {
  const { state, server } = createServerContext();
  const baseUrl = await startServer(server);

  try {
    const login = await fetch(`${baseUrl}/admin/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        username: "brook",
        password: "admin-password"
      }),
      redirect: "manual"
    });

    expect(login.status).toBe(302);
    const firstCookie = login.headers.get("set-cookie");
    expect(firstCookie).toContain("bdta_session=");

    const secondLogin = await fetch(`${baseUrl}/admin/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        username: "brook",
        password: "admin-password"
      }),
      redirect: "manual"
    });

    expect(secondLogin.status).toBe(302);
    const secondCookie = secondLogin.headers.get("set-cookie");
    expect(secondCookie).toContain("bdta_session=");

    const adminUser = state.adminUsers.find((user) => user.username === "brook");
    if (adminUser == null) {
      throw new Error("Expected seeded admin user.");
    }

    adminUser.active = false;

    const protectedPage = await fetch(`${baseUrl}/admin`, {
      headers: {
        cookie: firstCookie ?? ""
      },
      redirect: "manual"
    });

    expect(protectedPage.status).toBe(302);
    expect(protectedPage.headers.get("location")).toBe("/admin/login?return_to=%2Fadmin");
    expect(protectedPage.headers.get("set-cookie")).toContain("Max-Age=0");

    const loginPage = await fetch(`${baseUrl}/admin/login?return_to=%2Fadmin`, {
      headers: {
        cookie: secondCookie ?? ""
      },
      redirect: "manual"
    });

    expect(loginPage.status).toBe(200);
    expect(loginPage.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await loginPage.text()).toContain("auth-shell");
  } finally {
    await closeServer(server);
  }
});
});
