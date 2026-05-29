import { buildApiRuntime } from "../apps/api/src/index.js";
import {
  createMySqlApiDependencies,
  createMySqlSessionStore,
  getMySqlBootstrapStatements,
  type SqlExecutor,
  type SqlResultHeader
} from "@bdta/infrastructure";

type QueuedResult = [unknown, SqlResultHeader?];

function rows<T>(value: T): QueuedResult {
  return [value];
}

class FakeSqlExecutor implements SqlExecutor {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];
  private readonly queue: QueuedResult[];

  constructor(queue: QueuedResult[]) {
    this.queue = [...queue];
  }

  async execute<T>(sql: string, params: unknown[] = []): Promise<[T, SqlResultHeader]> {
    this.calls.push({ sql, params });
    const next = this.queue.shift();
    if (next == null) {
      throw new Error(`No fake SQL result queued for: ${sql}`);
    }

    return [next[0] as T, next[1] ?? {}];
  }
}

describe("mysql infrastructure", () => {
  it("creates public-booking dependencies against legacy-aligned MySQL tables", async () => {
    const executor = new FakeSqlExecutor([
      rows([{ overlapCount: 0 }]),
      rows([]),
      [[] as unknown[], { insertId: 77 }],
      [[] as unknown[], { insertId: 501 }],
      [[] as unknown[], { insertId: 9001 }],
      [[] as unknown[], { insertId: 9002 }]
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true
    }));

    const result = await runtime.handlers.handlePublicBooking({
      serviceId: "svc-private-lesson",
      clientEmail: "new-client@example.com",
      petIds: ["pet-1"],
      requestedStart: "2026-06-01T16:00:00.000Z",
      requestedEnd: "2026-06-01T17:00:00.000Z",
      turnstileToken: "turnstile-ok"
    });

    expect(result.status).toBe(201);
    expect(executor.calls).toHaveLength(6);
    expect(executor.calls[0]?.sql).toContain("SELECT COUNT(*) AS overlapCount FROM bookings");
    expect(executor.calls[1]?.sql).toContain("SELECT id, name, password_hash FROM clients");
    expect(executor.calls[2]?.sql).toContain("INSERT INTO clients");
    expect(executor.calls[3]?.sql).toContain("INSERT INTO bookings");
    expect(executor.calls[4]?.sql).toContain("INSERT INTO email_outbox");
    expect(executor.calls[5]?.sql).toContain("INSERT INTO job_queue");
  });

  it("creates portal login dependencies against clients and app_sessions", async () => {
    const executor = new FakeSqlExecutor([
      rows([{
        id: 12,
        name: "Client One",
        email: "client@example.com",
        password_hash: "$2b$10$abcdefghijklmnopqrstuuY7I5XgnZ1A0xYVg1lW0m6s6Y5jP3QeW",
        is_archived: 0
      }]),
      [[] as unknown[], { affectedRows: 1 }],
      [[] as unknown[], { affectedRows: 1 }],
      rows([{
        session_id: "session-1",
        session_data: JSON.stringify({ actorId: "client-1" }),
        expires_at: "2026-05-27T19:00:00.000Z"
      }])
    ]);

    const deps = createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      passwordVerifier: async () => true,
      captchaVerifier: async () => true
    });
    const sessionStore = createMySqlSessionStore(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      ttlSeconds: 3600
    });

    const runtime = buildApiRuntime(deps);
    const login = await runtime.handlers.handlePortalLogin({
      email: "client@example.com",
      password: "correct-password",
      returnTo: null
    });

    expect(login.status).toBe(200);

    await sessionStore.save("session-1", JSON.stringify({ actorId: "client-1" }));
    const loaded = await sessionStore.load("session-1");

    expect(executor.calls[0]?.sql).toContain("SELECT id, name, email, password_hash");
    expect(executor.calls[1]?.sql).toContain("UPDATE clients SET last_login = CURRENT_TIMESTAMP");
    expect(executor.calls[2]?.sql).toContain("INSERT INTO app_sessions");
    expect(loaded).toBe(JSON.stringify({ actorId: "client-1" }));
  });

  it("creates portal and admin client profile operations against clients", async () => {
    const executor = new FakeSqlExecutor([
      rows([{
        id: 12,
        name: "Client One",
        email: "client@example.com",
        phone: "555-0100",
        address: "123 Main St",
        notes: "Existing note",
        is_admin: 0,
        is_archived: 0
      }]),
      rows([]),
      rows([{ password_hash: "$2b$10$abcdefghijklmnopqrstuuY7I5XgnZ1A0xYVg1lW0m6s6Y5jP3QeW" }]),
      [[] as unknown[], { affectedRows: 1 }],
      rows([{
        id: 12,
        name: "Client One Updated",
        email: "client.updated@example.com",
        phone: "555-0111",
        address: "456 Oak Ave",
        notes: "Existing note",
        is_admin: 0,
        is_archived: 0
      }]),
      rows([{
        id: 12,
        name: "Client One",
        email: "client@example.com",
        phone: "555-0100",
        address: "123 Main St",
        notes: "Existing note",
        is_admin: 0,
        is_archived: 0
      }]),
      rows([]),
      [[] as unknown[], { insertId: 44 }],
      rows([{
        id: 44,
        name: "Client Two",
        email: "client2@example.com",
        phone: "555-0200",
        address: "789 Pine Rd",
        notes: "Created by admin",
        is_admin: 1,
        is_archived: 0
      }]),
      rows([]),
      [[] as unknown[], { affectedRows: 1 }],
      rows([{
        id: 12,
        name: "Client One Admin Updated",
        email: "client.admin.updated@example.com",
        phone: "555-0122",
        address: "123 Main St",
        notes: "Updated by admin",
        is_admin: 0,
        is_archived: 0
      }])
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));

    const portalSession = {
      actorId: "12",
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

    const portalProfile = await runtime.handlers.handlePortalProfile(portalSession);
    const portalUpdated = await runtime.handlers.handlePortalProfileUpdate(portalSession, {
      name: "Client One Updated",
      email: "client.updated@example.com",
      phone: "555-0111",
      address: "456 Oak Ave",
      currentPassword: "correct-password",
      newPassword: "new-password",
      confirmPassword: "new-password"
    });
    const adminProfile = await runtime.handlers.handleAdminClientProfile(adminSession, "12");
    const adminCreated = await runtime.handlers.handleAdminClientCreate(adminSession, {
      name: "Client Two",
      email: "client2@example.com",
      phone: "555-0200",
      address: "789 Pine Rd",
      notes: "Created by admin",
      isAdmin: true
    });
    const adminUpdated = await runtime.handlers.handleAdminClientUpdate(adminSession, "12", {
      name: "Client One Admin Updated",
      email: "client.admin.updated@example.com",
      phone: "555-0122",
      address: "123 Main St",
      notes: "Updated by admin",
      isAdmin: false
    });

    expect(portalProfile.status).toBe(200);
    expect(portalUpdated.status).toBe(200);
    expect(adminProfile.status).toBe(200);
    expect(adminCreated.status).toBe(201);
    expect(adminUpdated.status).toBe(200);
    expect(executor.calls[0]?.sql).toContain("SELECT id, name, email, phone, address, notes");
    expect(executor.calls[1]?.sql).toContain("FROM clients");
    expect(executor.calls[2]?.sql).toContain("SELECT password_hash");
    expect(executor.calls[3]?.sql).toContain("UPDATE clients");
    expect(executor.calls[5]?.sql).toContain("WHERE id = ?");
    expect(executor.calls[7]?.sql).toContain("INSERT INTO clients");
    expect(executor.calls[8]?.sql).toContain("WHERE id = ?");
    expect(executor.calls[10]?.sql).toContain("UPDATE clients");
  });

  it("creates portal summary and admin dashboard reads against legacy-aligned tables", async () => {
    const executor = new FakeSqlExecutor([
      rows([{
        id: 301,
        client_id: 12,
        service_type: "svc-private-lesson",
        appointment_date: "2026-06-01",
        appointment_time: "16:00:00",
        duration_minutes: 60,
        status: "confirmed",
        ical_token: null
      }]),
      rows([{
        id: 401,
        client_id: 12,
        status: "sent",
        total_amount: 225,
        outstanding_amount: 125,
        due_at: "2026-06-05T00:00:00.000Z"
      }]),
      rows([{
        id: 501,
        client_id: 12,
        status: "sent",
        total_amount: 450,
        access_token: "quote-access-token-1234"
      }]),
      rows([{ count: 4 }]),
      rows([{ count: 2 }]),
      rows([{ count: 1 }]),
      rows([{ count: 38 }]),
      rows([{
        id: 302,
        client_id: 44,
        service_type: "svc-board-train",
        appointment_date: "2026-05-28",
        appointment_time: "17:00:00",
        duration_minutes: 60,
        status: "pending",
        ical_token: null
      }])
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));

    const portalSummary = await runtime.handlers.handlePortalSummary({
      actorId: "12",
      actorType: "portal_user",
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    });

    const adminDashboard = await runtime.handlers.handleAdminDashboard({
      actorId: "admin-1",
      actorType: "admin_user",
      role: "accountant",
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    });

    expect(portalSummary.status).toBe(200);
    expect(adminDashboard.status).toBe(200);
    expect(executor.calls[0]?.sql).toContain("FROM bookings");
    expect(executor.calls[1]?.sql).toContain("FROM invoices");
    expect(executor.calls[2]?.sql).toContain("FROM quotes");
    expect(executor.calls[3]?.sql).toContain("COUNT(*) AS count FROM bookings WHERE status = 'pending'");
    expect(executor.calls[4]?.sql).toContain("COUNT(*) AS count FROM bookings WHERE appointment_date = ?");
    expect(executor.calls[5]?.sql).toContain("COUNT(*) AS count FROM invoices WHERE status = 'overdue'");
    expect(executor.calls[6]?.sql).toContain("COUNT(*) AS count FROM clients WHERE COALESCE(is_archived, 0) = 0");
    expect(executor.calls[7]?.sql).toContain("ORDER BY created_at DESC");
  });

  it("creates admin operations reads against job queue and integration callback tables", async () => {
    const executor = new FakeSqlExecutor([
      rows([{
        job_id: "job-1",
        job_kind: "workflow_processor",
        run_at: "2026-05-27T17:30:00.000Z",
        payload_json: JSON.stringify({ limit: 10 }),
        status: "processed",
        processed_at: "2026-05-27T18:00:00.000Z"
      }]),
      rows([{
        job_id: "job-1",
        job_kind: "workflow_processor",
        run_at: "2026-05-27T17:30:00.000Z",
        payload_json: JSON.stringify({ limit: 10 }),
        status: "processed",
        processed_at: "2026-05-27T18:00:00.000Z"
      }]),
      rows([{
        callback_id: "callback-1",
        provider: "imap",
        received_at: "2026-05-27T18:05:00.000Z",
        payload_json: JSON.stringify({ messageId: "imap-message-1" }),
        queued_job_id: "job-email-1"
      }]),
      rows([{
        callback_id: "callback-1",
        provider: "imap",
        received_at: "2026-05-27T18:05:00.000Z",
        payload_json: JSON.stringify({ messageId: "imap-message-1" }),
        queued_job_id: "job-email-1"
      }])
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));

    const session = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const jobs = await runtime.handlers.handleAdminJobLogs(session);
    const job = await runtime.handlers.handleAdminJobLogDetail(session, "job-1");
    const callbacks = await runtime.handlers.handleAdminIntegrationCallbackLogs(session);
    const callback = await runtime.handlers.handleAdminIntegrationCallbackLogDetail(session, "callback-1");

    expect(jobs.status).toBe(200);
    expect(job.status).toBe(200);
    expect(callbacks.status).toBe(200);
    expect(callback.status).toBe(200);
    expect(executor.calls[0]?.sql).toContain("FROM job_queue");
    expect(executor.calls[1]?.sql).toContain("WHERE job_id = ?");
    expect(executor.calls[2]?.sql).toContain("FROM integration_callbacks");
    expect(executor.calls[3]?.sql).toContain("WHERE callback_id = ?");
  });

  it("creates package and credit reads against legacy package tables", async () => {
    const executor = new FakeSqlExecutor([
      rows([{
        id: 91,
        name: "Starter Package",
        is_active: 1,
        price: 325
      }]),
      rows([{
        id: 91,
        name: "Starter Package",
        is_active: 1,
        price: 325
      }]),
      rows([{
        id: 7001,
        client_id: 12,
        package_id: 91,
        total_credits: 6,
        used_credits: 2
      }]),
      rows([{
        id: 7001,
        client_id: 12,
        package_id: 91,
        total_credits: 6,
        used_credits: 2
      }]),
      rows([{
        id: 91,
        name: "Starter Package",
        is_active: 1,
        price: 325
      }]),
      rows([{
        id: 91,
        name: "Starter Package",
        is_active: 1,
        price: 325
      }]),
      rows([{
        id: 7001,
        client_id: 12,
        package_id: 91,
        total_credits: 6,
        used_credits: 2
      }]),
      rows([{
        id: 7001,
        client_id: 12,
        package_id: 91,
        total_credits: 6,
        used_credits: 2
      }])
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));

    const portalSession = {
      actorId: "12",
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
    const portalPackage = await runtime.handlers.handlePortalPackageDetail(portalSession, "91");
    const portalCredits = await runtime.handlers.handlePortalCredits(portalSession);
    const portalCredit = await runtime.handlers.handlePortalCreditDetail(portalSession, "7001");
    const adminPackages = await runtime.handlers.handleAdminPackages(adminSession);
    const adminPackage = await runtime.handlers.handleAdminPackageDetail(adminSession, "91");
    const adminCredits = await runtime.handlers.handleAdminCredits(adminSession);
    const adminCredit = await runtime.handlers.handleAdminCreditDetail(adminSession, "7001");

    expect(portalPackages.status).toBe(200);
    expect(portalPackage.status).toBe(200);
    expect(portalCredits.status).toBe(200);
    expect(portalCredit.status).toBe(200);
    expect(adminPackages.status).toBe(200);
    expect(adminPackage.status).toBe(200);
    expect(adminCredits.status).toBe(200);
    expect(adminCredit.status).toBe(200);
    expect(executor.calls[0]?.sql).toContain("FROM packages");
    expect(executor.calls[0]?.sql).toContain("JOIN client_packages");
    expect(executor.calls[1]?.sql).toContain("WHERE cp.client_id = ? AND p.id = ?");
    expect(executor.calls[2]?.sql).toContain("FROM client_package_credits");
    expect(executor.calls[2]?.sql).toContain("JOIN client_packages");
    expect(executor.calls[3]?.sql).toContain("WHERE cpc.client_id = ? AND cpc.id = ?");
    expect(executor.calls[4]?.sql).toContain("FROM packages");
    expect(executor.calls[5]?.sql).toContain("WHERE id = ?");
    expect(executor.calls[6]?.sql).toContain("FROM client_package_credits");
    expect(executor.calls[7]?.sql).toContain("WHERE cpc.id = ?");
  });

  it("creates portal and admin contact operations against client_contacts", async () => {
    const executor = new FakeSqlExecutor([
      rows([{
        id: 801,
        client_id: 12,
        name: "Primary Contact",
        email: "primary@example.com",
        phone: "555-0100",
        is_primary: 1
      }]),
      rows([{
        id: 801,
        client_id: 12,
        name: "Primary Contact",
        email: "primary@example.com",
        phone: "555-0100",
        is_primary: 1
      }]),
      rows([]),
      rows([]),
      [[] as unknown[], { insertId: 802 }],
      rows([{
        id: 802,
        client_id: 12,
        name: "Backup Contact",
        email: "backup@example.com",
        phone: "555-0101",
        is_primary: 1
      }]),
      rows([]),
      rows([]),
      [[] as unknown[], { affectedRows: 1 }],
      rows([{
        id: 801,
        client_id: 12,
        name: "Primary Contact Updated",
        email: "primary@example.com",
        phone: "555-0199",
        is_primary: 0
      }]),
      rows([]),
      [[] as unknown[], { affectedRows: 1 }],
      rows([{
        id: 802,
        client_id: 12,
        name: "Backup Contact",
        email: "backup@example.com",
        phone: "555-0101",
        is_primary: 1
      }])
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));

    const portalSession = {
      actorId: "12",
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

    const portalContacts = await runtime.handlers.handlePortalContacts(portalSession);
    const portalContact = await runtime.handlers.handlePortalContactDetail(portalSession, "801");
    const created = await runtime.handlers.handlePortalContactCreate(portalSession, {
      name: "Backup Contact",
      email: "backup@example.com",
      phone: "555-0101",
      isPrimary: true
    });
    const updated = await runtime.handlers.handlePortalContactUpdate(portalSession, "801", {
      name: "Primary Contact Updated",
      email: "primary@example.com",
      phone: "555-0199",
      isPrimary: false
    });
    const deleted = await runtime.handlers.handlePortalContactDelete(portalSession, "801");
    const adminContacts = await runtime.handlers.handleAdminClientContacts(adminSession, "12");

    expect(portalContacts.status).toBe(200);
    expect(portalContact.status).toBe(200);
    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(deleted.status).toBe(200);
    expect(adminContacts.status).toBe(200);
    expect(executor.calls[0]?.sql).toContain("FROM client_contacts");
    expect(executor.calls[1]?.sql).toContain("WHERE client_id = ? AND id = ?");
    expect(executor.calls[2]?.sql).toBe("START TRANSACTION");
    expect(executor.calls[3]?.sql).toContain("UPDATE client_contacts SET is_primary = 0 WHERE client_id = ?");
    expect(executor.calls[4]?.sql).toContain("INSERT INTO client_contacts");
    expect(executor.calls[6]?.sql).toBe("COMMIT");
    expect(executor.calls[7]?.sql).toBe("START TRANSACTION");
    expect(executor.calls[8]?.sql).toContain("UPDATE client_contacts");
    expect(executor.calls[10]?.sql).toBe("COMMIT");
    expect(executor.calls[11]?.sql).toContain("DELETE FROM client_contacts WHERE client_id = ? AND id = ?");
    expect(executor.calls[12]?.sql).toContain("FROM client_contacts");
  });

  it("creates pet reads against legacy pet tables", async () => {
    const executor = new FakeSqlExecutor([
      rows([{
        id: 51,
        client_id: 12,
        name: "Buddy",
        species: "Dog",
        is_active: 1
      }]),
      rows([{
        id: 51,
        client_id: 12,
        name: "Buddy",
        species: "Dog",
        is_active: 1
      }]),
      rows([{
        id: 51,
        client_id: 12,
        name: "Buddy",
        species: "Dog",
        is_active: 1
      }]),
      rows([{
        id: 51,
        client_id: 12,
        name: "Buddy",
        species: "Dog",
        is_active: 1
      }])
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));

    const portalSession = {
      actorId: "12",
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
    const portalPet = await runtime.handlers.handlePortalPetDetail(portalSession, "51");
    const adminPets = await runtime.handlers.handleAdminPets(adminSession);
    const adminPet = await runtime.handlers.handleAdminPetDetail(adminSession, "51");

    expect(portalPets.status).toBe(200);
    expect(portalPet.status).toBe(200);
    expect(adminPets.status).toBe(200);
    expect(adminPet.status).toBe(200);
    expect(executor.calls[0]?.sql).toContain("FROM pets");
    expect(executor.calls[0]?.sql).toContain("WHERE client_id = ?");
    expect(executor.calls[1]?.sql).toContain("WHERE client_id = ? AND id = ?");
    expect(executor.calls[2]?.sql).toContain("FROM pets");
    expect(executor.calls[3]?.sql).toContain("WHERE id = ?");
  });

  it("creates portal and admin pet file operations against legacy pet_files tables", async () => {
    const petFileContentDeleter = vi.fn(async () => undefined);
    const executor = new FakeSqlExecutor([
      rows([{
        id: 901,
        pet_id: 51,
        file_type: "document",
        file_name: "vaccination-record.pdf",
        original_name: "Vaccination Record.pdf",
        file_size: 120340,
        mime_type: "application/pdf",
        description: "Vaccination record",
        uploaded_by: null,
        uploaded_at: "2026-05-26T12:00:00.000Z"
      }]),
      rows([{
        id: 901,
        pet_id: 51,
        file_type: "document",
        file_name: "vaccination-record.pdf",
        original_name: "Vaccination Record.pdf",
        file_size: 120340,
        mime_type: "application/pdf",
        description: "Vaccination record",
        uploaded_by: null,
        uploaded_at: "2026-05-26T12:00:00.000Z"
      }]),
      rows([{
        id: 902,
        pet_id: 51,
        file_type: "photo",
        file_name: "buddy-headshot.jpg",
        original_name: "Buddy Headshot.jpg",
        file_size: 98342,
        mime_type: "image/jpeg",
        description: "Front profile",
        uploaded_by: 7,
        uploaded_at: "2026-05-25T09:30:00.000Z"
      }]),
      rows([{
        id: 902,
        pet_id: 51,
        file_type: "photo",
        file_name: "buddy-headshot.jpg",
        original_name: "Buddy Headshot.jpg",
        file_size: 98342,
        mime_type: "image/jpeg",
        description: "Front profile",
        uploaded_by: 7,
        uploaded_at: "2026-05-25T09:30:00.000Z"
      }]),
      rows([{
        file_name: "buddy-headshot.jpg"
      }]),
      [[] as unknown[], { affectedRows: 1 }]
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true,
      petFileContentDeleter
    }));

    const portalSession = {
      actorId: "12",
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

    const portalFiles = await runtime.handlers.handlePortalPetFiles(portalSession, "51");
    const portalFile = await runtime.handlers.handlePortalPetFileDetail(portalSession, "51", "901");
    const adminFiles = await runtime.handlers.handleAdminPetFiles(adminSession, "51");
    const adminFile = await runtime.handlers.handleAdminPetFileDetail(adminSession, "51", "902");
    const adminDeleted = await runtime.handlers.handleAdminPetFileDelete(adminSession, "51", "902");

    expect(portalFiles.status).toBe(200);
    expect(portalFile.status).toBe(200);
    expect(adminFiles.status).toBe(200);
    expect(adminFile.status).toBe(200);
    expect(adminDeleted.status).toBe(200);
    expect(executor.calls[0]?.sql).toContain("FROM pet_files pf");
    expect(executor.calls[0]?.sql).toContain("JOIN pets p ON p.id = pf.pet_id");
    expect(executor.calls[0]?.sql).toContain("WHERE p.client_id = ? AND pf.pet_id = ?");
    expect(executor.calls[1]?.sql).toContain("WHERE p.client_id = ? AND pf.pet_id = ? AND pf.id = ?");
    expect(executor.calls[2]?.sql).toContain("FROM pet_files");
    expect(executor.calls[2]?.sql).toContain("WHERE pet_id = ?");
    expect(executor.calls[3]?.sql).toContain("WHERE pet_id = ? AND id = ?");
    expect(executor.calls[4]?.sql).toContain("SELECT file_name FROM pet_files");
    expect(executor.calls[5]?.sql).toContain("DELETE FROM pet_files WHERE pet_id = ? AND id = ?");
    expect(petFileContentDeleter).toHaveBeenCalledWith("51", "buddy-headshot.jpg");
  });

  it("creates portal and admin pet file uploads against legacy pet_files tables", async () => {
    const petFileContentWriter = vi.fn(async () => undefined);
    const executor = new FakeSqlExecutor([
      rows([{ id: 51 }]),
      [[] as unknown[], { insertId: 901 }],
      rows([{ id: 51 }]),
      [[] as unknown[], { insertId: 902 }]
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true,
      petFileContentWriter
    }));

    const portalSession = {
      actorId: "12",
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

    const portalUpload = await runtime.handlers.handlePortalPetFileUpload(portalSession, "51", {
      originalName: "Vaccination Record.pdf",
      description: "Vaccination record",
      content: Buffer.from("%PDF-1.4\nportal-upload-pdf-body", "utf8")
    });
    const adminUpload = await runtime.handlers.handleAdminPetFileUpload(adminSession, "51", {
      originalName: "Scout Headshot.jpg",
      description: "Front profile",
      content: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
    });

    expect(portalUpload.status).toBe(201);
    expect(adminUpload.status).toBe(201);
    expect(executor.calls[0]?.sql).toContain("SELECT id FROM pets");
    expect(executor.calls[0]?.sql).toContain("WHERE id = ? AND client_id = ?");
    expect(executor.calls[1]?.sql).toContain("INSERT INTO pet_files");
    expect(executor.calls[2]?.sql).toContain("SELECT id FROM pets");
    expect(executor.calls[2]?.sql).toContain("WHERE id = ?");
    expect(executor.calls[3]?.sql).toContain("INSERT INTO pet_files");
    expect(petFileContentWriter).toHaveBeenCalledTimes(2);
    const [portalWriteCall, adminWriteCall] = petFileContentWriter.mock.calls as unknown as Array<[string, string, Uint8Array]>;
    expect(portalWriteCall?.[0]).toBe("51");
    expect(String(portalWriteCall?.[1] ?? "")).toMatch(/^pet_51_[a-f0-9]{16}\.pdf$/);
    expect(portalWriteCall?.[2]).toEqual(Buffer.from("%PDF-1.4\nportal-upload-pdf-body", "utf8"));
    expect(adminWriteCall?.[0]).toBe("51");
    expect(String(adminWriteCall?.[1] ?? "")).toMatch(/^pet_51_[a-f0-9]{16}\.jpg$/);
    if ("error" in portalUpload.body || "error" in adminUpload.body) {
      throw new Error("Expected successful pet file upload responses.");
    }
    expect(portalUpload.body.item.originalName).toBe("Vaccination_Record.pdf");
    expect(portalUpload.body.item.uploadedByAdminUserId).toBeNull();
    expect(adminUpload.body.item.originalName).toBe("Scout_Headshot.jpg");
    expect(adminUpload.body.item.uploadedByAdminUserId).toBe("admin-1");
  });

  it("creates portal and admin pet file content operations against legacy pet_files tables", async () => {
    const petFileContentLoader = vi.fn(async (_petId: string, _fileName: string) => Buffer.from("pet-file-body", "utf8"));
    const executor = new FakeSqlExecutor([
      rows([{
        id: 901,
        pet_id: 51,
        file_type: "document",
        file_name: "vaccination-record.pdf",
        original_name: "Vaccination Record.pdf",
        file_size: 120340,
        mime_type: "application/pdf",
        description: "Vaccination record",
        uploaded_by: null,
        uploaded_at: "2026-05-26T12:00:00.000Z"
      }]),
      rows([{
        id: 902,
        pet_id: 51,
        file_type: "photo",
        file_name: "buddy-headshot.jpg",
        original_name: "Buddy Headshot.jpg",
        file_size: 98342,
        mime_type: "image/jpeg",
        description: "Front profile",
        uploaded_by: 7,
        uploaded_at: "2026-05-25T09:30:00.000Z"
      }])
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true,
      petFileContentLoader
    }));

    const portalSession = {
      actorId: "12",
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

    const portalContent = await runtime.handlers.handlePortalPetFileContent(portalSession, "51", "901", false);
    const adminContent = await runtime.handlers.handleAdminPetFileContent(adminSession, "51", "902", true);

    expect(portalContent.status).toBe(200);
    expect(adminContent.status).toBe(200);
    expect(executor.calls[0]?.sql).toContain("FROM pet_files pf");
    expect(executor.calls[0]?.sql).toContain("WHERE p.client_id = ? AND pf.pet_id = ? AND pf.id = ?");
    expect(executor.calls[1]?.sql).toContain("FROM pet_files");
    expect(executor.calls[1]?.sql).toContain("WHERE pet_id = ? AND id = ?");
    expect(petFileContentLoader).toHaveBeenNthCalledWith(1, "51", "vaccination-record.pdf");
    expect(petFileContentLoader).toHaveBeenNthCalledWith(2, "51", "buddy-headshot.jpg");
  });

  it("exposes bootstrap DDL for persistent outbox and job queue tables", () => {
    const statements = getMySqlBootstrapStatements();

    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS integration_callbacks"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS email_outbox"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS job_queue"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS calendar_sync_links"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS workflows"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS workflow_enrollments"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE INDEX idx_integration_callbacks_provider_received_at"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE INDEX idx_calendar_sync_links_provider_synced_at"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE INDEX idx_workflows_active_trigger"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE INDEX idx_workflow_enrollments_run_at"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE INDEX idx_job_queue_status_run_at"))).toBe(true);
  });

  it("creates integration callback dependencies against callback and queue tables", async () => {
    const executor = new FakeSqlExecutor([
      [[] as unknown[], { insertId: 9003 }],
      [[] as unknown[], { insertId: 9004 }]
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));

    const result = await runtime.handlers.handleIntegrationCallback({
      provider: "imap",
      receivedAt: "2026-05-27T18:05:00.000Z",
      payload: {
        messageId: "imap-message-1",
        from: "owner@example.com",
        subject: "Question about invoice 42"
      }
    });

    expect(result.status).toBe(202);
    expect(executor.calls[0]?.sql).toContain("INSERT INTO job_queue");
    expect(executor.calls[1]?.sql).toContain("INSERT INTO integration_callbacks");
  });

  it("creates mail provider callback dependencies against callback and queue tables", async () => {
    const executor = new FakeSqlExecutor([
      [[] as unknown[], { insertId: 9007 }],
      [[] as unknown[], { insertId: 9008 }]
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));

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
    expect(executor.calls[0]?.sql).toContain("INSERT INTO job_queue");
    expect(executor.calls[1]?.sql).toContain("INSERT INTO integration_callbacks");
  });

  it("creates stripe callback dependencies against invoice and callback tables", async () => {
    const executor = new FakeSqlExecutor([
      [[] as unknown[], { affectedRows: 1 }],
      [[] as unknown[], { insertId: 9005 }]
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));

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
    expect(executor.calls[0]?.sql).toContain("UPDATE invoices SET status = ?");
    expect(executor.calls[1]?.sql).toContain("INSERT INTO integration_callbacks");
  });

  it("creates google calendar callback dependencies against calendar sync and callback tables", async () => {
    const executor = new FakeSqlExecutor([
      [[] as unknown[], { affectedRows: 1 }],
      [[] as unknown[], { insertId: 9006 }]
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));

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
    expect(executor.calls[0]?.sql).toContain("INSERT INTO calendar_sync_links");
    expect(executor.calls[1]?.sql).toContain("INSERT INTO integration_callbacks");
  });

  it("creates public tokenized document reads against legacy-aligned tables", async () => {
    const executor = new FakeSqlExecutor([
      rows([{
        id: 501,
        client_id: 12,
        status: "sent",
        total_amount: 450,
        access_token: "quote-access-token-1234"
      }]),
      rows([{
        id: 601,
        client_id: 12,
        status: "sent",
        access_token: "contract-access-token-1234"
      }]),
      rows([{
        id: 701,
        template_id: 9,
        client_id: 12,
        submitted_at: null,
        access_token: "form-access-token-123456"
      }]),
      rows([{
        id: 801,
        client_id: 12,
        service_type: "svc-private-lesson",
        appointment_date: "2026-06-01",
        appointment_time: "16:00:00",
        duration_minutes: 60,
        status: "confirmed",
        ical_token: "ical-access-token-123456"
      }])
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));

    const quote = await runtime.handlers.handlePublicQuoteDetail({
      quoteId: "501",
      token: "quote-access-token-1234",
      session: null
    });
    const contract = await runtime.handlers.handlePublicContractDetail({
      contractId: "601",
      token: "contract-access-token-1234",
      session: null
    });
    const form = await runtime.handlers.handlePublicFormSubmissionDetail({
      submissionId: "701",
      token: "form-access-token-123456",
      session: null
    });
    const bookingIcal = await runtime.handlers.handlePublicBookingIcalDetail({
      bookingId: "801",
      token: "ical-access-token-123456",
      session: null
    });

    expect(quote.status).toBe(200);
    expect(contract.status).toBe(200);
    expect(form.status).toBe(200);
    expect(bookingIcal.status).toBe(200);
    expect(executor.calls[0]?.sql).toContain("FROM quotes");
    expect(executor.calls[1]?.sql).toContain("FROM contracts");
    expect(executor.calls[2]?.sql).toContain("FROM form_submissions");
    expect(executor.calls[3]?.sql).toContain("FROM bookings");
  });

  it("creates admin calendar sync dependencies against bookings and calendar sync tables", async () => {
    const executor = new FakeSqlExecutor([
      rows([{
        id: 801,
        client_id: 12,
        service_type: "svc-private-lesson",
        appointment_date: "2026-06-10",
        appointment_time: "16:00:00",
        duration_minutes: 60,
        status: "confirmed",
        ical_token: "ical-sync-token-123456"
      }]),
      [[] as unknown[], { affectedRows: 1 }]
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));

    const result = await runtime.handlers.handleAdminBookingCalendarSync({
      actorId: "admin-1",
      actorType: "admin_user",
      role: "accountant",
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    }, "801", {
      provider: "google_calendar"
    });

    expect(result.status).toBe(200);
    expect(executor.calls[0]?.sql).toContain("FROM bookings");
    expect(executor.calls[1]?.sql).toContain("INSERT INTO calendar_sync_links");
  });

  it("reads admin calendar sync dependencies against bookings and calendar sync tables", async () => {
    const executor = new FakeSqlExecutor([
      rows([{
        id: 801,
        client_id: 12,
        service_type: "svc-private-lesson",
        appointment_date: "2026-06-10",
        appointment_time: "16:00:00",
        duration_minutes: 60,
        status: "confirmed",
        ical_token: "ical-sync-token-123456",
        external_event_id: "google-event-1",
        external_event_url: "https://calendar.google.com/calendar/event?eid=google-event-1",
        synced_at: "2026-05-27T18:05:00.000Z"
      }])
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));

    const result = await runtime.handlers.handleAdminBookingCalendarSyncDetail({
      actorId: "admin-1",
      actorType: "admin_user",
      role: "accountant",
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    }, "801");

    expect(result.status).toBe(200);
    expect(executor.calls[0]?.sql).toContain("FROM bookings");
    expect(executor.calls[0]?.sql).toContain("JOIN calendar_sync_links");
  });

  it("creates portal and admin achievement reads against legacy achievement tables", async () => {
    const achievementRow = {
      id: 901,
      client_id: 12,
      achievement_type_id: 44,
      title: "Canine Good Citizen",
      description: "Awarded after program completion.",
      scope_type: "general",
      award_mode: "badge_certificate",
      badge_icon_path: "/assets/badges/cgc.svg",
      certificate_template_path: "/assets/certificates/cgc.html",
      certificate_body_html: "<p>Certificate Body</p>",
      status: "awarded",
      awarded_on: "2026-05-20",
      dog_name: "Buddy",
      program_name: "Obedience 101",
      notes: "Completed successfully",
      awarded_by: 7,
      updated_by: 7,
      revoked_by: null,
      revoked_at: null,
      created_at: "2026-05-20T12:00:00.000Z",
      updated_at: "2026-05-20T12:00:00.000Z"
    };

    const executor = new FakeSqlExecutor([
      rows([achievementRow]),
      rows([achievementRow]),
      rows([{
        id: 44,
        title: "Canine Good Citizen",
        description: "Awarded after program completion.",
        scope_type: "general",
        award_mode: "badge_certificate",
        badge_icon_path: "/assets/badges/cgc.svg",
        certificate_template_path: "/assets/certificates/cgc.html",
        certificate_body_html: "<p>Certificate Body</p>",
        is_active: 1
      }]),
      rows([{
        id: 44,
        title: "Canine Good Citizen",
        description: "Awarded after program completion.",
        scope_type: "general",
        award_mode: "badge_certificate",
        badge_icon_path: "/assets/badges/cgc.svg",
        certificate_template_path: "/assets/certificates/cgc.html",
        certificate_body_html: "<p>Certificate Body</p>",
        is_active: 1
      }]),
      rows([achievementRow]),
      rows([achievementRow]),
      rows([achievementRow])
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));

    const portalSession = {
      actorId: "12",
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

    const portalAchievements = await runtime.handlers.handlePortalAchievements(portalSession);
    const portalAchievement = await runtime.handlers.handlePortalAchievementDetail(portalSession, "901");
    const adminAchievementTypes = await runtime.handlers.handleAdminAchievementTypes(adminSession);
    const adminAchievementType = await runtime.handlers.handleAdminAchievementTypeDetail(adminSession, "44");
    const adminClientAchievements = await runtime.handlers.handleAdminClientAchievements(adminSession, "12");
    const adminClientAchievement = await runtime.handlers.handleAdminClientAchievementDetail(adminSession, "12", "901");
    const adminCertificate = await runtime.handlers.handleAdminClientAchievementCertificate(adminSession, "12", "901", true);

    expect(portalAchievements.status).toBe(200);
    expect(portalAchievement.status).toBe(200);
    expect(adminAchievementTypes.status).toBe(200);
    expect(adminAchievementType.status).toBe(200);
    expect(adminClientAchievements.status).toBe(200);
    expect(adminClientAchievement.status).toBe(200);
    expect(adminCertificate.status).toBe(200);
    expect(executor.calls[0]?.sql).toContain("FROM client_achievements");
    expect(executor.calls[0]?.sql).toContain("JOIN achievement_types");
    expect(executor.calls[1]?.sql).toContain("WHERE ca.client_id = ? AND ca.id = ?");
    expect(executor.calls[2]?.sql).toContain("FROM achievement_types");
    expect(executor.calls[3]?.sql).toContain("WHERE id = ?");
    expect(executor.calls[4]?.sql).toContain("WHERE ca.client_id = ?");
    expect(executor.calls[5]?.sql).toContain("WHERE ca.client_id = ? AND ca.id = ?");
    if (typeof adminCertificate.body !== "string") {
      throw new Error("Expected printable achievement certificate HTML.");
    }
    expect(adminCertificate.body).toContain("Canine Good Citizen");
    expect(adminCertificate.body).toContain('data-download="1"');
  });

  it("creates admin invoice, quote, contract, and form reads against legacy-aligned tables", async () => {
    const executor = new FakeSqlExecutor([
      rows([{
        id: 401,
        client_id: 12,
        status: "sent",
        total_amount: 225,
        outstanding_amount: 125,
        due_at: "2026-06-05T00:00:00.000Z"
      }]),
      rows([{
        id: 501,
        client_id: 12,
        status: "sent",
        total_amount: 450,
        access_token: "quote-access-token-1234"
      }]),
      rows([{
        id: 601,
        client_id: 12,
        status: "sent",
        access_token: "contract-access-token-1234"
      }]),
      rows([{
        id: 701,
        template_id: 9,
        client_id: 12,
        submitted_at: null,
        access_token: "form-access-token-123456"
      }])
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));

    const session = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const invoices = await runtime.handlers.handleAdminInvoices(session);
    const quotes = await runtime.handlers.handleAdminQuotes(session);
    const contracts = await runtime.handlers.handleAdminContracts(session);
    const forms = await runtime.handlers.handleAdminForms(session);

    expect(invoices.status).toBe(200);
    expect(quotes.status).toBe(200);
    expect(contracts.status).toBe(200);
    expect(forms.status).toBe(200);
    expect(executor.calls[0]?.sql).toContain("FROM invoices");
    expect(executor.calls[1]?.sql).toContain("FROM quotes");
    expect(executor.calls[2]?.sql).toContain("FROM contracts");
    expect(executor.calls[3]?.sql).toContain("FROM form_submissions");
  });

  it("creates due-job and email-outbox processing dependencies against queue tables", async () => {
    const executor = new FakeSqlExecutor([
      rows([{
        job_id: "job-1",
        job_kind: "booking_reminder",
        run_at: "2026-05-27T17:00:00.000Z",
        payload_json: JSON.stringify({ bookingId: "booking-1" })
      }]),
      [[] as unknown[], { affectedRows: 1 }],
      [[] as unknown[], { affectedRows: 1 }],
      rows([{
        id: 9001,
        recipient: "client@example.com",
        subject: "Booking confirmed",
        html_body: "<p>Confirmed</p>",
        template_key: "booking_confirmation"
      }]),
      [[] as unknown[], { affectedRows: 1 }],
      [[] as unknown[], { affectedRows: 1 }]
    ]);

    const { createMySqlJobProcessorDependencies } = await import("@bdta/infrastructure");
    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));
    void runtime;

    const deps = createMySqlJobProcessorDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      handlers: {
        booking_reminder: async () => "Reminder sent."
      },
      sendEmail: async () => undefined
    });

    const { buildJobRuntime } = await import("../apps/jobs/src/index.js");
    const result = await buildJobRuntime(deps).processDueWork();

    expect(result.jobResults[0]?.success).toBe(true);
    expect(result.emailsSent).toBe(1);
    expect(executor.calls[0]?.sql).toContain("FROM job_queue");
    expect(executor.calls[1]?.sql).toContain("UPDATE job_queue SET status = 'processing'");
    expect(executor.calls[2]?.sql).toContain("UPDATE job_queue SET status = 'processed'");
    expect(executor.calls[3]?.sql).toContain("FROM email_outbox");
    expect(executor.calls[4]?.sql).toContain("UPDATE email_outbox SET status = 'processing'");
    expect(executor.calls[5]?.sql).toContain("UPDATE email_outbox SET status = 'sent'");
  });
});
