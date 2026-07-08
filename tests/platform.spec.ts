import { listApiContracts } from "../apps/api/src/index.js";
import { buildJobRuntime, hasJobKind } from "../apps/jobs/src/index.js";
import { webRuntimeManifest } from "../apps/web/src/index.js";
import {
  buildLaunchReadinessAssessment,
  createManagedSettingsCatalog,
  createRequiredLaunchSettingsCatalog,
  indexSettingValues,
  installProcessLifecycleHandlers,
  loadEnvFileIfPresent,
  mergeEnvContent,
  managedSettingsCatalog,
  parseRuntimeEnvironment,
  providerCapabilities,
  requiredLaunchSettingsCatalog,
  resolveStartupEnvironment,
  updateEnvFileValues
} from "@bdta/platform";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

class FakeProcess extends EventEmitter {
  exitCode: number | undefined;
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("platform foundation", () => {
  it("exposes the expected application surfaces", () => {
    expect(webRuntimeManifest.surfaces.adminCrm.parityCritical).toBe(true);
    expect(webRuntimeManifest.routeGroups.customerPortal).toContain("/portal/invoices");
  });

  it("parses the runtime providers required by the scope", () => {
    const result = parseRuntimeEnvironment({
      NODE_ENV: "test",
      DB_HOST: "localhost",
      DB_PORT: "3306",
      DB_NAME: "bdta",
      DB_USER: "user",
      DB_PASSWORD: "pass",
      SESSION_LIFETIME_SECONDS: "7200"
    });

    expect(result.NODE_ENV).toBe("test");
    expect(result.databaseUrl).toBe("mysql://user:pass@localhost:3306/bdta");
    expect(result.sessionTtlSeconds).toBe(7200);
    expect(providerCapabilities.payments).toContain("stripe");
    expect(providerCapabilities.inboundEmail).toContain("mail_provider");
  });

  it("shares launch-setting definitions for synthetic validation and bootstrap defaults", () => {
    const managedCatalog = createManagedSettingsCatalog("2026-06-23T18:00:00.000Z");
    const syntheticCatalog = createRequiredLaunchSettingsCatalog("2026-06-23T18:00:00.000Z");
    const bootstrapCatalog = createRequiredLaunchSettingsCatalog("2026-06-23T18:00:00.000Z", "bootstrap");

    expect(managedSettingsCatalog.has("smtp_password")).toBe(true);
    expect(managedSettingsCatalog.has("newsletter_embed_html")).toBe(true);
    expect(managedSettingsCatalog.has("public_notice_enabled")).toBe(true);
    expect(managedSettingsCatalog.has("facebook_url")).toBe(true);
    expect(managedSettingsCatalog.has("custom_social_link_5_url")).toBe(true);
    expect(requiredLaunchSettingsCatalog.has("stripe_mode")).toBe(true);
    expect(requiredLaunchSettingsCatalog.has("newsletter_embed_html")).toBe(false);
    expect(managedCatalog.find((setting) => setting.key === "newsletter_embed_html")?.type).toBe("textarea");
    expect(managedCatalog.find((setting) => setting.key === "public_notice_text")?.type).toBe("textarea");
    expect(syntheticCatalog.find((setting) => setting.key === "stripe_mode")?.value).toBe("live");
    expect(bootstrapCatalog.find((setting) => setting.key === "stripe_mode")?.value).toBe("test");
    expect(bootstrapCatalog.find((setting) => setting.key === "stripe_enabled")?.value).toBe("0");
  });

  it("treats synthetic provider placeholders as validation-ready and defers live-launch evaluation", () => {
    const assessment = buildLaunchReadinessAssessment({
      environment: {
        BDTA_VALIDATION_ENV_MODE: "synthetic",
        DB_HOST: "db.internal",
        DB_PORT: "3306",
        DB_NAME: "bdta",
        DB_USER: "file-user",
        DB_PASSWORD: "file-password",
        BACKUP_PLAN_DOCUMENTED: "true",
        MONITORING_CONFIGURED: "true",
        ERROR_LOGGING_CONFIGURED: "true"
      },
      settings: indexSettingValues(createManagedSettingsCatalog("2026-06-23T18:00:00.000Z"))
    });

    expect(assessment.readyForValidation).toBe(true);
    expect(assessment.readyForLiveLaunch).toBe(false);
    expect(assessment.liveLaunchEvaluated).toBe(false);
    expect(assessment.syntheticProviders).toEqual([
      "stripe",
      "turnstile",
      "imap",
      "smtp",
      "google_oauth"
    ]);
    expect(assessment.validationWarnings).toEqual([
      "Synthetic validation values are in use for: stripe, turnstile, imap, smtp, google_oauth."
    ]);
    expect(assessment.liveLaunchEvaluationNotes).toEqual([
      "Synthetic validation values are in use for: stripe, turnstile, imap, smtp, google_oauth."
    ]);
    expect(assessment.liveLaunchBlockingIssues).toContain(
      "Provider readiness failed for stripe: Synthetic validation value is in use."
    );
  });

  it("treats disabled optional integrations as not applicable during live-launch readiness", () => {
    const settings = indexSettingValues(createManagedSettingsCatalog("2026-06-23T18:00:00.000Z"));
    settings.stripe_enabled = "0";
    settings.stripe_live_secret_key = "";
    settings.stripe_test_secret_key = "";
    settings.stripe_webhook_secret = "";
    settings.imap_enabled = "0";
    settings.imap_host = "";
    settings.google_calendar_enabled = "0";
    settings.google_oauth_client_id = "";
    settings.google_oauth_client_secret = "";

    const assessment = buildLaunchReadinessAssessment({
      environment: {
        DB_HOST: "db.internal",
        DB_PORT: "3306",
        DB_NAME: "bdta",
        DB_USER: "file-user",
        DB_PASSWORD: "file-password",
        BACKUP_PLAN_DOCUMENTED: "true",
        MONITORING_CONFIGURED: "true",
        ERROR_LOGGING_CONFIGURED: "true"
      },
      settings
    });

    expect(assessment.readyForValidation).toBe(true);
    expect(assessment.readyForLiveLaunch).toBe(true);
    expect(assessment.liveLaunchEvaluated).toBe(true);
    expect(assessment.providerAudits).toEqual(expect.arrayContaining([
      { provider: "stripe", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
      { provider: "imap", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
      { provider: "google_oauth", configured: true, liveModeReady: true, mode: "n/a", issues: [] }
    ]));
  });

  it("loads .env.production startup values when shell env is missing them", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bdta-startup-env-"));
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, ".env.production"), [
      "DB_HOST=db.internal",
      "DB_PORT=3306",
      "DB_NAME=bdta",
      "DB_USER=file-user",
      "DB_PASSWORD=file-password",
      "SESSION_LIFETIME_SECONDS=1209600"
    ].join("\n"), "utf8");

    const environment = await resolveStartupEnvironment({
      cwd: root,
      processEnv: {}
    });

    expect(environment.DB_HOST).toBe("db.internal");
    expect(environment.DB_NAME).toBe("bdta");
    expect(environment.DB_USER).toBe("file-user");
    expect(environment.DB_PASSWORD).toBe("file-password");
    expect(environment.SESSION_LIFETIME_SECONDS).toBe("1209600");
  });

  it("merges and persists .env.production updates for legacy database parity", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bdta-env-update-"));
    await mkdir(root, { recursive: true });
    const envFilePath = path.join(root, ".env.production");
    const templatePath = path.join(root, ".env.production.example");
    await writeFile(templatePath, [
      "# template",
      "DB_HOST=localhost",
      "DB_PORT=3306",
      "DB_NAME=bdta",
      "DB_USER=bdta_user",
      "DB_PASSWORD=template-password"
    ].join("\n"), "utf8");
    await writeFile(envFilePath, [
      "# runtime",
      "DB_HOST=db.internal",
      "DB_PORT=3307",
      "DB_NAME=bdta_runtime",
      "DB_USER=runtime_user",
      "DB_PASSWORD=runtime_password"
    ].join("\n"), "utf8");

    expect(mergeEnvContent("DB_HOST=old\n", {
      DB_HOST: "new-host",
      DB_PASSWORD: "value with spaces"
    })).toContain("DB_PASSWORD=\"value with spaces\"");

    await updateEnvFileValues({
      filePath: envFilePath,
      templateFilePath: templatePath,
      updates: {
        DB_HOST: "db.updated.internal",
        DB_PORT: "3306",
        DB_NAME: "bdta_updated",
        DB_USER: "updated_user",
        DB_PASSWORD: "updated password",
        DATABASE_URL: ""
      }
    });

    const values = await loadEnvFileIfPresent(envFilePath);
    expect(values.DB_HOST).toBe("db.updated.internal");
    expect(values.DB_PORT).toBe("3306");
    expect(values.DB_NAME).toBe("bdta_updated");
    expect(values.DB_USER).toBe("updated_user");
    expect(values.DB_PASSWORD).toBe("updated password");
    expect(values.DATABASE_URL).toBe("");
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

  it("installs signal handlers that shut down once and default to a success exit code", async () => {
    const fakeProcess = new FakeProcess();
    const shutdownCalls: string[] = [];

    installProcessLifecycleHandlers({
      processRef: fakeProcess,
      label: "bdta-api",
      shutdown: async () => {
        shutdownCalls.push("shutdown");
      }
    });

    fakeProcess.emit("SIGINT");
    fakeProcess.emit("SIGTERM");
    await flushAsyncWork();

    expect(shutdownCalls).toEqual(["shutdown"]);
    expect(fakeProcess.exitCode).toBe(0);
  });

  it("installs fatal error handlers that log and force a failure exit code", async () => {
    const fakeProcess = new FakeProcess();
    const shutdownCalls: string[] = [];
    const logged: unknown[][] = [];

    installProcessLifecycleHandlers({
      processRef: fakeProcess,
      label: "bdta-web",
      logger: {
        error: (...args: unknown[]) => {
          logged.push(args);
        }
      },
      shutdown: async () => {
        shutdownCalls.push("shutdown");
      }
    });

    fakeProcess.emit("unhandledRejection", new Error("boom"));
    await flushAsyncWork();

    expect(shutdownCalls).toEqual(["shutdown"]);
    expect(fakeProcess.exitCode).toBe(1);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.[0]).toBe("[bdta-web] fatal process error");
    expect(logged[0]?.[1]).toBeInstanceOf(Error);
  });
});
