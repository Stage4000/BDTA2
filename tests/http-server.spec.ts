import { createHmac } from "node:crypto";
import { once } from "node:events";

import { createHttpApiServer } from "../apps/api/src/server.js";
import {
  createInMemoryApiDependencies,
  createInMemoryPlatformState,
  createInMemorySessionStore
} from "@bdta/infrastructure";

describe("http api server", () => {
  it("serves health, public booking, and public contact endpoints", async () => {
    const state = createInMemoryPlatformState({
      portalUsers: [
        {
          clientId: "client-1",
          email: "client@example.com",
          displayName: "Client One",
          passwordHash: "hash-1",
          archived: false
        }
      ]
    });

    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore: null
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const health = await fetch(`${baseUrl}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok" });

      const booking = await fetch(`${baseUrl}/api/public/bookings`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          serviceId: "svc-private-lesson",
          clientEmail: "client@example.com",
          petIds: ["pet-1"],
          requestedStart: "2026-06-01T16:00:00.000Z",
          requestedEnd: "2026-06-01T17:00:00.000Z",
          turnstileToken: "turnstile-ok"
        })
      });

      expect(booking.status).toBe(201);
      expect(state.bookings).toHaveLength(1);

      const contact = await fetch(`${baseUrl}/api/public/contact`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Contact New",
          email: "Contact-New@Example.com",
          phone: "555-1100",
          service: "pet-sitting",
          message: "Need help with training basics.",
          turnstile_token: "turnstile-ok"
        })
      });

      expect(contact.status).toBe(200);
      expect(await contact.json()).toEqual({ success: true });
      expect(state.portalUsers).toHaveLength(2);
      expect(state.portalUsers[1]).toMatchObject({
        email: "contact-new@example.com",
        displayName: "Contact New",
        phone: "555-1100"
      });
      expect(state.portalUsers[1]?.notes).toContain("Message: Need help with training basics.");

      const publicQuote = await fetch(`${baseUrl}/api/public/quotes/quote-1?token=missing`);
      expect(publicQuote.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("returns dependency-aware health responses when a production health check is provided", async () => {
    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(createInMemoryPlatformState()),
      sessionStore: null,
      healthCheck: async () => ({
        status: "degraded",
        checks: {
          database: "error"
        }
      })
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const health = await fetch(`${baseUrl}/health`);
      expect(health.status).toBe(503);
      expect(await health.json()).toEqual({
        status: "degraded",
        checks: {
          database: "error"
        }
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("returns a request id and logs unexpected health-check failures", async () => {
    const reportedErrors: Array<{
      error: unknown;
      requestId: string;
      method: string;
      path: string;
    }> = [];

    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(createInMemoryPlatformState()),
      sessionStore: null,
      requestIdFactory: () => "api-request-1",
      healthCheck: async () => {
        throw new Error("database probe exploded");
      },
      onError: async (error, context) => {
        reportedErrors.push({
          error,
          requestId: context.requestId,
          method: context.method,
          path: context.path
        });
      }
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/health`);
      expect(response.status).toBe(500);
      expect(response.headers.get("x-request-id")).toBe("api-request-1");
      expect(await response.json()).toEqual({
        error: {
          code: "internal_error",
          message: "Unexpected server failure."
        }
      });
      expect(reportedErrors).toHaveLength(1);
      expect(reportedErrors[0]?.requestId).toBe("api-request-1");
      expect(reportedErrors[0]?.method).toBe("GET");
      expect(reportedErrors[0]?.path).toBe("/health");
      expect(reportedErrors[0]?.error).toBeInstanceOf(Error);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("issues a session cookie for admin login when a session store is provided", async () => {
    const state = createInMemoryPlatformState({
      queuedJobs: [{
        jobId: "job-queued-1",
        kind: "workflow_processor",
        scheduledFor: "2026-05-27T17:30:00.000Z",
        payload: {
          limit: 10
        }
      }],
      invoices: [
        {
          id: "invoice-admin-1",
          clientId: "client-admin-1",
          status: "sent",
          totalAmount: 300,
          outstandingAmount: 150,
          dueAt: "2026-06-10T00:00:00.000Z"
        }
      ],
      quotes: [
        {
          id: "quote-admin-1",
          clientId: "client-admin-1",
          status: "sent",
          totalAmount: 475,
          publicAccess: null
        }
      ],
      contracts: [
        {
          id: "contract-admin-1",
          clientId: "client-admin-1",
          status: "sent",
          publicAccess: null
        }
      ],
      packages: [
        {
          id: "package-admin-1",
          name: "Starter Package",
          active: true,
          price: 325
        }
      ],
      pets: [
        {
          id: "pet-admin-1",
          clientId: "client-admin-1",
          name: "Scout",
          species: "Dog",
          petSittingNotes: "Use the side gate and towel paws before re-entry.",
          archived: false
        }
      ],
      credits: [
        {
          id: "credit-admin-1",
          clientId: "client-admin-1",
          packageId: "package-admin-1",
          appointmentTypeId: "appointment-type-admin-1",
          remainingUnits: 4
        }
      ],
      formSubmissions: [
        {
          id: "form-admin-1",
          templateId: "template-admin-1",
          clientId: "client-admin-1",
          submittedAt: null,
          publicAccess: null
        }
      ],
      adminUsers: [
        {
          actorId: "admin-1",
          username: "accountant",
          displayName: "Accountant User",
          passwordHash: "admin-hash",
          role: "accountant",
          active: true
        }
      ],
      portalUsers: [
        {
          clientId: "client-admin-1",
          email: "owner@example.com",
          displayName: "Owner Client",
          passwordHash: "client-hash",
          archived: false
        }
      ],
      passwordVerifier: async (password, hash) => (
        (password === "correct-password" && hash === "admin-hash")
        || (password === "client-password" && hash === "client-hash")
      )
    });
    state.integrationCallbacks.push({
      callbackId: "callback-1",
      provider: "imap",
      receivedAt: "2026-05-27T18:05:00.000Z",
      payload: {
        messageId: "imap-message-1",
        from: "owner@example.com",
        subject: "Need help with my booking"
      },
      queuedJobId: "job-email-1"
    });

    const savedSessions = new Map<string, string>();
    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore: {
        save: async (sessionId: string, sessionData: string) => {
          savedSessions.set(sessionId, sessionData);
        },
        load: async (sessionId: string) => savedSessions.get(sessionId) ?? null,
        delete: async (sessionId: string) => {
          savedSessions.delete(sessionId);
        }
      }
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          username: "accountant",
          password: "correct-password"
        })
      });

      expect(response.status).toBe(200);
      expect(savedSessions.size).toBe(1);
      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).toContain("bdta_session=");

      const adminProfile = await fetch(`${baseUrl}/api/admin/me`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });

      expect(adminProfile.status).toBe(200);
      expect(await adminProfile.json()).toEqual({
        actor: {
          actorId: "admin-1",
          source: "admin_user",
          username: "accountant",
          displayName: "Accountant User",
          role: "accountant",
          active: true
        }
      });

      const access = await fetch(`${baseUrl}/api/admin/access?path=%2Fclient%2Fsettings.php`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });

      expect(access.status).toBe(200);
      expect(await access.json()).toEqual({
        allowed: false,
        reason: "accountant_restricted"
      });

      const dashboard = await fetch(`${baseUrl}/api/admin/dashboard`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });

      expect(dashboard.status).toBe(200);
      expect(await dashboard.json()).toEqual({
        metrics: {
          pendingBookings: 0,
          todaysBookings: 0,
          overdueInvoices: 0,
          activeClients: 1
        },
        recentBookings: []
      });

      const clients = await fetch(`${baseUrl}/api/admin/clients`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });
      const pets = await fetch(`${baseUrl}/api/admin/pets`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });
      const petDetail = await fetch(`${baseUrl}/api/admin/pets/pet-admin-1`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });

      const bookings = await fetch(`${baseUrl}/api/admin/bookings`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });
      const invoices = await fetch(`${baseUrl}/api/admin/invoices`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });
      const quotes = await fetch(`${baseUrl}/api/admin/quotes`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });
      const contracts = await fetch(`${baseUrl}/api/admin/contracts`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });
      const forms = await fetch(`${baseUrl}/api/admin/forms`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });
      const packages = await fetch(`${baseUrl}/api/admin/packages`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });
      const packageDetail = await fetch(`${baseUrl}/api/admin/packages/package-admin-1`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });
      const credits = await fetch(`${baseUrl}/api/admin/credits`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });
      const creditDetail = await fetch(`${baseUrl}/api/admin/credits/credit-admin-1`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });
      const jobLogs = await fetch(`${baseUrl}/api/admin/operations/jobs`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });
      const jobLog = await fetch(`${baseUrl}/api/admin/operations/jobs/job-queued-1`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });
      const callbackLogs = await fetch(`${baseUrl}/api/admin/operations/callbacks`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });
      const callbackLog = await fetch(`${baseUrl}/api/admin/operations/callbacks/callback-1`, {
        headers: {
          cookie: setCookie ?? ""
        }
      });

      expect(clients.status).toBe(200);
      expect(await clients.json()).toEqual({
        items: [{
          id: "client-admin-1",
          email: "owner@example.com",
          firstName: "Owner",
          lastName: "Client",
          archived: false
        }]
      });
      expect(pets.status).toBe(200);
      expect(await pets.json()).toEqual({
        items: [{
          id: "pet-admin-1",
          clientId: "client-admin-1",
          name: "Scout",
          species: "Dog",
          petSittingNotes: "Use the side gate and towel paws before re-entry.",
          archived: false
        }]
      });
      expect(petDetail.status).toBe(200);
      expect(await petDetail.json()).toEqual({
        item: {
          id: "pet-admin-1",
          clientId: "client-admin-1",
          name: "Scout",
          species: "Dog",
          petSittingNotes: "Use the side gate and towel paws before re-entry.",
          archived: false
        }
      });
      expect(bookings.status).toBe(200);
      expect(await bookings.json()).toEqual({ items: [] });
      expect(invoices.status).toBe(200);
      expect(await invoices.json()).toEqual({
        items: [{
          id: "invoice-admin-1",
          clientId: "client-admin-1",
          status: "sent",
          totalAmount: 300,
          outstandingAmount: 150,
          dueAt: "2026-06-10T00:00:00.000Z"
        }]
      });
      expect(quotes.status).toBe(200);
      expect(await quotes.json()).toEqual({
        items: [{
          id: "quote-admin-1",
          clientId: "client-admin-1",
          status: "sent",
          totalAmount: 475,
          publicAccess: null
        }]
      });
      expect(contracts.status).toBe(200);
      expect(await contracts.json()).toEqual({
        items: [{
          id: "contract-admin-1",
          clientId: "client-admin-1",
          status: "sent",
          publicAccess: null
        }]
      });
      expect(forms.status).toBe(200);
      expect(await forms.json()).toEqual({
        items: [expect.objectContaining({
          id: "form-admin-1",
          templateId: "template-admin-1",
          clientId: "client-admin-1",
          submittedAt: null,
          publicAccess: null,
          status: "pending"
        })]
      });
      expect(packages.status).toBe(200);
      expect(await packages.json()).toEqual({
        items: [{
          id: "package-admin-1",
          name: "Starter Package",
          active: true,
          price: 325
        }]
      });
      expect(packageDetail.status).toBe(200);
      expect(await packageDetail.json()).toEqual({
        item: {
          id: "package-admin-1",
          name: "Starter Package",
          active: true,
          price: 325
        }
      });
      expect(credits.status).toBe(200);
      expect(await credits.json()).toEqual({
        items: [{
          id: "credit-admin-1",
          clientId: "client-admin-1",
          packageId: "package-admin-1",
          appointmentTypeId: "appointment-type-admin-1",
          remainingUnits: 4
        }]
      });
      expect(creditDetail.status).toBe(200);
      expect(await creditDetail.json()).toEqual({
        item: {
          id: "credit-admin-1",
          clientId: "client-admin-1",
          packageId: "package-admin-1",
          appointmentTypeId: "appointment-type-admin-1",
          remainingUnits: 4
        }
      });
      expect(jobLogs.status).toBe(200);
      expect(await jobLogs.json()).toEqual({
        items: [{
          jobId: "job-queued-1",
          kind: "workflow_processor",
          scheduledFor: "2026-05-27T17:30:00.000Z",
          status: "queued",
          processedAt: null,
          summary: null,
          payload: {
            limit: 10
          }
        }]
      });
      expect(jobLog.status).toBe(200);
      expect(await jobLog.json()).toEqual({
        item: {
          jobId: "job-queued-1",
          kind: "workflow_processor",
          scheduledFor: "2026-05-27T17:30:00.000Z",
          status: "queued",
          processedAt: null,
          summary: null,
          payload: {
            limit: 10
          }
        }
      });
      expect(callbackLogs.status).toBe(200);
      expect(await callbackLogs.json()).toEqual({
        items: [{
          callbackId: "callback-1",
          provider: "imap",
          receivedAt: "2026-05-27T18:05:00.000Z",
          queuedJobId: "job-email-1",
          payload: {
            messageId: "imap-message-1",
            from: "owner@example.com",
            subject: "Need help with my booking"
          }
        }]
      });
      expect(callbackLog.status).toBe(200);
      expect(await callbackLog.json()).toEqual({
        item: {
          callbackId: "callback-1",
          provider: "imap",
          receivedAt: "2026-05-27T18:05:00.000Z",
          queuedJobId: "job-email-1",
          payload: {
            messageId: "imap-message-1",
            from: "owner@example.com",
            subject: "Need help with my booking"
          }
        }
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("loads the active session from the issued cookie and clears it on logout", async () => {
    const state = createInMemoryPlatformState({
      bookings: [
        {
          id: "booking-ical-1",
          clientId: "client-portal-1",
          petIds: ["pet-1"],
          serviceId: "svc-private-lesson",
          startsAt: "2026-06-01T16:00:00.000Z",
          endsAt: "2026-06-01T17:00:00.000Z",
          status: "confirmed",
          icalAccess: {
            token: "ical-access-token-123456",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "booking-ical-1"
          }
        }
      ],
      invoices: [
        {
          id: "invoice-1",
          clientId: "client-portal-1",
          status: "sent",
          totalAmount: 225,
          outstandingAmount: 125,
          dueAt: "2026-06-05T00:00:00.000Z"
        }
      ],
      quotes: [
        {
          id: "quote-1",
          clientId: "client-portal-1",
          status: "sent",
          totalAmount: 450,
          publicAccess: {
            token: "quote-access-token-1234",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "quote-1"
          }
        }
      ],
      contracts: [
        {
          id: "contract-1",
          clientId: "client-portal-1",
          status: "sent",
          publicAccess: {
            token: "contract-access-token-1234",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "contract-1"
          }
        }
      ],
      packages: [
        {
          id: "package-ical-1",
          name: "Follow-up Package",
          active: true,
          price: 275
        }
      ],
      pets: [
        {
          id: "pet-ical-1",
          clientId: "client-portal-1",
          name: "Riley",
          species: "Dog",
          petSittingNotes: "Use the side gate and towel paws before re-entry.",
          archived: false
        }
      ],
      credits: [
        {
          id: "credit-ical-1",
          clientId: "client-portal-1",
          packageId: "package-ical-1",
          appointmentTypeId: "appointment-type-ical-1",
          remainingUnits: 2
        }
      ],
      formSubmissions: [
        {
          id: "form-1",
          templateId: "template-1",
          clientId: "client-portal-1",
          templateName: "Client Intake",
          formType: "client_form",
          templateIsInternal: false,
          submittedAt: null,
          publicAccess: {
            token: "form-access-token-123456",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "form-1"
          }
        },
        {
          id: "form-hidden-1",
          templateId: "template-hidden",
          clientId: "client-portal-1",
          templateName: "Internal Staff Note",
          formType: "client_form",
          submittedAt: "2026-05-26T10:00:00.000Z",
          publicAccess: null
        }
      ],
      portalUsers: [
        {
          clientId: "client-portal-1",
          email: "portal@example.com",
          displayName: "Portal User",
          passwordHash: "portal-hash",
          archived: false
        }
      ],
      passwordVerifier: async (password, hash) => password === "portal-password" && hash === "portal-hash"
    });

    const sessionStore = createInMemorySessionStore(state);
    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const login = await fetch(`${baseUrl}/api/portal/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email: "portal@example.com",
          password: "portal-password",
          returnTo: null
        })
      });

      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie");
      expect(cookie).toContain("bdta_session=");

      const session = await fetch(`${baseUrl}/api/session`, {
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(session.status).toBe(200);
      expect(await session.json()).toEqual({
        authenticated: true,
        session: {
          actorId: "client-portal-1",
          actorType: "portal_user",
          role: null,
          issuedAt: "2026-05-27T18:00:00.000Z",
          expiresAt: "2026-05-27T18:00:00.000Z"
        }
      });

      const portalProfile = await fetch(`${baseUrl}/api/portal/me`, {
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(portalProfile.status).toBe(200);
      expect(await portalProfile.json()).toEqual({
        actor: {
          clientId: "client-portal-1",
          email: "portal@example.com",
          displayName: "Portal User",
          archived: false
        }
      });

      const portalSummary = await fetch(`${baseUrl}/api/portal/summary`, {
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(portalSummary.status).toBe(200);
      expect(await portalSummary.json()).toEqual({
        upcomingBookings: [{
          id: "booking-ical-1",
          clientId: "client-portal-1",
          petIds: ["pet-1"],
          serviceId: "svc-private-lesson",
          startsAt: "2026-06-01T16:00:00.000Z",
          endsAt: "2026-06-01T17:00:00.000Z",
          status: "confirmed",
          icalAccess: {
            token: "ical-access-token-123456",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "booking-ical-1"
          }
        }],
        openInvoices: [{
          id: "invoice-1",
          clientId: "client-portal-1",
          status: "sent",
          totalAmount: 225,
          outstandingAmount: 125,
          dueAt: "2026-06-05T00:00:00.000Z"
        }],
        activeQuotes: [{
          id: "quote-1",
          clientId: "client-portal-1",
          status: "sent",
          totalAmount: 450,
          publicAccess: {
            token: "quote-access-token-1234",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "quote-1"
          }
        }]
      });

      const portalBookings = await fetch(`${baseUrl}/api/portal/bookings`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const portalPets = await fetch(`${baseUrl}/api/portal/pets`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const portalPetDetail = await fetch(`${baseUrl}/api/portal/pets/pet-ical-1`, {
        headers: {
          cookie: cookie ?? ""
        }
      });

      const portalInvoices = await fetch(`${baseUrl}/api/portal/invoices`, {
        headers: {
          cookie: cookie ?? ""
        }
      });

      const portalContracts = await fetch(`${baseUrl}/api/portal/contracts`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const portalPackages = await fetch(`${baseUrl}/api/portal/packages`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const portalPackageDetail = await fetch(`${baseUrl}/api/portal/packages/package-ical-1`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const portalCredits = await fetch(`${baseUrl}/api/portal/credits`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const portalCreditDetail = await fetch(`${baseUrl}/api/portal/credits/credit-ical-1`, {
        headers: {
          cookie: cookie ?? ""
        }
      });

      const portalForms = await fetch(`${baseUrl}/api/portal/forms`, {
        headers: {
          cookie: cookie ?? ""
        }
      });

      const acceptedQuote = await fetch(`${baseUrl}/api/portal/quotes/quote-1/accept`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      });

      const paymentSession = await fetch(`${baseUrl}/api/portal/invoices/invoice-1/payment-session`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          returnUrl: "https://portal.example.test/portal/payments/complete",
          cancelUrl: "https://portal.example.test/portal/payments/cancelled"
        })
      });

      const signedContract = await fetch(`${baseUrl}/api/portal/contracts/contract-1/sign`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      });

      const submittedForm = await fetch(`${baseUrl}/api/portal/forms/form-1/submit`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      });

      expect(portalBookings.status).toBe(200);
      expect(await portalBookings.json()).toEqual({
        items: [{
          id: "booking-ical-1",
          clientId: "client-portal-1",
          petIds: ["pet-1"],
          serviceId: "svc-private-lesson",
          startsAt: "2026-06-01T16:00:00.000Z",
          endsAt: "2026-06-01T17:00:00.000Z",
          status: "confirmed",
          icalAccess: {
            token: "ical-access-token-123456",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "booking-ical-1"
          }
        }]
      });
      expect(portalPets.status).toBe(200);
      expect(await portalPets.json()).toEqual({
        items: [{
          id: "pet-ical-1",
          clientId: "client-portal-1",
          name: "Riley",
          species: "Dog",
          petSittingNotes: "Use the side gate and towel paws before re-entry.",
          archived: false
        }]
      });
      expect(portalPetDetail.status).toBe(200);
      expect(await portalPetDetail.json()).toEqual({
        item: {
          id: "pet-ical-1",
          clientId: "client-portal-1",
          name: "Riley",
          species: "Dog",
          petSittingNotes: "Use the side gate and towel paws before re-entry.",
          archived: false
        }
      });
      expect(portalInvoices.status).toBe(200);
      expect(await portalInvoices.json()).toEqual({
        items: [{
          id: "invoice-1",
          clientId: "client-portal-1",
          status: "sent",
          totalAmount: 225,
          outstandingAmount: 125,
          dueAt: "2026-06-05T00:00:00.000Z"
        }]
      });
      expect(portalContracts.status).toBe(200);
      expect(await portalContracts.json()).toEqual({
        items: [{
          id: "contract-1",
          clientId: "client-portal-1",
          status: "sent",
          publicAccess: {
            token: "contract-access-token-1234",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "contract-1"
          }
        }]
      });
      expect(portalPackages.status).toBe(200);
      expect(await portalPackages.json()).toEqual({
        items: [{
          id: "package-ical-1",
          name: "Follow-up Package",
          active: true,
          price: 275
        }]
      });
      expect(portalPackageDetail.status).toBe(200);
      expect(await portalPackageDetail.json()).toEqual({
        item: {
          id: "package-ical-1",
          name: "Follow-up Package",
          active: true,
          price: 275
        }
      });
      expect(portalCredits.status).toBe(200);
      expect(await portalCredits.json()).toEqual({
        items: [{
          id: "credit-ical-1",
          clientId: "client-portal-1",
          packageId: "package-ical-1",
          appointmentTypeId: "appointment-type-ical-1",
          remainingUnits: 2
        }]
      });
      expect(portalCreditDetail.status).toBe(200);
      expect(await portalCreditDetail.json()).toEqual({
        item: {
          id: "credit-ical-1",
          clientId: "client-portal-1",
          packageId: "package-ical-1",
          appointmentTypeId: "appointment-type-ical-1",
          remainingUnits: 2
        }
      });
      expect(portalForms.status).toBe(200);
      expect(await portalForms.json()).toEqual({
        items: [{
          id: "form-1",
          templateId: "template-1",
          clientId: "client-portal-1",
          templateName: "Client Intake",
          formType: "client_form",
          templateIsInternal: false,
          clientReviewSubmission: false,
          submittedAt: null,
          publicAccess: {
            token: "form-access-token-123456",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "form-1"
          }
        }]
      });
      expect(acceptedQuote.status).toBe(200);
      expect(await acceptedQuote.json()).toEqual({
        item: {
          id: "quote-1",
          clientId: "client-portal-1",
          status: "accepted",
          totalAmount: 450,
          acceptedAt: "2026-05-27T18:00:00.000Z",
          publicAccess: {
            token: "quote-access-token-1234",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "quote-1"
          }
        }
      });
      expect(paymentSession.status).toBe(200);
      expect(await paymentSession.json()).toEqual({
        invoice: {
          id: "invoice-1",
          clientId: "client-portal-1",
          status: "sent",
          totalAmount: 225,
          outstandingAmount: 125,
          dueAt: "2026-06-05T00:00:00.000Z"
        },
        paymentSession: {
          provider: "stripe",
          checkoutUrl: "https://portal.example.test/portal/payments/complete?invoice=invoice-1",
          expiresAt: "2026-05-27T19:00:00.000Z"
        }
      });
      expect(signedContract.status).toBe(200);
      expect(await signedContract.json()).toEqual({
        item: {
          id: "contract-1",
          clientId: "client-portal-1",
          status: "signed",
          signedAt: "2026-05-27T18:00:00.000Z",
          publicAccess: {
            token: "contract-access-token-1234",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "contract-1"
          }
        }
      });
      expect(submittedForm.status).toBe(200);
      expect(await submittedForm.json()).toEqual({
        item: {
          id: "form-1",
          templateId: "template-1",
          clientId: "client-portal-1",
          templateName: "Client Intake",
          formType: "client_form",
          templateIsInternal: false,
          clientReviewSubmission: false,
          status: "submitted",
          submittedAt: "2026-05-27T18:00:00.000Z",
          publicAccess: {
            token: "form-access-token-123456",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "form-1"
          }
        }
      });

      const publicQuote = await fetch(`${baseUrl}/api/public/quotes/quote-1?token=quote-access-token-1234`);
      const publicContract = await fetch(`${baseUrl}/api/public/contracts/contract-1?token=contract-access-token-1234`);
      const publicForm = await fetch(`${baseUrl}/api/public/forms/form-1?token=form-access-token-123456`);
      const publicBookingIcal = await fetch(`${baseUrl}/api/public/bookings/booking-ical-1/ical?token=ical-access-token-123456`);

      expect(publicQuote.status).toBe(200);
      expect(await publicQuote.json()).toEqual({
        item: {
          id: "quote-1",
          clientId: "client-portal-1",
          status: "accepted",
          totalAmount: 450,
          acceptedAt: "2026-05-27T18:00:00.000Z",
          publicAccess: {
            token: "quote-access-token-1234",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "quote-1"
          }
        }
      });
      expect(publicContract.status).toBe(200);
      expect(await publicContract.json()).toEqual({
        item: {
          id: "contract-1",
          clientId: "client-portal-1",
          status: "signed",
          signedAt: "2026-05-27T18:00:00.000Z",
          publicAccess: {
            token: "contract-access-token-1234",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "contract-1"
          }
        }
      });
      expect(publicForm.status).toBe(200);
      expect(await publicForm.json()).toEqual({
        item: expect.objectContaining({
          id: "form-1",
          templateId: "template-1",
          clientId: "client-portal-1",
          templateName: "Client Intake",
          formType: "client_form",
          templateIsInternal: false,
          clientReviewSubmission: false,
          submittedAt: "2026-05-27T18:00:00.000Z",
          publicAccess: {
            token: "form-access-token-123456",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "form-1"
          }
        })
      });
      expect(publicBookingIcal.status).toBe(200);
      expect(publicBookingIcal.headers.get("content-type")).toContain("text/calendar");
      expect(await publicBookingIcal.text()).toContain("BEGIN:VCALENDAR");

      const invalidPublicQuote = await fetch(`${baseUrl}/api/public/quotes/quote-1?token=wrong-token-999999`);
      expect(invalidPublicQuote.status).toBe(404);

      const logout = await fetch(`${baseUrl}/api/logout`, {
        method: "POST",
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(logout.status).toBe(200);
      expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
      expect(await logout.json()).toEqual({ loggedOut: true });

      const afterLogout = await fetch(`${baseUrl}/api/session`, {
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(afterLogout.status).toBe(200);
      expect(await afterLogout.json()).toEqual({ authenticated: false });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("exposes authenticated portal and admin contact collection routes", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [
        {
          actorId: "admin-1",
          username: "accountant",
          displayName: "Accountant User",
          passwordHash: "admin-hash",
          role: "accountant",
          active: true
        }
      ],
      portalUsers: [
        {
          clientId: "client-admin-1",
          email: "owner@example.com",
          displayName: "Owner Client",
          passwordHash: "client-hash",
          archived: false
        }
      ],
      passwordVerifier: async (password, hash) => (
        (password === "correct-password" && hash === "admin-hash")
        || (password === "client-password" && hash === "client-hash")
      )
    });

    const savedSessions = new Map<string, string>();
    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore: {
        save: async (sessionId: string, sessionData: string) => {
          savedSessions.set(sessionId, sessionData);
        },
        load: async (sessionId: string) => savedSessions.get(sessionId) ?? null,
        delete: async (sessionId: string) => {
          savedSessions.delete(sessionId);
        }
      }
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const portalLogin = await fetch(`${baseUrl}/api/portal/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email: "owner@example.com",
          password: "client-password",
          returnTo: null
        })
      });
      const portalCookie = portalLogin.headers.get("set-cookie");
      expect(portalCookie).toContain("bdta_session=");

      const adminLogin = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          username: "accountant",
          password: "correct-password"
        })
      });
      const adminCookie = adminLogin.headers.get("set-cookie");
      expect(adminCookie).toContain("bdta_session=");

      const portalContacts = await fetch(`${baseUrl}/api/portal/contacts`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const adminContacts = await fetch(`${baseUrl}/api/admin/clients/client-admin-1/contacts`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });

      expect(portalContacts.status).toBe(200);
      expect(await portalContacts.json()).toEqual({ items: [] });
      expect(adminContacts.status).toBe(200);
      expect(await adminContacts.json()).toEqual({ items: [] });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("exposes authenticated portal and admin achievement routes", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [
        {
          actorId: "admin-1",
          username: "accountant",
          displayName: "Accountant User",
          passwordHash: "admin-hash",
          role: "accountant",
          active: true
        }
      ],
      portalUsers: [
        {
          clientId: "client-admin-1",
          email: "owner@example.com",
          displayName: "Owner Client",
          passwordHash: "client-hash",
          archived: false
        }
      ],
      achievementTypes: [
        {
          id: "achievement-type-1",
          title: "Canine Good Citizen",
          description: "Awarded after program completion.",
          scopeType: "general",
          awardMode: "badge_certificate",
          badgeIconPath: "/assets/badges/cgc.svg",
          certificateTemplatePath: "/assets/certificates/cgc.html",
          certificateBodyHtml: "<p>Certificate Body</p>",
          active: true
        }
      ],
      clientAchievements: [
        {
          id: "achievement-1",
          clientId: "client-admin-1",
          achievementTypeId: "achievement-type-1",
          title: "Canine Good Citizen",
          description: "Awarded after program completion.",
          scopeType: "general",
          awardMode: "badge_certificate",
          badgeIconPath: "/assets/badges/cgc.svg",
          certificateTemplatePath: "/assets/certificates/cgc.html",
          certificateBodyHtml: "<p>Certificate Body</p>",
          status: "awarded",
          awardedOn: "2026-05-20",
          dogName: "Buddy",
          programName: "Obedience 101",
          notes: "Completed successfully",
          awardedByAdminUserId: "admin-1",
          updatedByAdminUserId: "admin-1",
          revokedByAdminUserId: null,
          revokedAt: null,
          createdAt: "2026-05-20T12:00:00.000Z",
          updatedAt: "2026-05-20T12:00:00.000Z"
        }
      ],
      passwordVerifier: async (password, hash) => (
        (password === "correct-password" && hash === "admin-hash")
        || (password === "client-password" && hash === "client-hash")
      )
    });

    const savedSessions = new Map<string, string>();
    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore: {
        save: async (sessionId: string, sessionData: string) => {
          savedSessions.set(sessionId, sessionData);
        },
        load: async (sessionId: string) => savedSessions.get(sessionId) ?? null,
        delete: async (sessionId: string) => {
          savedSessions.delete(sessionId);
        }
      }
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const portalLogin = await fetch(`${baseUrl}/api/portal/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email: "owner@example.com",
          password: "client-password",
          returnTo: null
        })
      });
      const portalCookie = portalLogin.headers.get("set-cookie");
      expect(portalCookie).toContain("bdta_session=");

      const adminLogin = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          username: "accountant",
          password: "correct-password"
        })
      });
      const adminCookie = adminLogin.headers.get("set-cookie");
      expect(adminCookie).toContain("bdta_session=");

      const portalAchievements = await fetch(`${baseUrl}/api/portal/achievements`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const portalAchievement = await fetch(`${baseUrl}/api/portal/achievements/achievement-1`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const portalCertificate = await fetch(`${baseUrl}/api/portal/achievements/achievement-1/certificate`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const adminAchievementTypes = await fetch(`${baseUrl}/api/admin/achievement-types`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminAchievementType = await fetch(`${baseUrl}/api/admin/achievement-types/achievement-type-1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminClientAchievements = await fetch(`${baseUrl}/api/admin/clients/client-admin-1/achievements`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminClientAchievement = await fetch(`${baseUrl}/api/admin/clients/client-admin-1/achievements/achievement-1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminCertificate = await fetch(`${baseUrl}/api/admin/clients/client-admin-1/achievements/achievement-1/certificate?download=1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });

      expect(portalAchievements.status).toBe(200);
      expect(await portalAchievements.json()).toEqual({
        items: [{
          id: "achievement-1",
          clientId: "client-admin-1",
          achievementTypeId: "achievement-type-1",
          title: "Canine Good Citizen",
          description: "Awarded after program completion.",
          scopeType: "general",
          awardMode: "badge_certificate",
          badgeIconPath: "/assets/badges/cgc.svg",
          certificateTemplatePath: "/assets/certificates/cgc.html",
          certificateBodyHtml: "<p>Certificate Body</p>",
          status: "awarded",
          awardedOn: "2026-05-20",
          dogName: "Buddy",
          programName: "Obedience 101",
          notes: "Completed successfully",
          awardedByAdminUserId: "admin-1",
          updatedByAdminUserId: "admin-1",
          revokedByAdminUserId: null,
          revokedAt: null,
          createdAt: "2026-05-20T12:00:00.000Z",
          updatedAt: "2026-05-20T12:00:00.000Z"
        }]
      });
      expect(portalAchievement.status).toBe(200);
      expect((await portalAchievement.json()).item.id).toBe("achievement-1");
      expect(portalCertificate.status).toBe(200);
      expect(portalCertificate.headers.get("content-type")).toContain("text/html");
      expect(await portalCertificate.text()).toContain("Canine Good Citizen");
      expect(adminAchievementTypes.status).toBe(200);
      expect((await adminAchievementTypes.json()).items[0]?.id).toBe("achievement-type-1");
      expect(adminAchievementType.status).toBe(200);
      expect((await adminAchievementType.json()).item.awardMode).toBe("badge_certificate");
      expect(adminClientAchievements.status).toBe(200);
      expect((await adminClientAchievements.json()).items[0]?.programName).toBe("Obedience 101");
      expect(adminClientAchievement.status).toBe(200);
      expect((await adminClientAchievement.json()).item.dogName).toBe("Buddy");
      expect(adminCertificate.status).toBe(200);
      expect(adminCertificate.headers.get("content-type")).toContain("text/html");
      expect(adminCertificate.headers.get("content-disposition")).toContain("attachment");
      expect(await adminCertificate.text()).toContain('data-download="1"');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("exposes authenticated portal and admin pet file routes", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [
        {
          actorId: "admin-1",
          username: "accountant",
          displayName: "Accountant User",
          passwordHash: "admin-hash",
          role: "accountant",
          active: true
        }
      ],
      portalUsers: [
        {
          clientId: "client-admin-1",
          email: "owner@example.com",
          displayName: "Owner Client",
          passwordHash: "client-hash",
          archived: false
        }
      ],
      pets: [
        {
          id: "pet-admin-1",
          clientId: "client-admin-1",
          name: "Scout",
          species: "Dog",
          petSittingNotes: "Use the side gate and towel paws before re-entry.",
          archived: false
        }
      ],
      petFiles: [
        {
          id: "pet-file-1",
          petId: "pet-admin-1",
          fileType: "document",
          fileName: "vaccination-record.pdf",
          originalName: "Vaccination Record.pdf",
          fileSize: 120340,
          mimeType: "application/pdf",
          description: "Vaccination record",
          uploadedByAdminUserId: null,
          uploadedAt: "2026-05-26T12:00:00.000Z"
        },
        {
          id: "pet-file-2",
          petId: "pet-admin-1",
          fileType: "photo",
          fileName: "scout-headshot.jpg",
          originalName: "Scout Headshot.jpg",
          fileSize: 98342,
          mimeType: "image/jpeg",
          description: "Front profile",
          uploadedByAdminUserId: "admin-1",
          uploadedAt: "2026-05-25T09:30:00.000Z"
        }
      ],
      petFileContents: {
        "pet-file-1": "vaccination-record-body",
        "pet-file-2": "scout-headshot-body"
      },
      passwordVerifier: async (password, hash) => (
        (password === "correct-password" && hash === "admin-hash")
        || (password === "client-password" && hash === "client-hash")
      )
    });

    const savedSessions = new Map<string, string>();
    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore: {
        save: async (sessionId: string, sessionData: string) => {
          savedSessions.set(sessionId, sessionData);
        },
        load: async (sessionId: string) => savedSessions.get(sessionId) ?? null,
        delete: async (sessionId: string) => {
          savedSessions.delete(sessionId);
        }
      }
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const portalLogin = await fetch(`${baseUrl}/api/portal/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email: "owner@example.com",
          password: "client-password",
          returnTo: null
        })
      });
      const portalCookie = portalLogin.headers.get("set-cookie");
      expect(portalCookie).toContain("bdta_session=");

      const adminLogin = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          username: "accountant",
          password: "correct-password"
        })
      });
      const adminCookie = adminLogin.headers.get("set-cookie");
      expect(adminCookie).toContain("bdta_session=");

      const portalFiles = await fetch(`${baseUrl}/api/portal/pets/pet-admin-1/files`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const portalFile = await fetch(`${baseUrl}/api/portal/pets/pet-admin-1/files/pet-file-1`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const portalContent = await fetch(`${baseUrl}/api/portal/pets/pet-admin-1/files/pet-file-1/content`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const portalDeleted = await fetch(`${baseUrl}/api/portal/pets/pet-admin-1/files/pet-file-1/delete`, {
        method: "POST",
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const adminFiles = await fetch(`${baseUrl}/api/admin/pets/pet-admin-1/files`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminFile = await fetch(`${baseUrl}/api/admin/pets/pet-admin-1/files/pet-file-2`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminContent = await fetch(`${baseUrl}/api/admin/pets/pet-admin-1/files/pet-file-2/content?download=1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminDeleted = await fetch(`${baseUrl}/api/admin/pets/pet-admin-1/files/pet-file-2/delete`, {
        method: "POST",
        headers: {
          cookie: adminCookie ?? ""
        }
      });

      expect(portalFiles.status).toBe(200);
      expect(await portalFiles.json()).toEqual({
        items: [{
          id: "pet-file-1",
          petId: "pet-admin-1",
          fileType: "document",
          fileName: "vaccination-record.pdf",
          originalName: "Vaccination Record.pdf",
          fileSize: 120340,
          mimeType: "application/pdf",
          description: "Vaccination record",
          uploadedByAdminUserId: null,
          uploadedAt: "2026-05-26T12:00:00.000Z"
        }, {
          id: "pet-file-2",
          petId: "pet-admin-1",
          fileType: "photo",
          fileName: "scout-headshot.jpg",
          originalName: "Scout Headshot.jpg",
          fileSize: 98342,
          mimeType: "image/jpeg",
          description: "Front profile",
          uploadedByAdminUserId: "admin-1",
          uploadedAt: "2026-05-25T09:30:00.000Z"
        }]
      });
      expect(portalFile.status).toBe(200);
      expect(await portalFile.json()).toEqual({
        item: {
          id: "pet-file-1",
          petId: "pet-admin-1",
          fileType: "document",
          fileName: "vaccination-record.pdf",
          originalName: "Vaccination Record.pdf",
          fileSize: 120340,
          mimeType: "application/pdf",
          description: "Vaccination record",
          uploadedByAdminUserId: null,
          uploadedAt: "2026-05-26T12:00:00.000Z"
        }
      });
      expect(portalContent.status).toBe(200);
      expect(portalContent.headers.get("content-type")).toContain("application/pdf");
      expect(portalContent.headers.get("content-disposition")).toContain("inline");
      expect(await portalContent.text()).toBe("vaccination-record-body");
      expect(portalDeleted.status).toBe(200);
      expect(await portalDeleted.json()).toEqual({ deleted: true });
      expect(adminFiles.status).toBe(200);
      expect(await adminFiles.json()).toEqual({
        items: [{
          id: "pet-file-2",
          petId: "pet-admin-1",
          fileType: "photo",
          fileName: "scout-headshot.jpg",
          originalName: "Scout Headshot.jpg",
          fileSize: 98342,
          mimeType: "image/jpeg",
          description: "Front profile",
          uploadedByAdminUserId: "admin-1",
          uploadedAt: "2026-05-25T09:30:00.000Z"
        }]
      });
      expect(adminFile.status).toBe(200);
      expect(await adminFile.json()).toEqual({
        item: {
          id: "pet-file-2",
          petId: "pet-admin-1",
          fileType: "photo",
          fileName: "scout-headshot.jpg",
          originalName: "Scout Headshot.jpg",
          fileSize: 98342,
          mimeType: "image/jpeg",
          description: "Front profile",
          uploadedByAdminUserId: "admin-1",
          uploadedAt: "2026-05-25T09:30:00.000Z"
        }
      });
      expect(adminContent.status).toBe(200);
      expect(adminContent.headers.get("content-type")).toContain("image/jpeg");
      expect(adminContent.headers.get("content-disposition")).toContain("attachment");
      expect(await adminContent.text()).toBe("scout-headshot-body");
      expect(adminDeleted.status).toBe(200);
      expect(await adminDeleted.json()).toEqual({ deleted: true });
      expect(state.petFiles).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("accepts authenticated portal and admin pet file uploads", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [
        {
          actorId: "admin-1",
          username: "accountant",
          displayName: "Accountant User",
          passwordHash: "admin-hash",
          role: "accountant",
          active: true
        }
      ],
      portalUsers: [
        {
          clientId: "client-admin-1",
          email: "owner@example.com",
          displayName: "Owner Client",
          passwordHash: "client-hash",
          archived: false
        }
      ],
      pets: [
        {
          id: "pet-admin-1",
          clientId: "client-admin-1",
          name: "Scout",
          species: "Dog",
          petSittingNotes: "Use the side gate and towel paws before re-entry.",
          archived: false
        }
      ],
      passwordVerifier: async (password, hash) => (
        (password === "correct-password" && hash === "admin-hash")
        || (password === "client-password" && hash === "client-hash")
      )
    });

    const savedSessions = new Map<string, string>();
    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore: {
        save: async (sessionId: string, sessionData: string) => {
          savedSessions.set(sessionId, sessionData);
        },
        load: async (sessionId: string) => savedSessions.get(sessionId) ?? null,
        delete: async (sessionId: string) => {
          savedSessions.delete(sessionId);
        }
      }
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const portalLogin = await fetch(`${baseUrl}/api/portal/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email: "owner@example.com",
          password: "client-password",
          returnTo: null
        })
      });
      const portalCookie = portalLogin.headers.get("set-cookie");
      expect(portalCookie).toContain("bdta_session=");

      const adminLogin = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          username: "accountant",
          password: "correct-password"
        })
      });
      const adminCookie = adminLogin.headers.get("set-cookie");
      expect(adminCookie).toContain("bdta_session=");

      const portalUploadForm = new FormData();
      portalUploadForm.set("description", "Vaccination record");
      portalUploadForm.set("file", new File([
        Buffer.from("%PDF-1.4\nportal-upload-pdf-body", "utf8")
      ], "Vaccination Record.pdf", { type: "application/pdf" }));

      const portalUpload = await fetch(`${baseUrl}/api/portal/pets/pet-admin-1/files`, {
        method: "POST",
        headers: {
          cookie: portalCookie ?? ""
        },
        body: portalUploadForm
      });

      const adminUploadForm = new FormData();
      adminUploadForm.set("description", "Front profile");
      adminUploadForm.set("file", new File([
        Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
      ], "Scout Headshot.jpg", { type: "image/jpeg" }));

      const adminUpload = await fetch(`${baseUrl}/api/admin/pets/pet-admin-1/files`, {
        method: "POST",
        headers: {
          cookie: adminCookie ?? ""
        },
        body: adminUploadForm
      });

      expect(portalUpload.status).toBe(201);
      expect(adminUpload.status).toBe(201);

      const portalPayload = await portalUpload.json();
      const adminPayload = await adminUpload.json();

      expect(portalPayload.item.fileType).toBe("document");
      expect(portalPayload.item.originalName).toBe("Vaccination_Record.pdf");
      expect(portalPayload.item.description).toBe("Vaccination record");
      expect(portalPayload.item.uploadedByAdminUserId).toBeNull();
      expect(adminPayload.item.fileType).toBe("photo");
      expect(adminPayload.item.originalName).toBe("Scout_Headshot.jpg");
      expect(adminPayload.item.description).toBe("Front profile");
      expect(adminPayload.item.uploadedByAdminUserId).toBe("admin-1");
      expect(state.petFiles).toHaveLength(2);
      expect(Object.keys(state.petFileContents)).toHaveLength(2);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("rejects pet file uploads when the content does not match the extension", async () => {
    const state = createInMemoryPlatformState({
      portalUsers: [
        {
          clientId: "client-admin-1",
          email: "owner@example.com",
          displayName: "Owner Client",
          passwordHash: "client-hash",
          archived: false
        }
      ],
      pets: [
        {
          id: "pet-admin-1",
          clientId: "client-admin-1",
          name: "Scout",
          species: "Dog",
          petSittingNotes: "Use the side gate and towel paws before re-entry.",
          archived: false
        }
      ],
      passwordVerifier: async (password, hash) => password === "client-password" && hash === "client-hash"
    });

    const savedSessions = new Map<string, string>();
    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore: {
        save: async (sessionId: string, sessionData: string) => {
          savedSessions.set(sessionId, sessionData);
        },
        load: async (sessionId: string) => savedSessions.get(sessionId) ?? null,
        delete: async (sessionId: string) => {
          savedSessions.delete(sessionId);
        }
      }
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const portalLogin = await fetch(`${baseUrl}/api/portal/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email: "owner@example.com",
          password: "client-password",
          returnTo: null
        })
      });
      const portalCookie = portalLogin.headers.get("set-cookie");
      expect(portalCookie).toContain("bdta_session=");

      const invalidUploadForm = new FormData();
      invalidUploadForm.set("file", new File([
        Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
      ], "looks-like-pdf.pdf", { type: "application/pdf" }));

      const invalidUpload = await fetch(`${baseUrl}/api/portal/pets/pet-admin-1/files`, {
        method: "POST",
        headers: {
          cookie: portalCookie ?? ""
        },
        body: invalidUploadForm
      });

      expect(invalidUpload.status).toBe(400);
      expect(await invalidUpload.json()).toEqual({
        error: {
          code: "invalid_content_type",
          message: "Invalid file type detected. File does not match its extension."
        }
      });
      expect(state.petFiles).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("exposes authenticated portal and admin client profile routes", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [
        {
          actorId: "admin-1",
          username: "accountant",
          displayName: "Accountant User",
          passwordHash: "admin-hash",
          role: "accountant",
          active: true
        }
      ],
      portalUsers: [
        {
          clientId: "client-admin-1",
          email: "owner@example.com",
          displayName: "Owner Client",
          passwordHash: "client-hash",
          archived: false
        }
      ],
      passwordVerifier: async (password, hash) => (
        (password === "correct-password" && hash === "admin-hash")
        || (password === "client-password" && hash === "client-hash")
      )
    });

    const savedSessions = new Map<string, string>();
    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore: {
        save: async (sessionId: string, sessionData: string) => {
          savedSessions.set(sessionId, sessionData);
        },
        load: async (sessionId: string) => savedSessions.get(sessionId) ?? null,
        delete: async (sessionId: string) => {
          savedSessions.delete(sessionId);
        }
      }
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const portalLogin = await fetch(`${baseUrl}/api/portal/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email: "owner@example.com",
          password: "client-password",
          returnTo: null
        })
      });
      const portalCookie = portalLogin.headers.get("set-cookie");
      expect(portalCookie).toContain("bdta_session=");

      const adminLogin = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          username: "accountant",
          password: "correct-password"
        })
      });
      const adminCookie = adminLogin.headers.get("set-cookie");
      expect(adminCookie).toContain("bdta_session=");

      const portalProfile = await fetch(`${baseUrl}/api/portal/profile`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const adminClientProfile = await fetch(`${baseUrl}/api/admin/clients/client-admin-1/profile`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });

      expect(portalProfile.status).toBe(200);
      expect(adminClientProfile.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("accepts IMAP callbacks and queues email receiver work", async () => {
    const state = createInMemoryPlatformState();
    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore: null
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/callbacks/imap`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          messageId: "imap-message-1",
          from: "owner@example.com",
          subject: "Question about invoice 42"
        })
      });

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        accepted: true,
        provider: "imap",
        callbackId: expect.stringMatching(/^callback-/),
        queuedJobId: expect.stringMatching(/^job-/)
      });
      expect(state.queuedJobs).toEqual([{
        jobId: expect.stringMatching(/^job-/),
        kind: "email_receiver",
        scheduledFor: "2026-05-27T18:00:00.000Z",
        payload: {
          callbackId: expect.stringMatching(/^callback-/),
          provider: "imap",
          messageId: "imap-message-1",
          from: "owner@example.com",
          subject: "Question about invoice 42",
          receivedAt: "2026-05-27T18:00:00.000Z"
        }
      }]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("accepts mail provider callbacks and queues email receiver work", async () => {
    const state = createInMemoryPlatformState();
    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore: null
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/callbacks/mail_provider`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          mailbox: "support",
          messageId: "provider-message-1",
          from: "client@example.com",
          subject: "Reply to contract reminder"
        })
      });

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        accepted: true,
        provider: "mail_provider",
        callbackId: expect.stringMatching(/^callback-/),
        queuedJobId: expect.stringMatching(/^job-/)
      });
      expect(state.queuedJobs).toEqual([{
        jobId: expect.stringMatching(/^job-/),
        kind: "email_receiver",
        scheduledFor: "2026-05-27T18:00:00.000Z",
        payload: {
          callbackId: expect.stringMatching(/^callback-/),
          provider: "mail_provider",
          mailbox: "support",
          messageId: "provider-message-1",
          from: "client@example.com",
          subject: "Reply to contract reminder",
          receivedAt: "2026-05-27T18:00:00.000Z"
        }
      }]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("accepts stripe callbacks and applies invoice payment updates", async () => {
    const state = createInMemoryPlatformState({
      invoices: [{
        id: "invoice-1",
        clientId: "client-1",
        status: "sent",
        totalAmount: 225,
        outstandingAmount: 125,
        dueAt: "2026-06-05T00:00:00.000Z"
      }]
    });
    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore: null
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/callbacks/stripe`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          invoiceId: "invoice-1",
          paymentStatus: "paid",
          outstandingAmount: 0
        })
      });

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        accepted: true,
        provider: "stripe",
        callbackId: expect.stringMatching(/^callback-/),
        queuedJobId: null
      });
      expect(state.invoices[0]).toEqual({
        id: "invoice-1",
        clientId: "client-1",
        status: "paid",
        totalAmount: 225,
        outstandingAmount: 0,
        dueAt: "2026-06-05T00:00:00.000Z"
      });
      expect(state.queuedJobs).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("accepts signed raw Stripe checkout webhooks and applies invoice payment updates", async () => {
    const state = createInMemoryPlatformState({
      settings: [{
        id: "setting-stripe-webhook",
        key: "stripe_webhook_secret",
        value: "whsec_test_callback_secret",
        type: "password",
        category: "payments",
        label: "Stripe Webhook Secret",
        description: "Webhook signing secret.",
        secret: true,
        updatedAt: "2026-05-27T18:00:00.000Z"
      }],
      invoices: [{
        id: "invoice-1",
        clientId: "client-1",
        status: "sent",
        totalAmount: 225,
        outstandingAmount: 125,
        dueAt: "2026-06-05T00:00:00.000Z"
      }]
    });
    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore: null
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const rawBody = JSON.stringify({
      id: "evt_test_checkout_paid",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_invoice_paid",
          object: "checkout.session",
          payment_status: "paid",
          metadata: {
            invoice_id: "invoice-1"
          }
        }
      }
    });
    const timestamp = String(Math.floor(Date.parse("2026-05-27T18:00:00.000Z") / 1000));
    const signature = createHmac("sha256", "whsec_test_callback_secret")
      .update(`${timestamp}.${rawBody}`, "utf8")
      .digest("hex");

    try {
      const response = await fetch(`${baseUrl}/api/callbacks/stripe`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": `t=${timestamp},v1=${signature}`
        },
        body: rawBody
      });

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        accepted: true,
        provider: "stripe",
        callbackId: expect.stringMatching(/^callback-/),
        queuedJobId: null
      });
      expect(state.invoices[0]).toEqual({
        id: "invoice-1",
        clientId: "client-1",
        status: "paid",
        totalAmount: 225,
        outstandingAmount: 0,
        dueAt: "2026-06-05T00:00:00.000Z"
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("accepts google calendar callbacks and updates calendar sync state", async () => {
    const state = createInMemoryPlatformState();
    state.calendarSyncs.push({
      bookingId: "booking-sync-1",
      provider: "google_calendar",
      externalEventId: "google-calendar-booking-sync-1-2026-05-27",
      externalEventUrl: "https://calendar.google.com/calendar/render?action=TEMPLATE",
      syncedAt: "2026-05-27T18:00:00.000Z"
    });

    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore: null
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/callbacks/google_calendar`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          bookingId: "booking-sync-1",
          externalEventId: "google-event-1",
          externalEventUrl: "https://calendar.google.com/calendar/event?eid=google-event-1"
        })
      });

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        accepted: true,
        provider: "google_calendar",
        callbackId: expect.stringMatching(/^callback-/),
        queuedJobId: null
      });
      expect(state.calendarSyncs).toEqual([{
        bookingId: "booking-sync-1",
        provider: "google_calendar",
        externalEventId: "google-event-1",
        externalEventUrl: "https://calendar.google.com/calendar/event?eid=google-event-1",
        syncedAt: "2026-05-27T18:00:00.000Z"
      }]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("supports authenticated admin content api routes for blog posts", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [{
        actorId: "admin-1",
        username: "owner",
        displayName: "Owner Admin",
        passwordHash: "admin-hash",
        role: "owner",
        active: true
      }],
      blogPosts: [{
        id: "blog-1",
        title: "Loose Leash Training Tips",
        slug: "loose-leash-training-tips",
        content: "<p>Walks start before the leash clips on.</p>",
        excerpt: "Walks start before the leash clips on.",
        coverPhoto: "/backend/uploads/blog/loose-leash.jpg",
        author: "Brook",
        published: true,
        publishDate: "2026-05-28T15:00:00.000Z",
        createdAt: "2026-05-20T10:00:00.000Z",
        updatedAt: "2026-05-28T15:00:00.000Z"
      }],
      passwordVerifier: async (password, hash) => password === "correct-password" && hash === "admin-hash"
    });

    const sessionStore = createInMemorySessionStore(state);
    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          username: "owner",
          password: "correct-password"
        })
      });

      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie");

      const blogPosts = await fetch(`${baseUrl}/api/admin/blog-posts`, {
        headers: { cookie: cookie ?? "" }
      });
      const blogPostDetail = await fetch(`${baseUrl}/api/admin/blog-posts/blog-1`, {
        headers: { cookie: cookie ?? "" }
      });
      const createBlogPost = await fetch(`${baseUrl}/api/admin/blog-posts`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: "Reactive Dog Journal",
          slug: "reactive-dog-journal",
          content: "<p>Pattern work for calmer walks.</p>",
          excerpt: "Pattern work for calmer walks.",
          coverPhoto: null,
          author: "Brook",
          published: true,
          publishDate: "2026-05-30T10:00:00.000Z"
        })
      });
      const updateBlogPost = await fetch(`${baseUrl}/api/admin/blog-posts/blog-1`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: "Loose Leash Training Tips Updated",
          slug: "loose-leash-training-tips",
          content: "<p>Updated content.</p>",
          excerpt: "Updated excerpt.",
          coverPhoto: "/backend/uploads/blog/loose-leash-updated.jpg",
          author: "Brook",
          published: true,
          publishDate: "2026-05-29T12:00:00.000Z"
        })
      });
      expect(createBlogPost.status).toBe(201);
      const createdBlogPostId = state.blogPosts.find((item) => item.slug === "reactive-dog-journal")?.id;
      expect(createdBlogPostId).toBeDefined();
      const deleteBlogPost = await fetch(`${baseUrl}/api/admin/blog-posts/${encodeURIComponent(String(createdBlogPostId ?? ""))}/delete`, {
        method: "POST",
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(blogPosts.status).toBe(200);
      expect(blogPostDetail.status).toBe(200);
      expect(updateBlogPost.status).toBe(200);
      expect(deleteBlogPost.status).toBe(200);
      expect(state.blogPosts.some((item) => item.id === createdBlogPostId)).toBe(false);
      expect(state.blogPosts.find((item) => item.id === "blog-1")?.title).toBe("Loose Leash Training Tips Updated");
      expect(await blogPosts.json()).toEqual({
        items: [
          expect.objectContaining({
            id: "blog-1",
            slug: "loose-leash-training-tips"
          })
        ]
      });
      expect(await blogPostDetail.json()).toEqual({
        item: expect.objectContaining({
          id: "blog-1",
          title: "Loose Leash Training Tips"
        })
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("serves admin workflow management endpoints through the authenticated API", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [{
        actorId: "admin-1",
        username: "accountant",
        displayName: "Accountant User",
        passwordHash: "admin-hash",
        role: "accountant",
        active: true
      }],
      portalUsers: [
        {
          clientId: "client-1",
          email: "client@example.com",
          displayName: "Client One",
          passwordHash: "client-hash",
          archived: false
        },
        {
          clientId: "client-2",
          email: "client-two@example.com",
          displayName: "Client Two",
          passwordHash: "client-two-hash",
          archived: false
        }
      ],
      workflows: [{
        id: "workflow-1",
        name: "Welcome Series",
        description: "New client onboarding workflow.",
        trigger: "manual",
        active: true,
        createdAt: "2026-05-27T18:00:00.000Z"
      }],
      workflowTriggers: [{
        id: "workflow-trigger-1",
        workflowId: "workflow-1",
        triggerType: "appointment_booking",
        appointmentTypeId: "appointment-type-1",
        formTemplateId: null,
        active: true,
        createdAt: "2026-05-27T18:00:00.000Z"
      }],
      workflowEnrollments: [{
        id: "workflow-enrollment-1",
        workflowId: "workflow-1",
        clientId: "client-1",
        status: "active",
        enrolledAt: "2026-05-27T18:00:00.000Z",
        nextRunAt: "2026-05-27T18:00:00.000Z",
        completedAt: null,
        enrolledByAdminUserId: "admin-1"
      }],
      workflowSteps: [{
        id: "workflow-step-1",
        workflowId: "workflow-1",
        stepOrder: 1,
        stepName: "Welcome Email",
        emailSubject: "Welcome {client_name}",
        emailBodyHtml: "<p>Hello {client_name}</p>",
        emailBodyText: "Hello {client_name}",
        delayType: "after_enrollment",
        delayValue: "2 hours",
        scheduledDate: null,
        attachContractId: null,
        attachFormId: null,
        attachQuoteId: null,
        attachInvoiceId: null,
        includeAppointmentLink: false,
        appointmentTypeId: null,
        createdAt: "2026-05-27T18:00:00.000Z",
        updatedAt: "2026-05-27T18:00:00.000Z"
      }],
      workflowStepExecutions: [],
      emailTemplates: [{
        id: "email-template-1",
        name: "Workflow Welcome Template",
        subject: "Template Subject",
        bodyHtml: "<p>Template Html</p>",
        bodyText: "Template Text",
        active: true
      }],
      formTemplates: [{
        id: "form-template-1",
        name: "Client Intake",
        active: true,
        description: "",
        fields: [],
        formType: "booking_form",
        requiredFrequency: null,
        appointmentTypeId: null,
        templateIsInternal: false,
        templateShowInClientPortal: true
      }],
      appointmentTypes: [{
        id: "appointment-type-1",
        name: "Consultation",
        active: true
      }],
      scheduledTasks: [{
        id: "scheduled-task-1",
        taskType: "workflow_processor",
        active: true,
        scheduleType: "hourly",
        scheduleValue: ""
      }],
      passwordVerifier: async (password, hash) => password === "correct-password" && hash === "admin-hash"
    });

    const sessionStore = createInMemorySessionStore(state);
    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          username: "accountant",
          password: "correct-password"
        })
      });

      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie");
      expect(cookie).toContain("bdta_session=");

      const workflows = await fetch(`${baseUrl}/api/admin/workflows`, {
        headers: { cookie: cookie ?? "" }
      });
      const workflowDetail = await fetch(`${baseUrl}/api/admin/workflows/workflow-1`, {
        headers: { cookie: cookie ?? "" }
      });
      const workflowTriggers = await fetch(`${baseUrl}/api/admin/workflows/workflow-1/triggers`, {
        headers: { cookie: cookie ?? "" }
      });
      const workflowEnrollments = await fetch(`${baseUrl}/api/admin/workflows/workflow-1/enrollments`, {
        headers: { cookie: cookie ?? "" }
      });
      const workflowEnroll = await fetch(`${baseUrl}/api/admin/workflows/workflow-1/enroll`, {
        headers: { cookie: cookie ?? "" }
      });
      const workflowSteps = await fetch(`${baseUrl}/api/admin/workflows/workflow-1/steps`, {
        headers: { cookie: cookie ?? "" }
      });
      const workflowStepCreate = await fetch(`${baseUrl}/api/admin/workflows/workflow-1/steps/new`, {
        headers: { cookie: cookie ?? "" }
      });
      const workflowStepDetail = await fetch(`${baseUrl}/api/admin/workflows/workflow-1/steps/workflow-step-1`, {
        headers: { cookie: cookie ?? "" }
      });

      expect(workflows.status).toBe(200);
      expect(workflowDetail.status).toBe(200);
      expect(workflowTriggers.status).toBe(200);
      expect(workflowEnrollments.status).toBe(200);
      expect(workflowEnroll.status).toBe(200);
      expect(workflowSteps.status).toBe(200);
      expect(workflowStepCreate.status).toBe(200);
      expect(workflowStepDetail.status).toBe(200);

      expect(await workflows.json()).toEqual({
        items: [
          expect.objectContaining({
            id: "workflow-1",
            name: "Welcome Series"
          })
        ]
      });
      expect(await workflowDetail.json()).toEqual({
        item: expect.objectContaining({
          id: "workflow-1",
          name: "Welcome Series"
        })
      });
      expect(await workflowTriggers.json()).toEqual(expect.objectContaining({
        workflow: expect.objectContaining({ id: "workflow-1" }),
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "workflow-trigger-1",
            triggerType: "appointment_booking",
            appointmentTypeId: "appointment-type-1"
          })
        ]),
        options: expect.objectContaining({
          appointmentTypes: expect.any(Array),
          formTemplates: expect.any(Array)
        })
      }));
      expect(await workflowEnrollments.json()).toEqual(expect.objectContaining({
        workflow: expect.objectContaining({ id: "workflow-1" }),
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "workflow-enrollment-1",
            clientId: "client-1"
          })
        ])
      }));
      expect(await workflowEnroll.json()).toEqual(expect.objectContaining({
        workflow: expect.objectContaining({ id: "workflow-1" }),
        items: expect.any(Array)
      }));
      expect(await workflowSteps.json()).toEqual(expect.objectContaining({
        workflow: expect.objectContaining({ id: "workflow-1" }),
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "workflow-step-1",
            stepName: "Welcome Email"
          })
        ])
      }));
      expect(await workflowStepCreate.json()).toEqual(expect.objectContaining({
        workflow: expect.objectContaining({ id: "workflow-1" }),
        item: null,
        options: expect.objectContaining({
          appointmentTypes: expect.any(Array),
          emailTemplates: expect.any(Array)
        })
      }));
      expect(await workflowStepDetail.json()).toEqual(expect.objectContaining({
        workflow: expect.objectContaining({ id: "workflow-1" }),
        item: expect.objectContaining({
          id: "workflow-step-1",
          stepName: "Welcome Email"
        })
      }));

      const createWorkflow = await fetch(`${baseUrl}/api/admin/workflows`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Invoice Follow-up",
          description: "Overdue invoice reminder workflow.",
          trigger: "invoice_overdue",
          active: true
        })
      });
      expect(createWorkflow.status).toBe(201);
      const createdWorkflowId = state.workflows.find((workflow) => workflow.id !== "workflow-1")?.id;
      expect(createdWorkflowId).toBeDefined();

      const updateWorkflow = await fetch(`${baseUrl}/api/admin/workflows/workflow-1`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Welcome Series Revised",
          description: "Updated onboarding flow.",
          trigger: "scheduled",
          active: false
        })
      });
      expect(updateWorkflow.status).toBe(200);
      expect(state.workflows.find((workflow) => workflow.id === "workflow-1")?.name).toBe("Welcome Series Revised");

      const createWorkflowTrigger = await fetch(`${baseUrl}/api/admin/workflows/workflow-1/triggers`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          triggerType: "form_submission",
          appointmentTypeId: null,
          formTemplateId: "form-template-1",
          active: true
        })
      });
      expect(createWorkflowTrigger.status).toBe(201);
      const createdWorkflowTriggerId = state.workflowTriggers.find((trigger) => trigger.id !== "workflow-trigger-1")?.id;
      expect(createdWorkflowTriggerId).toBeDefined();

      const createWorkflowStep = await fetch(`${baseUrl}/api/admin/workflows/workflow-1/steps`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          stepName: "Preparation Reminder",
          emailSubject: "Prep for {workflow_name}",
          emailBodyHtml: "<p>Bring your leash.</p>",
          emailBodyText: "Bring your leash.",
          delayType: "after_previous",
          delayValue: "1 day",
          scheduledDate: null,
          attachContractId: null,
          attachFormId: null,
          attachQuoteId: null,
          attachInvoiceId: null,
          includeAppointmentLink: true,
          appointmentTypeId: "appointment-type-1"
        })
      });
      expect(createWorkflowStep.status).toBe(201);
      const createdWorkflowStepId = state.workflowSteps.find((step) => step.id !== "workflow-step-1")?.id;
      expect(createdWorkflowStepId).toBeDefined();

      const updateWorkflowStep = await fetch(`${baseUrl}/api/admin/workflows/workflow-1/steps/workflow-step-1`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          stepName: "Welcome Email Revised",
          emailSubject: "Updated welcome for {client_name}",
          emailBodyHtml: "<p>Updated body</p>",
          emailBodyText: "Updated body",
          delayType: "after_enrollment",
          delayValue: "3 hours",
          scheduledDate: null,
          attachContractId: null,
          attachFormId: null,
          attachQuoteId: null,
          attachInvoiceId: null,
          includeAppointmentLink: false,
          appointmentTypeId: null
        })
      });
      expect(updateWorkflowStep.status).toBe(200);
      expect(state.workflowSteps.find((step) => step.id === "workflow-step-1")?.stepName).toBe("Welcome Email Revised");

      const enrollClient = await fetch(`${baseUrl}/api/admin/workflows/workflow-1/enroll`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          clientIds: ["client-2"]
        })
      });
      expect(enrollClient.status).toBe(200);
      expect(state.workflowEnrollments.some((enrollment) => enrollment.clientId === "client-2")).toBe(true);
      expect(state.workflowStepExecutions.some((execution) => execution.enrollmentId != null)).toBe(true);

      const cancelEnrollment = await fetch(`${baseUrl}/api/admin/workflows/workflow-1/enrollments/workflow-enrollment-1/cancel`, {
        method: "POST",
        headers: {
          cookie: cookie ?? ""
        }
      });
      expect(cancelEnrollment.status).toBe(200);
      expect(state.workflowEnrollments.find((enrollment) => enrollment.id === "workflow-enrollment-1")?.status).toBe("cancelled");

      const deleteWorkflowStep = await fetch(`${baseUrl}/api/admin/workflows/workflow-1/steps/${encodeURIComponent(String(createdWorkflowStepId ?? ""))}/delete`, {
        method: "POST",
        headers: {
          cookie: cookie ?? ""
        }
      });
      expect(deleteWorkflowStep.status).toBe(200);
      expect(state.workflowSteps.some((step) => step.id === createdWorkflowStepId)).toBe(false);

      const deleteWorkflowTrigger = await fetch(`${baseUrl}/api/admin/workflows/workflow-1/triggers/${encodeURIComponent(String(createdWorkflowTriggerId ?? ""))}/delete`, {
        method: "POST",
        headers: {
          cookie: cookie ?? ""
        }
      });
      expect(deleteWorkflowTrigger.status).toBe(200);
      expect(state.workflowTriggers.some((trigger) => trigger.id === createdWorkflowTriggerId)).toBe(false);

      const deleteWorkflow = await fetch(`${baseUrl}/api/admin/workflows/${encodeURIComponent(String(createdWorkflowId ?? ""))}/delete`, {
        method: "POST",
        headers: {
          cookie: cookie ?? ""
        }
      });
      expect(deleteWorkflow.status).toBe(200);
      expect(state.workflows.some((workflow) => workflow.id === createdWorkflowId)).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("supports authenticated admin configuration api routes for appointment types, form templates, email templates, and scheduled tasks", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [{
        actorId: "admin-1",
        username: "owner",
        displayName: "Owner Admin",
        passwordHash: "admin-hash",
        role: "owner",
        active: true
      }],
      appointmentTypes: [{
        id: "appointment-type-1",
        name: "Private Coaching",
        description: "One-on-one coaching session.",
        bulletPoints: ["Behavior assessment", "Homework plan"],
        adminUserId: "admin-1",
        durationMinutes: 90,
        bufferBeforeMinutes: 15,
        bufferAfterMinutes: 15,
        useTravelTimeBuffer: true,
        travelTimeMinutes: 20,
        advanceBookingMinDays: 2,
        advanceBookingMaxDays: 45,
        cancellationNoticeHours: 24,
        requiresForms: true,
        formTemplateIds: ["form-template-1"],
        requiresContract: true,
        contractTemplateId: "contract-template-1",
        autoInvoice: true,
        invoiceDueDays: 7,
        invoiceDueTiming: "after",
        defaultAmount: 225,
        consumesCredits: true,
        creditCount: 2,
        isGroupClass: false,
        maxParticipants: 1,
        publicAvailable: true,
        portalAvailable: true,
        scheduleType: "recurring",
        specificDate: null,
        specificDates: [],
        availableDays: [1, 2, 3, 4, 5],
        availableStartTime: "09:00",
        availableEndTime: "17:00",
        timeSlotInterval: 30,
        perDaySchedule: {},
        isMiniSession: false,
        miniSessionLocation: "",
        miniSessionTopic: "",
        isFieldRental: false,
        fieldRentalLocation: "",
        groupClassLocation: "",
        locationTypes: ["client_address"],
        confirmationTemplateId: "email-template-1",
        bookingRequestTemplateId: null,
        invoiceTemplateId: null,
        reminderTemplateId: null,
        cancellationTemplateId: null,
        requiresAdminConfirmation: true,
        usesResource: true,
        resourceName: "Trainer Vehicle",
        resourceCapacity: 1,
        resourceAllocation: "per_appointment",
        uniqueLink: "private-coaching-link",
        active: true
      }] as never,
      formTemplates: [{
        id: "form-template-1",
        name: "Boarding Intake",
        active: true,
        description: "Collect intake details before boarding.",
        fields: [{ label: "Pet Name", type: "text", required: true }],
        formType: "client_form",
        requiredFrequency: "once",
        appointmentTypeId: "appointment-type-1",
        templateIsInternal: false,
        templateShowInClientPortal: true
      }] as never,
      emailTemplates: [{
        id: "email-template-1",
        name: "Booking Confirmation",
        templateType: "booking_confirmation",
        subject: "Your booking is confirmed",
        bodyHtml: "<p>Confirmed.</p>",
        bodyText: "Confirmed.",
        active: true
      }] as never,
      scheduledTasks: [{
        id: "scheduled-task-1",
        name: "Workflow Processor",
        taskType: "workflow_processor",
        active: true,
        scheduleType: "interval",
        scheduleValue: "60",
        lastRunAt: "2026-05-27T17:00:00.000Z",
        nextRunAt: "2026-05-27T18:00:00.000Z"
      }] as never,
      passwordVerifier: async (password, hash) => password === "correct-password" && hash === "admin-hash"
    });

    const sessionStore = createInMemorySessionStore(state);
    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          username: "owner",
          password: "correct-password"
        })
      });

      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie");

      const appointmentTypes = await fetch(`${baseUrl}/api/admin/appointment-types`, {
        headers: { cookie: cookie ?? "" }
      });
      const appointmentTypeDetail = await fetch(`${baseUrl}/api/admin/appointment-types/appointment-type-1`, {
        headers: { cookie: cookie ?? "" }
      });
      const createAppointmentType = await fetch(`${baseUrl}/api/admin/appointment-types`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Mini Session Saturday",
          description: "Short-format mini session.",
          bulletPoints: ["Outdoor setup"],
          adminUserId: "admin-1",
          durationMinutes: 45,
          bufferBeforeMinutes: 10,
          bufferAfterMinutes: 10,
          useTravelTimeBuffer: false,
          travelTimeMinutes: 0,
          advanceBookingMinDays: 1,
          advanceBookingMaxDays: 14,
          cancellationNoticeHours: 12,
          requiresForms: true,
          formTemplateIds: ["form-template-1"],
          requiresContract: false,
          contractTemplateId: null,
          autoInvoice: true,
          invoiceDueDays: 3,
          invoiceDueTiming: "before",
          defaultAmount: 95,
          consumesCredits: false,
          creditCount: 1,
          isGroupClass: false,
          maxParticipants: 1,
          publicAvailable: false,
          portalAvailable: true,
          scheduleType: "specific_date",
          specificDate: "2026-06-21",
          specificDates: [{
            date: "2026-06-21",
            timeslots: [{ type: "point", time: "10:00" }]
          }],
          availableDays: [0],
          availableStartTime: "10:00",
          availableEndTime: "14:00",
          timeSlotInterval: 30,
          perDaySchedule: {},
          isMiniSession: true,
          miniSessionLocation: "Downtown Park",
          miniSessionTopic: "Recall refresh",
          isFieldRental: false,
          fieldRentalLocation: "",
          groupClassLocation: "",
          locationTypes: [],
          confirmationTemplateId: "email-template-1",
          bookingRequestTemplateId: null,
          invoiceTemplateId: null,
          reminderTemplateId: null,
          cancellationTemplateId: null,
          requiresAdminConfirmation: true,
          usesResource: false,
          resourceName: "",
          resourceCapacity: 1,
          resourceAllocation: "per_appointment",
          uniqueLink: "mini-session-june-21",
          active: true
        })
      });
      const updateAppointmentType = await fetch(`${baseUrl}/api/admin/appointment-types/appointment-type-1`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Private Coaching Updated",
          description: "Updated coaching session.",
          bulletPoints: ["Updated assessment"],
          adminUserId: "admin-1",
          durationMinutes: 60,
          bufferBeforeMinutes: 5,
          bufferAfterMinutes: 5,
          useTravelTimeBuffer: false,
          travelTimeMinutes: 0,
          advanceBookingMinDays: 1,
          advanceBookingMaxDays: 30,
          cancellationNoticeHours: 12,
          requiresForms: false,
          formTemplateIds: [],
          requiresContract: false,
          contractTemplateId: null,
          autoInvoice: false,
          invoiceDueDays: 7,
          invoiceDueTiming: "after",
          defaultAmount: 175,
          consumesCredits: false,
          creditCount: 1,
          isGroupClass: false,
          maxParticipants: 1,
          publicAvailable: true,
          portalAvailable: true,
          scheduleType: "recurring",
          specificDate: null,
          specificDates: [],
          availableDays: [1, 2, 3],
          availableStartTime: "08:00",
          availableEndTime: "12:00",
          timeSlotInterval: 30,
          perDaySchedule: {},
          isMiniSession: false,
          miniSessionLocation: "",
          miniSessionTopic: "",
          isFieldRental: false,
          fieldRentalLocation: "",
          groupClassLocation: "",
          locationTypes: ["client_address"],
          confirmationTemplateId: "email-template-1",
          bookingRequestTemplateId: null,
          invoiceTemplateId: null,
          reminderTemplateId: null,
          cancellationTemplateId: null,
          requiresAdminConfirmation: false,
          usesResource: false,
          resourceName: "",
          resourceCapacity: 1,
          resourceAllocation: "per_appointment",
          uniqueLink: "private-coaching-updated",
          active: true
        })
      });
      expect(createAppointmentType.status).toBe(201);
      const createdAppointmentTypeId = state.appointmentTypes.find((item) => item.uniqueLink === "mini-session-june-21")?.id;
      expect(createdAppointmentTypeId).toBeDefined();
      const deleteAppointmentType = await fetch(`${baseUrl}/api/admin/appointment-types/${encodeURIComponent(String(createdAppointmentTypeId ?? ""))}/delete`, {
        method: "POST",
        headers: {
          cookie: cookie ?? ""
        }
      });
      const formTemplates = await fetch(`${baseUrl}/api/admin/form-templates`, {
        headers: { cookie: cookie ?? "" }
      });
      const formTemplateDetail = await fetch(`${baseUrl}/api/admin/form-templates/form-template-1`, {
        headers: { cookie: cookie ?? "" }
      });
      const createFormTemplate = await fetch(`${baseUrl}/api/admin/form-templates`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Follow-Up Survey",
          active: true,
          description: "Collect post-program feedback.",
          fields: [{ label: "How did training go?", type: "textarea", required: true }],
          formType: "survey_form",
          requiredFrequency: "yearly",
          appointmentTypeId: null,
          templateIsInternal: false,
          templateShowInClientPortal: true
        })
      });
      const updateFormTemplate = await fetch(`${baseUrl}/api/admin/form-templates/form-template-1`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Boarding Intake Updated",
          active: false,
          description: "Updated boarding intake workflow.",
          fields: [{ label: "Pet Name", type: "text", required: true }, { label: "Medication Notes", type: "textarea" }],
          formType: "client_form",
          requiredFrequency: "once_per_pet",
          appointmentTypeId: "appointment-type-1",
          templateIsInternal: true,
          templateShowInClientPortal: false
        })
      });
      expect(createFormTemplate.status).toBe(201);
      const createdFormTemplateId = state.formTemplates.find((item) => item.name === "Follow-Up Survey")?.id;
      expect(createdFormTemplateId).toBeDefined();
      const deleteFormTemplate = await fetch(`${baseUrl}/api/admin/form-templates/${encodeURIComponent(String(createdFormTemplateId ?? ""))}/delete`, {
        method: "POST",
        headers: {
          cookie: cookie ?? ""
        }
      });
      const emailTemplates = await fetch(`${baseUrl}/api/admin/email-templates`, {
        headers: { cookie: cookie ?? "" }
      });
      const emailTemplateDetail = await fetch(`${baseUrl}/api/admin/email-templates/email-template-1`, {
        headers: { cookie: cookie ?? "" }
      });
      const createEmailTemplate = await fetch(`${baseUrl}/api/admin/email-templates`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Booking Reminder",
          templateType: "booking_reminder",
          subject: "Reminder",
          bodyHtml: "<p>Reminder.</p>",
          bodyText: "Reminder.",
          active: true
        })
      });
      const updateEmailTemplate = await fetch(`${baseUrl}/api/admin/email-templates/email-template-1`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Booking Confirmation Updated",
          templateType: "booking_confirmation",
          subject: "Updated",
          bodyHtml: "<p>Updated.</p>",
          bodyText: "Updated.",
          active: false
        })
      });
      const scheduledTasks = await fetch(`${baseUrl}/api/admin/scheduled-tasks`, {
        headers: { cookie: cookie ?? "" }
      });
      const scheduledTaskDetail = await fetch(`${baseUrl}/api/admin/scheduled-tasks/scheduled-task-1`, {
        headers: { cookie: cookie ?? "" }
      });
      const createScheduledTask = await fetch(`${baseUrl}/api/admin/scheduled-tasks`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Inbox Poller",
          taskType: "email_receiver",
          scheduleType: "custom",
          scheduleValue: "*/5 * * * *",
          active: true
        })
      });
      const updateScheduledTask = await fetch(`${baseUrl}/api/admin/scheduled-tasks/scheduled-task-1`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Workflow Processor Revised",
          taskType: "workflow_processor",
          scheduleType: "interval",
          scheduleValue: "30",
          active: true
        })
      });

      expect(appointmentTypes.status).toBe(200);
      expect(appointmentTypeDetail.status).toBe(200);
      expect(updateAppointmentType.status).toBe(200);
      expect(deleteAppointmentType.status).toBe(200);
      expect(state.appointmentTypes.some((item) => item.id === createdAppointmentTypeId)).toBe(false);
      expect(formTemplates.status).toBe(200);
      expect(formTemplateDetail.status).toBe(200);
      expect(updateFormTemplate.status).toBe(200);
      expect(deleteFormTemplate.status).toBe(200);
      expect(state.formTemplates.some((item) => item.id === createdFormTemplateId)).toBe(false);
      expect(emailTemplates.status).toBe(200);
      expect(emailTemplateDetail.status).toBe(200);
      expect(createEmailTemplate.status).toBe(201);
      expect(updateEmailTemplate.status).toBe(200);
      expect(scheduledTasks.status).toBe(200);
      expect(scheduledTaskDetail.status).toBe(200);
      expect(createScheduledTask.status).toBe(201);
      expect(updateScheduledTask.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("syncs an admin booking to google calendar through the authenticated api", async () => {
    const state = createInMemoryPlatformState({
      bookings: [{
        id: "booking-sync-1",
        clientId: "client-sync-1",
        petIds: [],
        serviceId: "svc-private-lesson",
        startsAt: "2026-06-10T16:00:00.000Z",
        endsAt: "2026-06-10T17:00:00.000Z",
        status: "confirmed",
        icalAccess: {
          token: "ical-sync-token-123456",
          issuedAt: "2026-05-27T18:00:00.000Z",
          expiresAt: null,
          legacySourceId: "booking-sync-1"
        }
      }],
      adminUsers: [{
        actorId: "admin-1",
        username: "accountant",
        displayName: "Accountant User",
        passwordHash: "admin-hash",
        role: "accountant",
        active: true
      }],
      passwordVerifier: async (password, hash) => password === "correct-password" && hash === "admin-hash"
    });

    const sessionStore = createInMemorySessionStore(state);
    const server = createHttpApiServer({
      dependencies: createInMemoryApiDependencies(state),
      sessionStore
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          username: "accountant",
          password: "correct-password"
        })
      });

      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie");
      expect(cookie).toContain("bdta_session=");

      const sync = await fetch(`${baseUrl}/api/admin/bookings/booking-sync-1/calendar-sync`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          provider: "google_calendar"
        })
      });

      expect(sync.status).toBe(200);
      expect(await sync.json()).toEqual({
        booking: {
          id: "booking-sync-1",
          clientId: "client-sync-1",
          petIds: [],
          serviceId: "svc-private-lesson",
          startsAt: "2026-06-10T16:00:00.000Z",
          endsAt: "2026-06-10T17:00:00.000Z",
          status: "confirmed",
          icalAccess: {
            token: "ical-sync-token-123456",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "booking-sync-1"
          }
        },
        provider: "google_calendar",
        externalEventId: expect.stringMatching(/^google-calendar-booking-sync-1/),
        externalEventUrl: expect.stringContaining("calendar.google.com"),
        syncedAt: "2026-05-27T18:00:00.000Z"
      });

      const syncDetail = await fetch(`${baseUrl}/api/admin/bookings/booking-sync-1/calendar-sync`, {
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(syncDetail.status).toBe(200);
      expect(await syncDetail.json()).toEqual({
        booking: {
          id: "booking-sync-1",
          clientId: "client-sync-1",
          petIds: [],
          serviceId: "svc-private-lesson",
          startsAt: "2026-06-10T16:00:00.000Z",
          endsAt: "2026-06-10T17:00:00.000Z",
          status: "confirmed",
          icalAccess: {
            token: "ical-sync-token-123456",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "booking-sync-1"
          }
        },
        provider: "google_calendar",
        externalEventId: expect.stringMatching(/^google-calendar-booking-sync-1/),
        externalEventUrl: expect.stringContaining("calendar.google.com"),
        syncedAt: "2026-05-27T18:00:00.000Z"
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });
});
