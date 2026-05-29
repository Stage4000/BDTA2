import {
  authenticateAdminLogin,
  authenticatePortalLogin,
  authorizeAdminRoute,
  type AdminLoginDependencies,
  type AdminLoginInput,
  type PortalLoginDependencies,
  type PortalLoginInput,
  type SessionSnapshot,
  sessionNeedsRoleRefresh
} from "@bdta/application";

function createPortalLoginDependencies(overrides: Partial<PortalLoginDependencies> = {}): PortalLoginDependencies {
  return {
    now: () => "2026-05-27T16:00:00.000Z",
    findPortalUserByEmail: async (email) => {
      if (email !== "client@example.com") {
        return null;
      }

      return {
        clientId: "client-1",
        email: "client@example.com",
        displayName: "Client One",
        passwordHash: "hash-1",
        archived: false
      };
    },
    verifyPassword: async (password, hash) => password === "correct-password" && hash === "hash-1",
    buildPortalReturnUrl: () => "https://portal.example.test/portal",
    recordSuccessfulLogin: async () => undefined,
    ...overrides
  };
}

function createPortalLoginInput(overrides: Partial<PortalLoginInput> = {}): PortalLoginInput {
  return {
    email: "client@example.com",
    password: "correct-password",
    returnTo: null,
    ...overrides
  };
}

function createAdminLoginDependencies(overrides: Partial<AdminLoginDependencies> = {}): AdminLoginDependencies {
  return {
    now: () => "2026-05-27T16:00:00.000Z",
    findAdminUserByUsername: async (username) => {
      if (username !== "accountant") {
        return null;
      }

      return {
        actorId: "admin-1",
        source: "admin_user",
        username: "accountant",
        displayName: "Accountant User",
        passwordHash: "admin-hash",
        role: "accountant"
      };
    },
    findAdminClientByEmail: async (email) => {
      if (email !== "owner@example.com") {
        return null;
      }

      return {
        actorId: "client-admin-1",
        source: "client_admin",
        email: "owner@example.com",
        displayName: "Owner Client",
        passwordHash: "client-hash",
        role: "admin"
      };
    },
    verifyPassword: async (password, hash) => (
      (password === "correct-password" && hash === "admin-hash")
      || (password === "client-password" && hash === "client-hash")
    ),
    buildAdminRedirectPath: (role) => role === "accountant" ? "/client/invoices_list.php" : "/client/index.php",
    recordSuccessfulLogin: async () => undefined,
    ...overrides
  };
}

function createAdminLoginInput(overrides: Partial<AdminLoginInput> = {}): AdminLoginInput {
  return {
    username: "accountant",
    password: "correct-password",
    ...overrides
  };
}

describe("auth and access control", () => {
  it("allows accountant admins onto accounting routes", () => {
    const result = authorizeAdminRoute({
      actorId: "admin-1",
      actorType: "admin_user",
      role: "accountant",
      issuedAt: "2026-05-27T16:00:00.000Z",
      expiresAt: "2026-05-27T20:00:00.000Z"
    }, "/client/invoices_list.php");

    expect(result.allowed).toBe(true);
  });

  it("blocks accountant admins from non-accounting routes and traversal paths", () => {
    const baseSession: SessionSnapshot = {
      actorId: "admin-1",
      actorType: "admin_user",
      role: "accountant",
      issuedAt: "2026-05-27T16:00:00.000Z",
      expiresAt: "2026-05-27T20:00:00.000Z"
    };

    expect(authorizeAdminRoute(baseSession, "/client/settings.php").allowed).toBe(false);
    expect(authorizeAdminRoute(baseSession, "/client/../settings.php").allowed).toBe(false);
  });

  it("marks admin sessions for role refresh when missing or stale", () => {
    expect(
      sessionNeedsRoleRefresh({
        actorId: "admin-1",
        actorType: "admin_user",
        role: null,
        issuedAt: "2026-05-27T16:00:00.000Z",
        expiresAt: "2026-05-27T20:00:00.000Z"
      }, "2026-05-27T16:01:00.000Z")
    ).toBe(true);

    expect(
      sessionNeedsRoleRefresh({
        actorId: "admin-1",
        actorType: "admin_user",
        role: "accountant",
        issuedAt: "2026-05-27T16:00:00.000Z",
        expiresAt: "2026-05-27T20:00:00.000Z",
        roleRefreshedAt: "2026-05-27T15:54:00.000Z"
      }, "2026-05-27T16:00:00.000Z")
    ).toBe(true);
  });

  it("authenticates a portal user and returns a redirect-capable session", async () => {
    const loginEvents: string[] = [];
    const result = await authenticatePortalLogin(
      createPortalLoginInput(),
      createPortalLoginDependencies({
        recordSuccessfulLogin: async (clientId) => {
          loginEvents.push(clientId);
        }
      })
    );

    expect(result.clientId).toBe("client-1");
    expect(result.session.actorType).toBe("portal_user");
    expect(result.redirectTo).toBe("https://portal.example.test/portal");
    expect(loginEvents).toEqual(["client-1"]);
  });

  it("rejects invalid portal credentials", async () => {
    await expect(
      authenticatePortalLogin(
        createPortalLoginInput({ password: "wrong-password" }),
        createPortalLoginDependencies()
      )
    ).rejects.toThrow("Invalid email address or password.");
  });

  it("authenticates an admin user and returns accountant redirect state", async () => {
    const loginEvents: string[] = [];
    const result = await authenticateAdminLogin(
      createAdminLoginInput(),
      createAdminLoginDependencies({
        recordSuccessfulLogin: async (identity) => {
          loginEvents.push(identity.actorId);
        }
      })
    );

    expect(result.actorId).toBe("admin-1");
    expect(result.session.actorType).toBe("admin_user");
    expect(result.session.role).toBe("accountant");
    expect(result.redirectTo).toBe("/client/invoices_list.php");
    expect(loginEvents).toEqual(["admin-1"]);
  });

  it("falls back to admin-capable client credentials when no admin user exists", async () => {
    const result = await authenticateAdminLogin(
      createAdminLoginInput({
        username: "owner@example.com",
        password: "client-password"
      }),
      createAdminLoginDependencies({
        findAdminUserByUsername: async () => null
      })
    );

    expect(result.actorId).toBe("client-admin-1");
    expect(result.session.role).toBe("admin");
    expect(result.redirectTo).toBe("/client/index.php");
  });
});
