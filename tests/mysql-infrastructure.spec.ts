import { createHmac } from "node:crypto";
import { hash as bcryptHash } from "bcryptjs";

import { buildApiRuntime } from "../apps/api/src/index.js";
import {
  createMySqlApiDependencies,
  createMySqlMigrationAuditDependencies,
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
  it("supports workflow and settings migration audit tables in MySQL release validation dependencies", async () => {
    const executor = new FakeSqlExecutor([
      rows([{ rowCount: 9 }]),
      rows([{ rowCount: 18 }]),
      rows([{ rowCount: 42 }]),
      rows([{ tableName: "settings" }]),
      rows([{ tableName: "workflow_steps" }])
    ]);

    const dependencies = createMySqlMigrationAuditDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z"
    });

    await expect(dependencies.countLegacyRows("settings")).resolves.toBe(9);
    await expect(dependencies.countLegacyRows("workflow_steps")).resolves.toBe(18);
    await expect(dependencies.countLegacyRows("workflow_step_executions")).resolves.toBe(42);
    await expect(dependencies.tableExists("settings")).resolves.toBe(true);
    await expect(dependencies.tableExists("workflow_steps")).resolves.toBe(true);

    expect(executor.calls[0]?.sql).toBe("SELECT COUNT(*) AS rowCount FROM settings");
    expect(executor.calls[1]?.sql).toBe("SELECT COUNT(*) AS rowCount FROM workflow_steps");
    expect(executor.calls[2]?.sql).toBe("SELECT COUNT(*) AS rowCount FROM workflow_step_executions");
    expect(executor.calls[3]?.sql).toContain("FROM information_schema.tables");
    expect(executor.calls[3]?.params).toEqual(["settings"]);
    expect(executor.calls[4]?.sql).toContain("FROM information_schema.tables");
    expect(executor.calls[4]?.params).toEqual(["workflow_steps"]);
  });

  it("manages admin settings users through the MySQL content adapter", async () => {
    const executor = new FakeSqlExecutor([
      rows([
        {
          id: 1,
          username: "admin",
          email: "owner@example.com",
          account_type: "main",
          can_manage_admin_users: 1,
          can_manage_api_keys: 1
        },
        {
          id: 2,
          username: "limited",
          email: "limited@example.com",
          account_type: "standard",
          can_manage_admin_users: 0,
          can_manage_api_keys: 0
        }
      ]),
      rows([{
        id: 2,
        username: "limited",
        email: "limited@example.com",
        account_type: "standard",
        can_manage_admin_users: 0,
        can_manage_api_keys: 0
      }]),
      rows([]),
      [[] as unknown[], { insertId: 7 }],
      rows([{
        id: 7,
        username: "assistant.admin",
        email: "assistant.admin@example.com",
        account_type: "standard",
        can_manage_admin_users: 0,
        can_manage_api_keys: 0
      }]),
      [[] as unknown[], { affectedRows: 1 }],
      rows([{
        id: 7,
        username: "assistant.admin",
        email: "assistant.admin@example.com",
        account_type: "standard",
        can_manage_admin_users: 1,
        can_manage_api_keys: 1
      }]),
      [[] as unknown[], {}],
      [[] as unknown[], {}],
      [[] as unknown[], {}],
      [[] as unknown[], { affectedRows: 1 }],
      [[] as unknown[], {}]
    ]);

    const content = createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z"
    }).content;

    await expect(content.listAdminSettingsUsers()).resolves.toHaveLength(2);
    await expect(content.findAdminSettingsUserByActorId("2")).resolves.toMatchObject({
      actorId: "2",
      username: "limited",
      canManageApiKeys: false
    });
    await expect(content.findAdminSettingsUserByUsername("assistant.admin")).resolves.toBeNull();
    await expect(content.createAdminSettingsUser({
      username: "assistant.admin",
      email: "assistant.admin@example.com",
      password: "temporary-password",
      accountType: "standard"
    })).resolves.toMatchObject({
      actorId: "7",
      username: "assistant.admin",
      canManageAdminUsers: false
    });
    await expect(content.updateAdminSettingsUserPermissions("7", {
      canManageAdminUsers: true,
      canManageApiKeys: true
    })).resolves.toMatchObject({
      actorId: "7",
      canManageAdminUsers: true,
      canManageApiKeys: true
    });
    await expect(content.deleteAdminSettingsUser("7")).resolves.toBe(true);

    expect(executor.calls[0]?.sql).toContain("FROM admin_users");
    expect(executor.calls[1]?.params).toEqual(["2"]);
    expect(executor.calls[2]?.sql).toContain("LOWER(username) = LOWER(?)");
    expect(executor.calls[3]?.sql).toContain("INSERT INTO admin_users");
    expect(executor.calls[5]?.sql).toContain("UPDATE admin_users");
    expect(executor.calls[7]?.sql).toBe("START TRANSACTION");
    expect(executor.calls[8]?.sql).toContain("UPDATE appointment_types SET admin_user_id = NULL");
    expect(executor.calls[9]?.sql).toContain("UPDATE bookings SET admin_user_id = NULL");
    expect(executor.calls[10]?.sql).toContain("DELETE FROM admin_users");
    expect(executor.calls[11]?.sql).toBe("COMMIT");
  });

  it("creates public-booking dependencies against legacy-aligned MySQL tables", async () => {
    const executor = new FakeSqlExecutor([
      rows([{ overlapCount: 0 }]),
      rows([]),
      [[] as unknown[], { insertId: 77 }],
      [[] as unknown[], {}],
      [[] as unknown[], { insertId: 501 }],
      rows([]),
      [[] as unknown[], {}],
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
    expect(executor.calls).toHaveLength(9);
    expect(executor.calls[0]?.sql).toContain("SELECT COUNT(*) AS overlapCount FROM bookings");
    expect(executor.calls[1]?.sql).toContain("SELECT id, name, password_hash FROM clients");
    expect(executor.calls[2]?.sql).toContain("INSERT INTO clients");
    expect(executor.calls[3]?.sql).toBe("START TRANSACTION");
    expect(executor.calls[4]?.sql).toContain("INSERT INTO bookings");
    expect(executor.calls[5]?.sql).toContain("FROM workflow_triggers wt");
    expect(executor.calls[6]?.sql).toBe("COMMIT");
    expect(executor.calls[7]?.sql).toContain("INSERT INTO email_outbox");
    expect(executor.calls[8]?.sql).toContain("INSERT INTO job_queue");
  });

  it("auto-enrolls MySQL workflow clients from appointment booking triggers", async () => {
    const executor = new FakeSqlExecutor([
      rows([{ overlapCount: 0 }]),
      rows([{ id: 12, name: "Existing Client", password_hash: null }]),
      [[] as unknown[], {}],
      [[] as unknown[], { insertId: 501 }],
      rows([{ workflow_id: "workflow-1" }]),
      rows([]),
      [[] as unknown[], { insertId: 9101 }],
      rows([{
        workflow_step_id: "workflow-step-1",
        workflow_id: "workflow-1",
        step_order: 1,
        step_name: "Welcome Email",
        email_subject: "Welcome",
        email_body_html: "<p>Hello</p>",
        email_body_text: "Hello",
        delay_type: "immediate",
        delay_value: null,
        scheduled_date: null,
        attach_contract_id: null,
        attach_form_id: null,
        attach_quote_id: null,
        attach_invoice_id: null,
        include_appointment_link: 0,
        appointment_type_id: null,
        created_at: "2026-05-27T18:00:00.000Z",
        updated_at: "2026-05-27T18:00:00.000Z"
      }]),
      [[] as unknown[], { insertId: 9201 }],
      [[] as unknown[], { affectedRows: 1 }],
      [[] as unknown[], {}],
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
      clientEmail: "existing-client@example.com",
      petIds: ["pet-1"],
      requestedStart: "2026-06-01T16:00:00.000Z",
      requestedEnd: "2026-06-01T17:00:00.000Z",
      turnstileToken: "turnstile-ok"
    });

    expect(result.status).toBe(201);
    expect(executor.calls.some((call) => call.sql.includes("INSERT INTO workflow_enrollments"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("INSERT INTO workflow_step_executions"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("UPDATE workflow_enrollments SET next_run_at"))).toBe(true);
  });

  it("finalizes legacy public package purchases through legacy package tables", async () => {
    const executor = new FakeSqlExecutor([
      rows([{
        id: 91,
        name: "Starter Package",
        is_active: 1,
        price: 325,
        description: "Four private sessions with follow-up support.",
        bullet_points: "Four sessions\nHomework notes",
        expiration_days: 120,
        share_token: "starter-package-token",
        portal_available: 1,
        form_template_id: null
      }]),
      rows([
        {
          package_id: 91,
          appointment_type_id: 401,
          quantity: 4,
          appointment_type_name: "Private Lesson"
        },
        {
          package_id: 91,
          appointment_type_id: 402,
          quantity: 2,
          appointment_type_name: "Field Rental"
        }
      ]),
      rows([{
        id: 21,
        name: "Package Intake Form",
        description: "Collects package checkout details",
        fields: JSON.stringify([
          { label: "Dog Name", type: "text", required: true },
          { label: "Goals", type: "textarea", required: false }
        ]),
        form_type: "booking_form",
        required_frequency: null,
        appointment_type_id: null,
        is_internal: 0,
        show_in_client_portal: 1,
        is_active: 1
      }]),
      [[] as unknown[], {}],
      rows([]),
      [[] as unknown[], { insertId: 12 }],
      [[] as unknown[], { insertId: 7001 }],
      [[] as unknown[], { insertId: 9001 }],
      [[] as unknown[], { insertId: 9002 }],
      rows([
        {
          id: 9001,
          appointment_type_id: 401,
          total_credits: 4
        },
        {
          id: 9002,
          appointment_type_id: 402,
          total_credits: 2
        }
      ]),
      [[] as unknown[], { insertId: 8101 }],
      [[] as unknown[], { insertId: 8102 }],
      [[] as unknown[], { insertId: 9201 }],
      rows([]),
      rows([]),
      [[] as unknown[], { insertId: 9301 }],
      rows([]),
      [[] as unknown[], { insertId: 9302 }],
      [[] as unknown[], { affectedRows: 1 }],
      [[] as unknown[], {}]
    ]);

    const dependencies = createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z"
    });

    const packageItem = await dependencies.publicPackages.findPublicPackageByToken("starter-package-token");
    if (packageItem == null) {
      throw new Error("Expected a public package to be returned.");
    }
    const checkoutForm = await dependencies.publicPackages.findPublicCheckoutForm("21");

    const purchase = await dependencies.publicPackages.finalizePublicPackagePurchase({
      packageItem,
      buyerName: "Package Buyer",
      buyerEmail: "buyer@example.com",
      buyerPhone: "555-0111",
      notes: "Please keep sessions on weekday evenings.",
      formSubmission: {
        templateId: "21",
        responses: ["Rocket", "Build confidence around other dogs"]
      }
    });

    expect(packageItem.items).toEqual([
      {
        appointmentTypeId: "401",
        appointmentTypeName: "Private Lesson",
        quantity: 4
      },
      {
        appointmentTypeId: "402",
        appointmentTypeName: "Field Rental",
        quantity: 2
      }
    ]);
    expect(checkoutForm).toMatchObject({
      id: "21",
      name: "Package Intake Form",
      formType: "booking_form"
    });
    expect(purchase).toEqual({
      clientId: "12",
      clientPackageId: "7001"
    });
    expect(executor.calls[0]?.sql).toContain("FROM packages");
    expect(executor.calls[1]?.sql).toContain("FROM package_items");
    expect(executor.calls[2]?.sql).toContain("FROM form_templates");
    expect(executor.calls[3]?.sql).toBe("START TRANSACTION");
    expect(executor.calls[4]?.sql).toContain("FROM clients");
    expect(executor.calls[5]?.sql).toContain("INSERT INTO clients");
    expect(executor.calls[6]?.sql).toContain("INSERT INTO client_packages");
    expect(executor.calls[7]?.sql).toContain("INSERT INTO client_package_credits");
    expect(executor.calls[8]?.sql).toContain("INSERT INTO client_package_credits");
    expect(executor.calls[9]?.sql).toContain("FROM client_package_credits");
    expect(executor.calls[10]?.sql).toContain("INSERT INTO package_credit_transactions");
    expect(executor.calls[11]?.sql).toContain("INSERT INTO package_credit_transactions");
    expect(executor.calls[12]?.sql).toContain("INSERT INTO form_submissions");
    expect(executor.calls[13]?.sql).toContain("FROM workflow_triggers wt");
    expect(executor.calls[14]?.sql).toContain("FROM invoices");
    expect(executor.calls[15]?.sql).toContain("INSERT INTO invoices");
    expect(executor.calls[16]?.sql).toContain("FROM invoice_items");
    expect(executor.calls[17]?.sql).toContain("INSERT INTO invoice_items");
    expect(executor.calls[18]?.sql).toContain("UPDATE invoices");
    expect(executor.calls[19]?.sql).toBe("COMMIT");
  });

  it("checks existing package checkout form submissions against legacy form context", async () => {
    const executor = new FakeSqlExecutor([
      rows([{ id: 12 }]),
      rows([{}])
    ]);

    const dependencies = createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z"
    });

    const clientId = await dependencies.publicPackages.findClientIdByEmail("Buyer@Example.com");
    const hasSubmission = await dependencies.publicPackages.hasSubmittedCheckoutForm({
      clientId: "12",
      templateId: "21",
      appointmentTypeId: "401",
      submittedAfter: null
    });

    expect(clientId).toBe("12");
    expect(hasSubmission).toBe(true);
    expect(executor.calls[0]?.sql).toContain("FROM clients");
    expect(executor.calls[0]?.params).toEqual(["buyer@example.com"]);
    expect(executor.calls[1]?.sql).toContain("FROM form_submissions fs");
    expect(executor.calls[1]?.sql).toContain("LEFT JOIN bookings b");
    expect(executor.calls[1]?.sql).toContain("LEFT JOIN form_templates ft");
    expect(executor.calls[1]?.params).toEqual(["12", "21", "401", "401"]);
  });

  it("persists pending paid package checkouts and finalizes Stripe-paid package purchases idempotently", async () => {
    const stripeClient = {
      createCheckoutSession: async () => ({
        sessionId: "cs_pkg_test_123",
        checkoutUrl: "https://checkout.stripe.test/cs_pkg_test_123",
        expiresAt: "2026-05-27T19:00:00.000Z",
        paymentStatus: "unpaid",
        amountTotal: 32500,
        paymentIntentId: null,
        metadata: {
          public_package_id: "91",
          public_package_token: "starter-package-token"
        }
      }),
      fetchCheckoutSession: async () => ({
        sessionId: "cs_pkg_test_123",
        checkoutUrl: "https://checkout.stripe.test/cs_pkg_test_123",
        expiresAt: "2026-05-27T19:00:00.000Z",
        paymentStatus: "paid",
        amountTotal: 32500,
        paymentIntentId: "pi_pkg_test_123",
        metadata: {
          public_package_id: "91",
          public_package_token: "starter-package-token"
        }
      })
    };

    const executor = new FakeSqlExecutor([
      rows([{
        id: 91,
        name: "Starter Package",
        is_active: 1,
        price: 325,
        description: "Four private sessions with follow-up support.",
        bullet_points: "Four sessions\nHomework notes",
        expiration_days: 120,
        share_token: "starter-package-token",
        portal_available: 1,
        form_template_id: null
      }]),
      rows([
        {
          package_id: 91,
          appointment_type_id: 401,
          quantity: 4,
          appointment_type_name: "Private Lesson"
        },
        {
          package_id: 91,
          appointment_type_id: 402,
          quantity: 2,
          appointment_type_name: "Field Rental"
        }
      ]),
      [[] as unknown[], {}],
      rows([{
        package_id: 91,
        package_token: "starter-package-token",
        stripe_checkout_session_id: "cs_pkg_test_123",
        buyer_name: "Package Buyer",
        buyer_email: "buyer@example.com",
        buyer_phone: "555-0111",
        notes: "Please keep sessions on weekday evenings.",
        form_submission_json: JSON.stringify({
          templateId: "21",
          responses: ["Rocket", "Build confidence around other dogs"]
        })
      }]),
      rows([]),
      [[] as unknown[], {}],
      rows([]),
      [[] as unknown[], { insertId: 12 }],
      [[] as unknown[], { insertId: 7001 }],
      [[] as unknown[], { insertId: 9001 }],
      [[] as unknown[], { insertId: 9002 }],
      rows([
        {
          id: 9001,
          appointment_type_id: 401,
          total_credits: 4
        },
        {
          id: 9002,
          appointment_type_id: 402,
          total_credits: 2
        }
      ]),
      [[] as unknown[], { insertId: 8101 }],
      [[] as unknown[], { insertId: 8102 }],
      rows([]),
      [[] as unknown[], { insertId: 8801 }],
      rows([]),
      [[] as unknown[], { insertId: 8802 }],
      rows([]),
      [[] as unknown[], { insertId: 8803 }],
      [[] as unknown[], { affectedRows: 1 }],
      [[] as unknown[], {}],
      rows([{ id: 7001, client_id: 12 }]),
      [[] as unknown[], { affectedRows: 1 }]
    ]);

    const dependencies = createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      stripeClient
    });

    const packageItem = await dependencies.publicPackages.findPublicPackageByToken("starter-package-token");
    if (packageItem == null) {
      throw new Error("Expected a public package to be returned.");
    }

    const checkoutSession = await dependencies.publicPackages.createPublicPackagePaymentSession?.({
      packageItem,
      buyerName: "Package Buyer",
      buyerEmail: "buyer@example.com",
      buyerPhone: "555-0111",
      notes: "Please keep sessions on weekday evenings.",
      successUrl: "https://portal.example.test/package/success",
      cancelUrl: "https://portal.example.test/package/cancel"
    });

    await dependencies.publicPackages.storePendingPublicPackagePurchase?.({
      packageId: packageItem.id,
      packageToken: packageItem.shareToken ?? "",
      stripeCheckoutSessionId: "cs_pkg_test_123",
      buyerName: "Package Buyer",
      buyerEmail: "buyer@example.com",
      buyerPhone: "555-0111",
      notes: "Please keep sessions on weekday evenings.",
      formSubmission: {
        templateId: "21",
        responses: ["Rocket", "Build confidence around other dogs"]
      }
    });

    const pendingPurchase = await dependencies.publicPackages.findPendingPublicPackagePurchase?.("91", "cs_pkg_test_123");
    const fetchedSession = await dependencies.publicPackages.fetchPublicPackagePaymentSession?.("cs_pkg_test_123");

    const purchase = await dependencies.publicPackages.finalizePublicPackagePurchase({
      packageItem,
      buyerName: "Package Buyer",
      buyerEmail: "buyer@example.com",
      buyerPhone: "555-0111",
      notes: "Please keep sessions on weekday evenings.",
      paymentMethod: "credit_card",
      stripeCheckoutSessionId: "cs_pkg_test_123",
      stripePaymentIntentId: "pi_pkg_test_123"
    });
    const repeatedPurchase = await dependencies.publicPackages.finalizePublicPackagePurchase({
      packageItem,
      buyerName: "Package Buyer",
      buyerEmail: "buyer@example.com",
      buyerPhone: "555-0111",
      notes: "Please keep sessions on weekday evenings.",
      paymentMethod: "credit_card",
      stripeCheckoutSessionId: "cs_pkg_test_123",
      stripePaymentIntentId: "pi_pkg_test_123"
    });

    await dependencies.publicPackages.deletePendingPublicPackagePurchase?.("91", "cs_pkg_test_123");

    expect(checkoutSession).toMatchObject({
      sessionId: "cs_pkg_test_123",
      checkoutUrl: "https://checkout.stripe.test/cs_pkg_test_123"
    });
    expect(pendingPurchase).toMatchObject({
      packageId: "91",
      packageToken: "starter-package-token",
      stripeCheckoutSessionId: "cs_pkg_test_123",
      buyerEmail: "buyer@example.com",
      formSubmission: {
        templateId: "21",
        responses: ["Rocket", "Build confidence around other dogs"]
      }
    });
    expect(fetchedSession).toMatchObject({
      sessionId: "cs_pkg_test_123",
      paymentStatus: "paid",
      amountTotal: 32500,
      packageId: "91",
      packageToken: "starter-package-token",
      paymentIntentId: "pi_pkg_test_123"
    });
    expect(purchase).toEqual({
      clientId: "12",
      clientPackageId: "7001"
    });
    expect(repeatedPurchase).toEqual({
      clientId: "12",
      clientPackageId: "7001"
    });

    expect(executor.calls[2]?.sql).toContain("INSERT INTO package_pending_purchases");
    expect(executor.calls[3]?.sql).toContain("FROM package_pending_purchases");
    expect(executor.calls[4]?.sql).toContain("FROM client_packages");
    expect(executor.calls[5]?.sql).toBe("START TRANSACTION");
    expect(executor.calls[7]?.sql).toContain("INSERT INTO clients");
    expect(executor.calls[8]?.sql).toContain("INSERT INTO client_packages");
    expect(executor.calls[8]?.params?.[4]).toBe("Please keep sessions on weekday evenings.");
    expect(executor.calls[8]?.params?.[5]).toBe("credit_card");
    expect(executor.calls[8]?.params?.[6]).toBe("cs_pkg_test_123");
    expect(executor.calls[14]?.sql).toContain("FROM invoices");
    expect(executor.calls[15]?.sql).toContain("INSERT INTO invoices");
    expect(executor.calls[16]?.sql).toContain("FROM invoice_items");
    expect(executor.calls[17]?.sql).toContain("INSERT INTO invoice_items");
    expect(executor.calls[18]?.sql).toContain("FROM invoice_payments");
    expect(executor.calls[19]?.sql).toContain("INSERT INTO invoice_payments");
    expect(executor.calls[20]?.sql).toContain("UPDATE invoices");
    expect(executor.calls[21]?.sql).toBe("COMMIT");
    expect(executor.calls[22]?.sql).toContain("FROM client_packages");
    expect(executor.calls[23]?.sql).toContain("DELETE FROM package_pending_purchases");
  });

  it("creates Stripe-backed portal invoice payment sessions through legacy invoice tables", async () => {
    const stripeClient = {
      createCheckoutSession: vi.fn(async () => ({
        sessionId: "cs_invoice_test_123",
        checkoutUrl: "https://checkout.stripe.test/invoice-401",
        expiresAt: "2026-05-27T19:00:00.000Z",
        paymentStatus: "unpaid",
        amountTotal: 12500,
        paymentIntentId: null,
        metadata: {
          invoice_id: "401",
          client_id: "12"
        }
      })),
      fetchCheckoutSession: vi.fn(async () => null)
    };

    const executor = new FakeSqlExecutor([
      rows([{
        id: 401,
        client_id: 12,
        status: "sent",
        total_amount: 225,
        outstanding_amount: 125,
        due_at: "2026-05-29T00:00:00.000Z"
      }]),
      rows([{
        email: "buyer@example.com"
      }])
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      stripeClient
    }));

    const session = {
      actorId: "12",
      actorType: "portal_user" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const result = await runtime.handlers.handlePortalInvoicePaymentSession(session, "401", {
      returnUrl: "https://portal.example.test/portal/payments/complete",
      cancelUrl: "https://portal.example.test/portal/invoices"
    });

    expect(result.status).toBe(200);
    if ("error" in result.body) {
      throw new Error("Expected successful invoice payment session response.");
    }
    expect(result.body.invoice.id).toBe("401");
    expect(result.body.paymentSession.provider).toBe("stripe");
    expect(result.body.paymentSession.checkoutUrl).toBe("https://checkout.stripe.test/invoice-401");
    expect(result.body.paymentSession.expiresAt).toBe("2026-05-27T19:00:00.000Z");
    expect(executor.calls[0]?.sql).toContain("FROM invoices");
    expect(executor.calls[1]?.sql).toContain("SELECT email");
    expect(stripeClient.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      amountTotal: 12500,
      customerEmail: "buyer@example.com",
      itemName: "Invoice 401",
      metadata: {
        invoice_id: "401",
        client_id: "12"
      }
    }));
  });

  it("creates public-contact dependencies against legacy-aligned client note updates", async () => {
    const executor = new FakeSqlExecutor([
      rows([{
        id: 77,
        notes: "Existing note"
      }]),
      [[] as unknown[], { affectedRows: 1 }]
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      captchaVerifier: async () => true
    }));

    const result = await runtime.handlers.handlePublicContact({
      name: "Attempted Update Name",
      email: "CONTACT-EXISTING@EXAMPLE.COM",
      phone: "555-2200",
      service: "walking",
      message: "Second message from existing contact.",
      turnstileToken: "turnstile-ok"
    });

    expect(result.status).toBe(200);
    expect(executor.calls).toHaveLength(2);
    expect(executor.calls[0]?.sql).toContain("SELECT id, notes");
    expect(executor.calls[0]?.sql).toContain("FROM clients");
    expect(executor.calls[1]?.sql).toContain("UPDATE clients");
    expect(String(executor.calls[1]?.params?.[0] ?? "")).toContain("Existing note");
    expect(String(executor.calls[1]?.params?.[0] ?? "")).toContain("Service interested in: walking");
    expect(String(executor.calls[1]?.params?.[0] ?? "")).toContain("Message: Second message from existing contact.");
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

  it("accepts legacy PHP bcrypt hashes for admin login", async () => {
    const phpBcryptHash = (await bcryptHash("correct-password", 10)).replace("$2b$", "$2y$");
    const executor = new FakeSqlExecutor([
      rows([{ id: 1, username: "admin", password_hash: phpBcryptHash, account_type: "main" }])
    ]);
    const runtime = buildApiRuntime(
      createMySqlApiDependencies(executor, {
        now: () => "2026-07-08T21:30:00.000Z",
        captchaVerifier: async () => true
      })
    );

    const result = await runtime.handlers.handleAdminLogin({
      username: "admin",
      password: "correct-password"
    });

    expect(result.status).toBe(200);
    expect(executor.calls[0]?.sql).toContain("FROM admin_users");
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
        price: 325,
        description: "Starter support",
        bullet_points: "Four sessions\nHomework notes",
        expiration_days: 120,
        share_token: "starter-package-token",
        portal_available: 1,
        form_template_id: null
      }]),
      rows([{
        package_id: 91,
        appointment_type_id: 401,
        quantity: 4,
        appointment_type_name: "Private Lesson"
      }]),
      rows([{
        id: 91,
        name: "Starter Package",
        is_active: 1,
        price: 325,
        description: "Starter support",
        bullet_points: "Four sessions\nHomework notes",
        expiration_days: 120,
        share_token: "starter-package-token",
        portal_available: 1,
        form_template_id: null
      }]),
      rows([{
        package_id: 91,
        appointment_type_id: 401,
        quantity: 4,
        appointment_type_name: "Private Lesson"
      }]),
      rows([{
        id: 7001,
        client_id: 12,
        package_id: 91,
        appointment_type_id: 401,
        total_credits: 6,
        used_credits: 2
      }]),
      rows([{
        id: 7001,
        client_id: 12,
        package_id: 91,
        appointment_type_id: 401,
        total_credits: 6,
        used_credits: 2
      }]),
      rows([{
        id: 91,
        name: "Starter Package",
        is_active: 1,
        price: 325,
        description: "Starter support",
        bullet_points: "Four sessions\nHomework notes",
        expiration_days: 120,
        share_token: "starter-package-token",
        portal_available: 1,
        form_template_id: null
      }]),
      rows([{
        package_id: 91,
        appointment_type_id: 401,
        quantity: 4,
        appointment_type_name: "Private Lesson"
      }]),
      rows([{
        id: 91,
        name: "Starter Package",
        is_active: 1,
        price: 325,
        description: "Starter support",
        bullet_points: "Four sessions\nHomework notes",
        expiration_days: 120,
        share_token: "starter-package-token",
        portal_available: 1,
        form_template_id: null
      }]),
      rows([{
        package_id: 91,
        appointment_type_id: 401,
        quantity: 4,
        appointment_type_name: "Private Lesson"
      }]),
      rows([{
        id: 7001,
        client_id: 12,
        package_id: 91,
        appointment_type_id: 401,
        total_credits: 6,
        used_credits: 2
      }]),
      rows([{
        id: 7001,
        client_id: 12,
        package_id: 91,
        appointment_type_id: 401,
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
    if ("error" in portalCredits.body || "error" in portalCredit.body || "error" in adminCredits.body || "error" in adminCredit.body) {
      throw new Error("Expected successful credit resource responses.");
    }
    expect(portalCredits.body.items[0]?.appointmentTypeId).toBe("401");
    expect(portalCredit.body.item.appointmentTypeId).toBe("401");
    expect(adminCredits.body.items[0]?.appointmentTypeId).toBe("401");
    expect(adminCredit.body.item.appointmentTypeId).toBe("401");
    expect(executor.calls[0]?.sql).toContain("FROM packages");
    expect(executor.calls[0]?.sql).toContain("JOIN client_packages");
    expect(executor.calls[1]?.sql).toContain("FROM package_items");
    expect(executor.calls[2]?.sql).toContain("WHERE cp.client_id = ? AND p.id = ?");
    expect(executor.calls[3]?.sql).toContain("FROM package_items");
    expect(executor.calls[4]?.sql).toContain("FROM client_package_credits");
    expect(executor.calls[4]?.sql).toContain("JOIN client_packages");
    expect(executor.calls[5]?.sql).toContain("WHERE cpc.client_id = ? AND cpc.id = ?");
    expect(executor.calls[6]?.sql).toContain("FROM packages");
    expect(executor.calls[7]?.sql).toContain("FROM package_items");
    expect(executor.calls[8]?.sql).toContain("WHERE id = ?");
    expect(executor.calls[9]?.sql).toContain("FROM package_items");
    expect(executor.calls[10]?.sql).toContain("FROM client_package_credits");
    expect(executor.calls[11]?.sql).toContain("WHERE cpc.id = ?");
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
        pet_sitting_notes: "Use the side gate and towel paws before re-entry.",
        is_active: 1
      }]),
      rows([{
        id: 51,
        client_id: 12,
        name: "Buddy",
        species: "Dog",
        pet_sitting_notes: "Use the side gate and towel paws before re-entry.",
        is_active: 1
      }]),
      rows([{
        id: 51,
        client_id: 12,
        name: "Buddy",
        species: "Dog",
        pet_sitting_notes: "Use the side gate and towel paws before re-entry.",
        is_active: 1
      }]),
      rows([{
        id: 51,
        client_id: 12,
        name: "Buddy",
        species: "Dog",
        pet_sitting_notes: "Use the side gate and towel paws before re-entry.",
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
    if ("error" in portalPets.body || "error" in portalPet.body || "error" in adminPets.body || "error" in adminPet.body) {
      throw new Error("Expected successful pet responses.");
    }
    expect(portalPets.body.items[0]?.petSittingNotes).toBe("Use the side gate and towel paws before re-entry.");
    expect(portalPet.body.item.petSittingNotes).toBe("Use the side gate and towel paws before re-entry.");
    expect(adminPets.body.items[0]?.petSittingNotes).toBe("Use the side gate and towel paws before re-entry.");
    expect(adminPet.body.item.petSittingNotes).toBe("Use the side gate and towel paws before re-entry.");
    expect(executor.calls[0]?.sql).toContain("FROM pets");
    expect(executor.calls[0]?.sql).toContain("pet_sitting_notes");
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

  it("creates workflow management dependencies against workflow tables", async () => {
    const executor = new FakeSqlExecutor([
      rows([{
        workflow_id: "workflow-1",
        workflow_name: "Welcome Series",
        workflow_description: "Client onboarding flow.",
        workflow_trigger: "manual",
        active: 1,
        created_at: "2026-05-27T18:00:00.000Z",
        enrollment_count: 2,
        active_enrollment_count: 1
      }]),
      rows([{
        workflow_id: "workflow-1",
        workflow_name: "Welcome Series",
        workflow_description: "Client onboarding flow.",
        workflow_trigger: "manual",
        active: 1,
        created_at: "2026-05-27T18:00:00.000Z"
      }]),
      rows([{
        workflow_enrollment_id: "workflow-enrollment-1",
        workflow_id: "workflow-1",
        client_id: "12",
        enrolled_at: "2026-05-27T18:00:00.000Z",
        next_run_at: "2026-05-28T18:00:00.000Z",
        completed_at: null,
        status: "active",
        enrolled_by: "admin-1",
        cancelled_at: null,
        client_name: "Client One",
        client_email: "client@example.com",
        enrolled_by_name: "brook"
      }]),
      rows([{
        workflow_id: "workflow-1",
        workflow_name: "Welcome Series",
        workflow_description: "Client onboarding flow.",
        workflow_trigger: "manual",
        active: 1,
        created_at: "2026-05-27T18:00:00.000Z"
      }]),
      rows([{
        id: 12,
        name: "Client One",
        email: "client@example.com",
        already_enrolled: 1
      }])
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));

    const adminSession = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "owner" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T19:00:00.000Z"
    };

    const workflowList = await runtime.handlers.handleAdminWorkflows(adminSession);
    const workflowEnrollments = await runtime.handlers.handleAdminWorkflowEnrollments(adminSession, "workflow-1");
    const enrollableClients = await runtime.handlers.handleAdminWorkflowEnrollableClients(adminSession, "workflow-1");

    expect(workflowList.status).toBe(200);
    expect(workflowEnrollments.status).toBe(200);
    expect(enrollableClients.status).toBe(200);
    expect("items" in workflowList.body && workflowList.body.items[0]?.enrollmentCount).toBe(2);
    expect("items" in workflowEnrollments.body && workflowEnrollments.body.items[0]?.clientName).toBe("Client One");
    expect("items" in enrollableClients.body && enrollableClients.body.items[0]?.alreadyEnrolled).toBe(true);
    expect(executor.calls[0]?.sql).toContain("FROM workflows w");
    expect(executor.calls[0]?.sql).toContain("LEFT JOIN workflow_enrollments we ON we.workflow_id = w.workflow_id");
    expect(executor.calls[2]?.sql).toContain("FROM workflow_enrollments we");
    expect(executor.calls[2]?.sql).toContain("INNER JOIN clients c ON c.id = we.client_id");
    expect(executor.calls[4]?.sql).toContain("SELECT c.id, c.name, c.email");
    expect(executor.calls[4]?.sql).toContain("SELECT 1 FROM workflow_enrollments we");
  });

  it("creates workflow step management dependencies against workflow step tables", async () => {
    const workflowRow = {
      workflow_id: "workflow-1",
      workflow_name: "Welcome Series",
      workflow_description: "Client onboarding flow.",
      workflow_trigger: "manual",
      active: 1,
      created_at: "2026-05-27T18:00:00.000Z"
    };
    const workflowStepRow = {
      workflow_step_id: "workflow-step-1",
      workflow_id: "workflow-1",
      step_order: 1,
      step_name: "Welcome Email",
      email_subject: "Welcome {client_name}",
      email_body_html: "<p>Hello {client_name}</p>",
      email_body_text: "Hello {client_name}",
      delay_type: "after_enrollment",
      delay_value: "2 hours",
      scheduled_date: null,
      attach_contract_id: "contract-template-1",
      attach_form_id: "form-template-1",
      attach_quote_id: "quote-1",
      attach_invoice_id: "invoice-1",
      include_appointment_link: 1,
      appointment_type_id: "appointment-type-1",
      created_at: "2026-05-27T18:00:00.000Z",
      updated_at: "2026-05-27T18:30:00.000Z"
    };
    const executor = new FakeSqlExecutor([
      rows([workflowRow]),
      rows([workflowStepRow]),
      rows([workflowRow]),
      rows([workflowStepRow]),
      rows([{ id: 11, name: "Starter Contract" }]),
      rows([{ id: 21, name: "Intake Form" }]),
      rows([{ id: 31, name: "Consultation" }]),
      rows([{
        id: 41,
        quote_number: "Q-1001",
        title: "Starter Package",
        client_name: "Client One"
      }]),
      rows([{
        id: 51,
        invoice_number: "INV-1001",
        client_name: "Client One",
        total_amount: 225
      }]),
      rows([{
        id: 61,
        name: "Workflow Welcome Template",
        subject: "Template Subject",
        body_html: "<p>Template Html</p>",
        body_text: "Template Text"
      }]),
      rows([{
        schedule_type: "interval",
        schedule_value: "90"
      }])
    ]);

    const runtime = buildApiRuntime(createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }));

    const adminSession = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "owner" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T19:00:00.000Z"
    };

    const workflowSteps = await runtime.handlers.handleAdminWorkflowSteps(adminSession, "workflow-1");
    const workflowStepEditor = await runtime.handlers.handleAdminWorkflowStepEditor(
      adminSession,
      "workflow-1",
      "workflow-step-1"
    );

    expect(workflowSteps.status).toBe(200);
    expect(workflowStepEditor.status).toBe(200);
    expect("items" in workflowSteps.body && workflowSteps.body.items[0]?.stepName).toBe("Welcome Email");
    expect("options" in workflowStepEditor.body && workflowStepEditor.body.options.contractTemplates[0]?.label).toBe("Starter Contract");
    expect("options" in workflowStepEditor.body && workflowStepEditor.body.options.emailTemplates[0]?.subject).toBe("Template Subject");
    expect("options" in workflowStepEditor.body && workflowStepEditor.body.options.processorIntervalMinutes).toBe(90);
    expect(executor.calls[1]?.sql).toContain("FROM workflow_steps");
    expect(executor.calls[3]?.sql).toContain("WHERE workflow_id = ? AND workflow_step_id = ?");
    expect(executor.calls[4]?.sql).toBe("SELECT id, name FROM contract_templates WHERE COALESCE(is_active, 1) = 1 ORDER BY name ASC");
    expect(executor.calls[5]?.sql).toBe("SELECT id, name FROM form_templates WHERE COALESCE(is_active, 1) = 1 ORDER BY name ASC");
    expect(executor.calls[6]?.sql).toBe("SELECT id, name FROM appointment_types WHERE COALESCE(is_active, 1) = 1 ORDER BY name ASC");
    expect(executor.calls[10]?.sql).toContain("FROM scheduled_tasks");
  });

  it("exposes bootstrap DDL for persistent outbox and job queue tables", () => {
    const statements = getMySqlBootstrapStatements();

    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS settings"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS integration_callbacks"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS email_outbox"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS job_queue"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS package_pending_purchases"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS calendar_sync_links"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS workflows"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS workflow_enrollments"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS workflow_triggers"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS workflow_steps"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS workflow_step_executions"))).toBe(true);
    expect(statements).toContain(
      "ALTER TABLE settings ADD COLUMN category VARCHAR(64) NOT NULL DEFAULT 'general' AFTER setting_type"
    );
    expect(statements).toContain(
      "ALTER TABLE settings ADD COLUMN label VARCHAR(255) NOT NULL DEFAULT '' AFTER category"
    );
    expect(statements).toContain(
      "ALTER TABLE settings ADD COLUMN description TEXT NULL AFTER label"
    );
    expect(statements).toContain(
      "ALTER TABLE settings ADD COLUMN is_secret TINYINT(1) NOT NULL DEFAULT 0 AFTER description"
    );
    expect(statements).toContain(
      "ALTER TABLE settings ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER is_secret"
    );
    expect(statements.some((sql) => sql.includes("INSERT INTO settings (setting_key, setting_value, setting_type, category, label, description, is_secret, updated_at)"))).toBe(true);
    expect(statements.some((sql) => sql.includes("UPDATE settings SET setting_type ="))).toBe(true);
    expect(statements.some((sql) => sql.includes("'smtp_password'"))).toBe(true);
    expect(statements.some((sql) => sql.includes("'google_calendar_enabled'"))).toBe(true);
    expect(statements.some((sql) => sql.includes("'newsletter_embed_html'"))).toBe(true);
    expect(statements).toContain(
      "ALTER TABLE workflows ADD COLUMN workflow_description TEXT NULL AFTER workflow_name"
    );
    expect(statements).toContain(
      "ALTER TABLE workflow_enrollments ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active' AFTER completed_at"
    );
    expect(statements).toContain(
      "ALTER TABLE workflow_enrollments ADD COLUMN enrolled_by VARCHAR(128) NULL AFTER status"
    );
    expect(statements).toContain(
      "ALTER TABLE workflow_enrollments ADD COLUMN cancelled_at TIMESTAMP NULL AFTER enrolled_by"
    );
    expect(statements.some((sql) => sql.includes("CREATE INDEX idx_integration_callbacks_provider_received_at"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE INDEX idx_calendar_sync_links_provider_synced_at"))).toBe(true);
    expect(statements).toContain(
      "CREATE INDEX idx_inbound_emails_provider_message_id ON inbound_emails(provider(16), message_id(170))"
    );
    expect(statements).toContain(
      "CREATE INDEX idx_inbound_emails_message_id ON inbound_emails(message_id(170))"
    );
    expect(statements.some((sql) => sql.includes("CREATE INDEX idx_workflows_active_trigger"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE INDEX idx_workflow_enrollments_run_at"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE INDEX idx_workflow_triggers_workflow"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE INDEX idx_workflow_triggers_match"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE INDEX idx_workflow_steps_workflow_order"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE INDEX idx_workflow_step_executions_due"))).toBe(true);
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

  it("creates admin configuration dependencies against appointment_types, email_templates, and scheduled_tasks tables", async () => {
    const executor = new FakeSqlExecutor([
      rows([{
        id: 51,
        name: "Private Coaching",
        description: "One-on-one coaching session.",
        bullet_points: "Behavior assessment\nHomework plan",
        admin_user_id: 1,
        duration_minutes: 90,
        buffer_before_minutes: 15,
        buffer_after_minutes: 15,
        use_travel_time_buffer: 1,
        travel_time_minutes: 20,
        advance_booking_min_days: 2,
        advance_booking_max_days: 45,
        cancellation_notice_hours: 24,
        requires_forms: 1,
        form_template_ids: "11,12",
        requires_contract: 1,
        contract_template_id: 21,
        auto_invoice: 1,
        invoice_due_days: 7,
        invoice_due_timing: "after",
        default_amount: 225,
        consumes_credits: 1,
        credit_count: 2,
        is_group_class: 0,
        max_participants: 1,
        is_active: 1,
        public_available: 1,
        portal_available: 1,
        schedule_type: "recurring",
        specific_date: null,
        specific_dates: "[]",
        available_days: "[1,2,3,4,5]",
        available_start_time: "09:00",
        available_end_time: "17:00",
        time_slot_interval: 30,
        is_mini_session: 0,
        mini_session_location: null,
        mini_session_topic: null,
        is_field_rental: 0,
        field_rental_location: null,
        group_class_location: null,
        per_day_schedule: "{\"1\":{\"start\":\"09:00\",\"end\":\"17:00\"}}",
        location_types: "[\"client_address\",\"phone_inbound\"]",
        confirmation_template_id: 61,
        booking_request_template_id: 62,
        invoice_template_id: 63,
        reminder_template_id: 64,
        cancellation_template_id: 65,
        requires_admin_confirmation: 1,
        uses_resource: 1,
        resource_name: "Trainer Vehicle",
        resource_capacity: 1,
        resource_allocation: "per_appointment",
        unique_link: "private-coaching-link",
        created_at: "2026-05-27T16:00:00.000Z",
        updated_at: "2026-05-27T17:00:00.000Z"
      }]),
      [[] as unknown[], { insertId: 52 }],
      [[] as unknown[], { affectedRows: 1 }],
      [[] as unknown[], { affectedRows: 1 }],
      [[] as unknown[], { insertId: 1 }],
      [[] as unknown[], { affectedRows: 1 }],
      [[] as unknown[], { affectedRows: 1 }],
      [[] as unknown[], { insertId: 1 }],
      rows([{
        id: 61,
        name: "Booking Confirmation",
        template_type: "booking_confirmation",
        subject: "Confirmed",
        body_html: "<p>Confirmed.</p>",
        body_text: "Confirmed.",
        is_active: 1,
        created_at: "2026-05-27T16:00:00.000Z",
        updated_at: "2026-05-27T17:00:00.000Z"
      }]),
      [[] as unknown[], { insertId: 62 }],
      [[] as unknown[], { affectedRows: 1 }],
      rows([{
        id: 71,
        task_name: "Workflow Processor",
        task_type: "workflow_processor",
        schedule_type: "interval",
        schedule_value: "60",
        is_active: 1,
        last_run: "2026-05-27T17:00:00.000Z",
        next_run: "2026-05-27T18:00:00.000Z"
      }]),
      [[] as unknown[], { insertId: 72 }],
      [[] as unknown[], { affectedRows: 1 }]
    ]);

    const dependencies = createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    }) as Record<string, unknown>;
    const adminConfiguration = dependencies.adminConfiguration as Record<string, (...args: unknown[]) => Promise<unknown>>;

    const appointmentTypes = await adminConfiguration.listAdminAppointmentTypes();
    await adminConfiguration.createAdminAppointmentType("admin-1", {
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
      formTemplateIds: ["11"],
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
      confirmationTemplateId: "61",
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
    });
    await adminConfiguration.updateAdminAppointmentType("51", "admin-1", {
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
      confirmationTemplateId: "61",
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
    });
    const emailTemplates = await adminConfiguration.listAdminEmailTemplates();
    await adminConfiguration.createAdminEmailTemplate("admin-1", {
      name: "Reminder Template",
      templateType: "booking_reminder",
      subject: "Reminder",
      bodyHtml: "<p>Reminder.</p>",
      bodyText: "Reminder.",
      active: true
    });
    await adminConfiguration.updateAdminEmailTemplate("61", "admin-1", {
      name: "Booking Confirmation Updated",
      templateType: "booking_confirmation",
      subject: "Updated",
      bodyHtml: "<p>Updated.</p>",
      bodyText: "Updated.",
      active: false
    });
    const scheduledTasks = await adminConfiguration.listAdminScheduledTasks();
    await adminConfiguration.createAdminScheduledTask("admin-1", {
      name: "Inbox Poller",
      taskType: "email_receiver",
      scheduleType: "custom",
      scheduleValue: "*/5 * * * *",
      active: true
    });
    await adminConfiguration.updateAdminScheduledTask("71", "admin-1", {
      name: "Workflow Processor Revised",
      taskType: "workflow_processor",
      scheduleType: "interval",
      scheduleValue: "30",
      active: true
    });

    expect(Array.isArray(appointmentTypes)).toBe(true);
    expect(Array.isArray(emailTemplates)).toBe(true);
    expect(Array.isArray(scheduledTasks)).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("FROM appointment_types"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("INSERT INTO appointment_types"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("UPDATE appointment_types SET"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("appointment_type_forms"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("FROM email_templates"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("INSERT INTO email_templates"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("UPDATE email_templates SET"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("FROM scheduled_tasks"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("INSERT INTO scheduled_tasks"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("UPDATE scheduled_tasks SET"))).toBe(true);
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

  it("accepts signed raw Stripe checkout callbacks with a settings-backed webhook secret", async () => {
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
    const signature = createHmac("sha256", "whsec_live_validation")
      .update(`${timestamp}.${rawBody}`, "utf8")
      .digest("hex");

    const executor = new FakeSqlExecutor([
      rows([{
        setting_key: "stripe_webhook_secret",
        setting_value: "whsec_live_validation"
      }]),
      [[] as unknown[], { affectedRows: 1 }],
      [[] as unknown[], { insertId: 9007 }]
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
      rawBody,
      signature: `t=${timestamp},v1=${signature}`,
      payload: JSON.parse(rawBody) as Record<string, unknown>
    });

    expect(result.status).toBe(202);
    expect(executor.calls[0]?.sql).toContain("FROM settings");
    expect(executor.calls[1]?.sql).toContain("UPDATE invoices SET status = ?");
    expect(executor.calls[2]?.sql).toContain("INSERT INTO integration_callbacks");
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
      rows([]),
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
    expect(executor.calls[1]?.sql).toContain("FROM quote_items");
    expect(executor.calls[2]?.sql).toContain("FROM contracts");
    expect(executor.calls[3]?.sql).toContain("FROM form_submissions");
    expect(executor.calls[4]?.sql).toContain("FROM bookings");
  });

  it("uses legacy-compatible contract and form submission columns for portal commerce updates", async () => {
    const executor = new FakeSqlExecutor([
      [[] as unknown[], { affectedRows: 1 }],
      rows([]),
      rows([]),
      [[] as unknown[], { affectedRows: 0 }],
      rows([]),
      rows([])
    ]);

    const dependencies = createMySqlApiDependencies(executor, {
      now: () => "2026-05-27T18:00:00.000Z",
      portalBaseUrl: "https://portal.example.test/portal",
      captchaVerifier: async () => true,
      passwordVerifier: async () => true
    });

    await dependencies.portalCommerce.signPortalContract("12", "601");
    await dependencies.portalCommerce.submitPortalForm("12", "701");

    expect(executor.calls[0]?.sql).toContain("SET status = 'signed', signed_date = CURRENT_TIMESTAMP");
    expect(executor.calls[3]?.sql).toContain("SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP");
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
        template_name: "Follow-up Note",
        form_type: "follow_up_note",
        template_is_internal: 1,
        template_show_in_client_portal: 1,
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
    if ("error" in forms.body) {
      throw new Error("Expected successful admin form response.");
    }
    expect(executor.calls[0]?.sql).toContain("FROM invoices");
    expect(executor.calls[1]?.sql).toContain("FROM quotes");
    expect(executor.calls[2]?.sql).toContain("FROM contracts");
    expect(executor.calls[3]?.sql).toContain("FROM form_submissions");
    expect(executor.calls[3]?.sql).toContain("LEFT JOIN form_templates");
    expect(forms.body.items[0]?.templateName).toBe("Follow-up Note");
    expect(forms.body.items[0]?.clientReviewSubmission).toBe(true);
    expect(forms.body.items[0]?.templateShowInClientPortal).toBe(true);
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
