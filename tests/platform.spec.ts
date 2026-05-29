import { listApiContracts } from "../apps/api/src/index.js";
import { buildJobRuntime, hasJobKind } from "../apps/jobs/src/index.js";
import { webRuntimeManifest } from "../apps/web/src/index.js";
import { parseRuntimeEnvironment, providerCapabilities } from "@bdta/platform";

describe("platform foundation", () => {
  it("exposes the expected application surfaces", () => {
    expect(webRuntimeManifest.surfaces.adminCrm.parityCritical).toBe(true);
    expect(webRuntimeManifest.routeGroups.customerPortal).toContain("/portal/invoices");
  });

  it("parses the runtime providers required by the scope", () => {
    const result = parseRuntimeEnvironment({
      NODE_ENV: "test",
      DATABASE_URL: "mysql://user:pass@localhost:3306/bdta",
      STRIPE_SECRET_KEY: "sk_test_123",
      TURNSTILE_SECRET_KEY: "ts_123",
      IMAP_HOST: "imap.example.com",
      SMTP_HOST: "smtp.example.com",
      GOOGLE_OAUTH_CLIENT_ID: "client-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "client-secret"
    });

    expect(result.NODE_ENV).toBe("test");
    expect(providerCapabilities.payments).toContain("stripe");
    expect(providerCapabilities.inboundEmail).toContain("mail_provider");
  });

  it("registers API and job capabilities from the scope", () => {
    expect(listApiContracts()).toContain("publicBooking");
    expect(hasJobKind("invoice_reminder")).toBe(true);
    expect(hasJobKind("unsupported")).toBe(false);
    const runtime = buildJobRuntime({
      now: () => "2026-05-27T18:00:00.000Z",
      claimDueJobs: async () => [],
      completeJob: async () => undefined,
      failJob: async () => undefined,
      claimQueuedEmails: async () => [],
      sendEmail: async () => undefined,
      markEmailSent: async () => undefined,
      markEmailFailed: async () => undefined,
      handlers: {}
    });
    expect(runtime.manifest.supportedJobKinds).toContain("workflow_processor");
  });
});
