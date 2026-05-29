import { buildApiRuntime } from "../apps/api/src/index.js";
import {
  createInMemoryApiDependencies,
  createInMemoryPlatformState
} from "@bdta/infrastructure";

describe("infrastructure adapters", () => {
  it("persists bookings, queued jobs, and emails through in-memory dependencies", async () => {
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

    const runtime = buildApiRuntime(createInMemoryApiDependencies(state));
    const result = await runtime.handlers.handlePublicBooking({
      serviceId: "svc-private-lesson",
      clientEmail: "client@example.com",
      petIds: ["pet-1"],
      requestedStart: "2026-06-01T16:00:00.000Z",
      requestedEnd: "2026-06-01T17:00:00.000Z",
      turnstileToken: "turnstile-ok"
    });

    expect(result.status).toBe(201);
    expect(state.bookings).toHaveLength(1);
    expect(state.queuedEmails).toHaveLength(1);
    expect(state.queuedJobs).toHaveLength(1);
    expect(state.bookings[0]?.icalAccess?.token).toContain("ical-booking-");
  });

  it("records portal login activity and issues a session through infrastructure dependencies", async () => {
    const state = createInMemoryPlatformState({
      portalUsers: [
        {
          clientId: "client-1",
          email: "client@example.com",
          displayName: "Client One",
          passwordHash: "hash-1",
          archived: false
        }
      ],
      passwordVerifier: async (password: string, hash: string) => password === "correct-password" && hash === "hash-1"
    });

    const runtime = buildApiRuntime(createInMemoryApiDependencies(state));
    const result = await runtime.handlers.handlePortalLogin({
      email: "client@example.com",
      password: "correct-password",
      returnTo: null
    });

    expect(result.status).toBe(200);
    expect(state.loginEvents).toEqual(["client-1"]);
  });

  it("persists portal and admin client profile mutations through in-memory dependencies", async () => {
    const state = createInMemoryPlatformState({
      portalUsers: [
        {
          clientId: "client-1",
          email: "client@example.com",
          displayName: "Client One",
          passwordHash: "hash-1",
          phone: "555-0100",
          address: "123 Main St",
          notes: "Existing note",
          isAdmin: false,
          archived: false
        }
      ],
      passwordVerifier: async (password, hash) => password === "correct-password" && hash === "hash-1"
    });

    const runtime = buildApiRuntime(createInMemoryApiDependencies(state));
    const portalSession = {
      actorId: "client-1",
      actorType: "portal_user" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };
    const adminSession = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const updatedPortal = await runtime.handlers.handlePortalProfileUpdate(portalSession, {
      name: "Client One Updated",
      email: "client.updated@example.com",
      phone: "555-0111",
      address: "456 Oak Ave",
      currentPassword: "correct-password",
      newPassword: "new-password",
      confirmPassword: "new-password"
    });
    const createdAdmin = await runtime.handlers.handleAdminClientCreate(adminSession, {
      name: "Client Two",
      email: "client2@example.com",
      phone: "555-0200",
      address: "789 Pine Rd",
      notes: "Created by admin",
      isAdmin: true
    });

    expect(updatedPortal.status).toBe(200);
    expect(createdAdmin.status).toBe(201);
    expect(state.portalUsers[0]).toMatchObject({
      clientId: "client-1",
      displayName: "Client One Updated",
      email: "client.updated@example.com",
      phone: "555-0111",
      address: "456 Oak Ave",
      passwordHash: "new-password"
    });
    expect(state.portalUsers[1]).toMatchObject({
      email: "client2@example.com",
      displayName: "Client Two",
      notes: "Created by admin",
      isAdmin: true
    });
  });

  it("can reject captcha and expose the failure through the API runtime", async () => {
    const state = createInMemoryPlatformState({
      portalUsers: [],
      captchaVerifier: async () => false
    });

    const runtime = buildApiRuntime(createInMemoryApiDependencies(state));
    const result = await runtime.handlers.handlePublicBooking({
      serviceId: "svc-private-lesson",
      clientEmail: "new-client@example.com",
      petIds: ["pet-1"],
      requestedStart: "2026-06-01T16:00:00.000Z",
      requestedEnd: "2026-06-01T17:00:00.000Z",
      turnstileToken: "turnstile-fail"
    });

    expect(result.status).toBe(400);
    if (!("error" in result.body)) {
      throw new Error("Expected captcha failure response.");
    }
    expect(result.body.error.code).toBe("captcha_failed");
  });

  it("applies stripe callback invoice updates through in-memory dependencies", async () => {
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

    const runtime = buildApiRuntime(createInMemoryApiDependencies(state));
    const result = await runtime.handlers.handleIntegrationCallback({
      provider: "stripe",
      receivedAt: "2026-05-27T18:05:00.000Z",
      payload: {
        invoiceId: "invoice-1",
        paymentStatus: "paid",
        outstandingAmount: 0
      }
    });

    expect(result.status).toBe(202);
    expect(state.queuedJobs).toHaveLength(0);
    expect(state.invoices[0]).toEqual({
      id: "invoice-1",
      clientId: "client-1",
      status: "paid",
      totalAmount: 225,
      outstandingAmount: 0,
      dueAt: "2026-06-05T00:00:00.000Z"
    });
    expect(state.integrationCallbacks).toHaveLength(1);
  });

  it("queues mail provider callback work through in-memory dependencies", async () => {
    const state = createInMemoryPlatformState();

    const runtime = buildApiRuntime(createInMemoryApiDependencies(state));
    const result = await runtime.handlers.handleIntegrationCallback({
      provider: "mail_provider",
      receivedAt: "2026-05-27T18:06:00.000Z",
      payload: {
        mailbox: "support",
        messageId: "provider-message-1",
        from: "client@example.com",
        subject: "Reply to contract reminder"
      }
    });

    expect(result.status).toBe(202);
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
        receivedAt: "2026-05-27T18:06:00.000Z"
      }
    }]);
    expect(state.integrationCallbacks).toHaveLength(1);
  });

  it("reads admin job logs and integration callback logs through in-memory dependencies", async () => {
    const state = createInMemoryPlatformState({
      queuedJobs: [{
        jobId: "job-queued-1",
        kind: "workflow_processor",
        scheduledFor: "2026-05-27T17:30:00.000Z",
        payload: {
          limit: 10
        }
      }]
    });
    state.integrationCallbacks.push({
      callbackId: "callback-1",
      provider: "imap",
      receivedAt: "2026-05-27T18:05:00.000Z",
      payload: {
        messageId: "imap-message-1"
      },
      queuedJobId: "job-email-1"
    });

    const runtime = buildApiRuntime(createInMemoryApiDependencies(state));
    const session = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const jobs = await runtime.handlers.handleAdminJobLogs(session);
    const job = await runtime.handlers.handleAdminJobLogDetail(session, "job-queued-1");
    const callbacks = await runtime.handlers.handleAdminIntegrationCallbackLogs(session);
    const callback = await runtime.handlers.handleAdminIntegrationCallbackLogDetail(session, "callback-1");

    expect(jobs.status).toBe(200);
    expect(job.status).toBe(200);
    expect(callbacks.status).toBe(200);
    expect(callback.status).toBe(200);
    if ("error" in jobs.body || "error" in job.body || "error" in callbacks.body || "error" in callback.body) {
      throw new Error("Expected successful admin operations infrastructure responses.");
    }
    expect(jobs.body.items[0]?.jobId).toBe("job-queued-1");
    expect(job.body.item.status).toBe("queued");
    expect(callbacks.body.items[0]?.callbackId).toBe("callback-1");
    expect(callback.body.item.queuedJobId).toBe("job-email-1");
  });

  it("reads portal and admin package-credit resources through in-memory dependencies", async () => {
    const state = createInMemoryPlatformState({
      portalUsers: [{
        clientId: "client-1",
        email: "client@example.com",
        displayName: "Client One",
        passwordHash: "hash-1",
        archived: false
      }],
      packages: [{
        id: "package-1",
        name: "Starter Package",
        active: true,
        price: 325
      }],
      credits: [{
        id: "credit-1",
        clientId: "client-1",
        packageId: "package-1",
        remainingUnits: 4
      }]
    });

    const runtime = buildApiRuntime(createInMemoryApiDependencies(state));
    const portalSession = {
      actorId: "client-1",
      actorType: "portal_user" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };
    const adminSession = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const portalPackages = await runtime.handlers.handlePortalPackages(portalSession);
    const portalCredits = await runtime.handlers.handlePortalCredits(portalSession);
    const adminPackages = await runtime.handlers.handleAdminPackages(adminSession);
    const adminCredits = await runtime.handlers.handleAdminCredits(adminSession);

    expect(portalPackages.status).toBe(200);
    expect(portalCredits.status).toBe(200);
    expect(adminPackages.status).toBe(200);
    expect(adminCredits.status).toBe(200);
    if ("error" in portalPackages.body || "error" in portalCredits.body || "error" in adminPackages.body || "error" in adminCredits.body) {
      throw new Error("Expected successful package and credit infrastructure responses.");
    }
    expect(portalPackages.body.items[0]?.id).toBe("package-1");
    expect(portalCredits.body.items[0]?.remainingUnits).toBe(4);
    expect(adminPackages.body.items[0]?.name).toBe("Starter Package");
    expect(adminCredits.body.items[0]?.packageId).toBe("package-1");
  });

  it("reads portal and admin pet resources through in-memory dependencies", async () => {
    const state = createInMemoryPlatformState({
      pets: [{
        id: "pet-1",
        clientId: "client-1",
        name: "Buddy",
        species: "Dog",
        archived: false
      }]
    });

    const runtime = buildApiRuntime(createInMemoryApiDependencies(state));
    const portalSession = {
      actorId: "client-1",
      actorType: "portal_user" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };
    const adminSession = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const portalPets = await runtime.handlers.handlePortalPets(portalSession);
    const adminPets = await runtime.handlers.handleAdminPets(adminSession);

    expect(portalPets.status).toBe(200);
    expect(adminPets.status).toBe(200);
    if ("error" in portalPets.body || "error" in adminPets.body) {
      throw new Error("Expected successful pet infrastructure responses.");
    }
    expect(portalPets.body.items[0]?.name).toBe("Buddy");
    expect(adminPets.body.items[0]?.clientId).toBe("client-1");
  });

  it("reads and deletes portal and admin pet files through in-memory dependencies", async () => {
    const state = createInMemoryPlatformState({
      pets: [{
        id: "pet-1",
        clientId: "client-1",
        name: "Buddy",
        species: "Dog",
        archived: false
      }],
      petFileContents: {
        "pet-file-1": "vaccination-record-body",
        "pet-file-2": "buddy-headshot-body"
      },
      petFiles: [{
        id: "pet-file-1",
        petId: "pet-1",
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
        petId: "pet-1",
        fileType: "photo",
        fileName: "buddy-headshot.jpg",
        originalName: "Buddy Headshot.jpg",
        fileSize: 98342,
        mimeType: "image/jpeg",
        description: "Front profile",
        uploadedByAdminUserId: "admin-1",
        uploadedAt: "2026-05-25T09:30:00.000Z"
      }]
    });

    const runtime = buildApiRuntime(createInMemoryApiDependencies(state));
    const portalSession = {
      actorId: "client-1",
      actorType: "portal_user" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };
    const adminSession = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const portalFiles = await runtime.handlers.handlePortalPetFiles(portalSession, "pet-1");
    const portalFile = await runtime.handlers.handlePortalPetFileDetail(portalSession, "pet-1", "pet-file-1");
    const adminFiles = await runtime.handlers.handleAdminPetFiles(adminSession, "pet-1");
    const adminDeleted = await runtime.handlers.handleAdminPetFileDelete(adminSession, "pet-1", "pet-file-2");

    expect(portalFiles.status).toBe(200);
    expect(portalFile.status).toBe(200);
    expect(adminFiles.status).toBe(200);
    expect(adminDeleted.status).toBe(200);
    if ("error" in portalFiles.body || "error" in portalFile.body || "error" in adminFiles.body || "error" in adminDeleted.body) {
      throw new Error("Expected successful pet file infrastructure responses.");
    }
    expect(portalFiles.body.items).toHaveLength(2);
    expect(portalFile.body.item.originalName).toBe("Vaccination Record.pdf");
    expect(adminFiles.body.items[1]?.uploadedByAdminUserId).toBe("admin-1");
    expect(state.petFiles.find((file) => file.id === "pet-file-2")).toBeUndefined();
  });

  it("reads portal and admin pet file content through in-memory dependencies", async () => {
    const state = createInMemoryPlatformState({
      pets: [{
        id: "pet-1",
        clientId: "client-1",
        name: "Buddy",
        species: "Dog",
        archived: false
      }],
      petFiles: [{
        id: "pet-file-1",
        petId: "pet-1",
        fileType: "document",
        fileName: "vaccination-record.pdf",
        originalName: "Vaccination Record.pdf",
        fileSize: 120340,
        mimeType: "application/pdf",
        description: "Vaccination record",
        uploadedByAdminUserId: null,
        uploadedAt: "2026-05-26T12:00:00.000Z"
      }],
      petFileContents: {
        "pet-file-1": "vaccination-record-body"
      }
    });

    const runtime = buildApiRuntime(createInMemoryApiDependencies(state));
    const portalSession = {
      actorId: "client-1",
      actorType: "portal_user" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };
    const adminSession = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const portalContent = await runtime.handlers.handlePortalPetFileContent(portalSession, "pet-1", "pet-file-1", false);
    const adminContent = await runtime.handlers.handleAdminPetFileContent(adminSession, "pet-1", "pet-file-1", true);

    expect(portalContent.status).toBe(200);
    expect(adminContent.status).toBe(200);
    if ("error" in portalContent.body || "error" in adminContent.body) {
      throw new Error("Expected successful pet file content infrastructure responses.");
    }
    expect(Buffer.from(portalContent.body.contentBase64, "base64").toString("utf8")).toBe("vaccination-record-body");
    expect(adminContent.body.disposition).toBe("attachment");
  });

  it("persists portal and admin contact mutations through in-memory dependencies", async () => {
    const state = createInMemoryPlatformState({
      contacts: [{
        id: "contact-1",
        clientId: "client-1",
        name: "Primary Contact",
        email: "primary@example.com",
        phone: "555-0100",
        isPrimary: true
      }]
    });

    const runtime = buildApiRuntime(createInMemoryApiDependencies(state));
    const portalSession = {
      actorId: "client-1",
      actorType: "portal_user" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };
    const adminSession = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const created = await runtime.handlers.handlePortalContactCreate(portalSession, {
      name: "Backup Contact",
      email: "backup@example.com",
      phone: "555-0101",
      isPrimary: true
    });
    const adminUpdated = await runtime.handlers.handleAdminClientContactUpdate(adminSession, "client-1", "contact-1", {
      name: "Primary Contact Updated",
      email: "primary@example.com",
      phone: "555-0199",
      isPrimary: false
    });
    const adminDeleted = await runtime.handlers.handleAdminClientContactDelete(adminSession, "client-1", "contact-1");

    expect(created.status).toBe(201);
    expect(adminUpdated.status).toBe(200);
    expect(adminDeleted.status).toBe(200);
    expect(state.contacts.find((contact) => contact.id === "contact-1")).toBeUndefined();
    expect(state.contacts.find((contact) => contact.email === "backup@example.com")).toEqual({
      id: expect.stringMatching(/^contact-/),
      clientId: "client-1",
      name: "Backup Contact",
      email: "backup@example.com",
      phone: "555-0101",
      isPrimary: true
    });
  });

  it("persists calendar sync links through in-memory admin dependencies", async () => {
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
      }]
    });

    const runtime = buildApiRuntime(createInMemoryApiDependencies(state));
    const result = await runtime.handlers.handleAdminBookingCalendarSync({
      actorId: "admin-1",
      actorType: "admin_user",
      role: "accountant",
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    }, "booking-sync-1", {
      provider: "google_calendar"
    });

    expect(result.status).toBe(200);
    expect(state.calendarSyncs).toEqual([{
      bookingId: "booking-sync-1",
      provider: "google_calendar",
      externalEventId: "google-calendar-booking-sync-1-2026-05-27",
      externalEventUrl: expect.stringContaining("calendar.google.com"),
      syncedAt: "2026-05-27T18:00:00.000Z"
    }]);
  });

  it("reads persisted calendar sync links through in-memory admin dependencies", async () => {
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
      }]
    });
    state.calendarSyncs.push({
      bookingId: "booking-sync-1",
      provider: "google_calendar",
      externalEventId: "google-event-1",
      externalEventUrl: "https://calendar.google.com/calendar/event?eid=google-event-1",
      syncedAt: "2026-05-27T18:05:00.000Z"
    });

    const runtime = buildApiRuntime(createInMemoryApiDependencies(state));
    const result = await runtime.handlers.handleAdminBookingCalendarSyncDetail({
      actorId: "admin-1",
      actorType: "admin_user",
      role: "accountant",
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    }, "booking-sync-1");

    expect(result.status).toBe(200);
    if ("error" in result.body) {
      throw new Error("Expected successful admin calendar sync detail response.");
    }
    expect(result.body).toEqual({
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
      externalEventId: "google-event-1",
      externalEventUrl: "https://calendar.google.com/calendar/event?eid=google-event-1",
      syncedAt: "2026-05-27T18:05:00.000Z"
    });
  });

  it("applies google calendar callback updates through in-memory dependencies", async () => {
    const state = createInMemoryPlatformState();
    state.calendarSyncs.push({
      bookingId: "booking-sync-1",
      provider: "google_calendar",
      externalEventId: "google-calendar-booking-sync-1-2026-05-27",
      externalEventUrl: "https://calendar.google.com/calendar/render?action=TEMPLATE",
      syncedAt: "2026-05-27T18:00:00.000Z"
    });

    const runtime = buildApiRuntime(createInMemoryApiDependencies(state));
    const result = await runtime.handlers.handleIntegrationCallback({
      provider: "google_calendar",
      receivedAt: "2026-05-27T18:05:00.000Z",
      payload: {
        bookingId: "booking-sync-1",
        externalEventId: "google-event-1",
        externalEventUrl: "https://calendar.google.com/calendar/event?eid=google-event-1"
      }
    });

    expect(result.status).toBe(202);
    expect(state.calendarSyncs).toEqual([{
      bookingId: "booking-sync-1",
      provider: "google_calendar",
      externalEventId: "google-event-1",
      externalEventUrl: "https://calendar.google.com/calendar/event?eid=google-event-1",
      syncedAt: "2026-05-27T18:05:00.000Z"
    }]);
    expect(state.integrationCallbacks).toHaveLength(1);
  });
});
