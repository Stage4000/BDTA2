import { existsSync } from "node:fs";
import path from "node:path";

import { normalizeResolvedEnvironment, parsePositiveInteger } from "./environment.js";

export type LaunchReadinessRuntime = "api" | "jobs" | "web";
export type LaunchReadinessProvider = "stripe" | "turnstile" | "imap" | "smtp" | "google_oauth";
export type LaunchReadinessOperationalArea = "backups" | "monitoring" | "error_logging";

export type LaunchReadinessRuntimeConfigAudit = {
  runtime: LaunchReadinessRuntime;
  valid: boolean;
  issues: string[];
};

export type LaunchReadinessProviderAudit = {
  provider: LaunchReadinessProvider;
  configured: boolean;
  liveModeReady: boolean;
  mode: "live" | "test" | "synthetic" | "n/a" | "unknown";
  issues: string[];
};

export type LaunchReadinessOperationalAudit = {
  area: LaunchReadinessOperationalArea;
  ready: boolean;
  issues: string[];
};

export type LaunchReadinessAssessment = {
  runtimeConfigAudits: LaunchReadinessRuntimeConfigAudit[];
  providerAudits: LaunchReadinessProviderAudit[];
  operationalAudits: LaunchReadinessOperationalAudit[];
  validationBlockingIssues: string[];
  liveLaunchBlockingIssues: string[];
  liveLaunchEvaluated: boolean;
  liveLaunchEvaluationNotes: string[];
  validationWarnings: string[];
  readyForValidation: boolean;
  readyForLiveLaunch: boolean;
  syntheticProviders: LaunchReadinessProvider[];
};

export const defaultOperationsDocumentationPaths = {
  rollback: "docs/operations/rollback-plan.md",
  backups: "docs/operations/backup-plan.md",
  monitoring: "docs/operations/monitoring.md",
  errorLogging: "docs/operations/error-logging.md"
} as const;

export const syntheticProviderIssue = "Synthetic validation value is in use.";

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function buildSyntheticProviderWarning(syntheticProviders: LaunchReadinessProvider[]): string | null {
  return syntheticProviders.length === 0
    ? null
    : `Synthetic validation values are in use for: ${syntheticProviders.join(", ")}.`;
}

function readRequiredString(value: string | undefined, envName: string): string {
  if (value == null || value.trim() === "") {
    throw new Error(`Missing required ${envName} environment variable.`);
  }

  return value;
}

function readSettingValue(settings: Record<string, string>, key: string): string {
  return settings[key]?.trim() ?? "";
}

export function resolveConfiguredPortalBaseUrl(
  environment: Record<string, string | undefined>,
  settings: Record<string, string>
): string {
  const override = environment.PORTAL_BASE_URL?.trim() ?? "";
  if (override !== "") {
    return override;
  }

  const configuredBaseUrl = readSettingValue(settings, "base_url");
  if (configuredBaseUrl === "") {
    return "";
  }

  return `${configuredBaseUrl.replace(/\/$/, "")}/portal`;
}

function assertConfiguredPortalBaseUrl(value: string): void {
  if (value.trim() === "") {
    throw new Error("Missing configured portal base URL. Set settings.base_url or PORTAL_BASE_URL.");
  }
}

export function isSyntheticValidationEnvironment(environment: Record<string, string | undefined> | undefined): boolean {
  return (environment?.BDTA_VALIDATION_ENV_MODE?.trim().toLowerCase() ?? "") === "synthetic";
}

export function buildRuntimeConfigAudits(
  environment: Record<string, string | undefined> | undefined,
  settings: Record<string, string>
): LaunchReadinessRuntimeConfigAudit[] {
  const env = normalizeResolvedEnvironment(environment ?? {});
  const configuredPortalBaseUrl = resolveConfiguredPortalBaseUrl(env, settings);

  return [
    (() => {
      try {
        readRequiredString(env.DATABASE_URL, "DATABASE_URL");
        assertConfiguredPortalBaseUrl(configuredPortalBaseUrl);
        parsePositiveInteger(env.PORT, "PORT", 3000);
        parsePositiveInteger(env.SESSION_TTL_SECONDS, "SESSION_TTL_SECONDS", 60 * 60 * 24 * 14);
        return { runtime: "api" as const, valid: true, issues: [] as string[] };
      } catch (error) {
        return { runtime: "api" as const, valid: false, issues: [error instanceof Error ? error.message : String(error)] };
      }
    })(),
    (() => {
      try {
        readRequiredString(env.DATABASE_URL, "DATABASE_URL");
        assertConfiguredPortalBaseUrl(configuredPortalBaseUrl);
        parsePositiveInteger(env.JOB_POLL_INTERVAL_MS, "JOB_POLL_INTERVAL_MS", 30_000);
        parsePositiveInteger(env.JOB_BATCH_SIZE, "JOB_BATCH_SIZE", 25);
        parsePositiveInteger(env.EMAIL_BATCH_SIZE, "EMAIL_BATCH_SIZE", 25);
        return { runtime: "jobs" as const, valid: true, issues: [] as string[] };
      } catch (error) {
        return { runtime: "jobs" as const, valid: false, issues: [error instanceof Error ? error.message : String(error)] };
      }
    })(),
    (() => {
      try {
        readRequiredString(env.DATABASE_URL, "DATABASE_URL");
        parsePositiveInteger(env.PORT, "PORT", 3001);
        return { runtime: "web" as const, valid: true, issues: [] as string[] };
      } catch (error) {
        return { runtime: "web" as const, valid: false, issues: [error instanceof Error ? error.message : String(error)] };
      }
    })()
  ];
}

export function buildProviderAudits(
  environment: Record<string, string | undefined> | undefined,
  settings: Record<string, string>
): LaunchReadinessProviderAudit[] {
  const env = normalizeResolvedEnvironment(environment ?? {});
  const syntheticValidationEnvironment = isSyntheticValidationEnvironment(environment);
  const settingsSourceMissing = readSettingValue(settings, "__settings_source_missing") === "1";
  const stripeOverrideKey = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const stripeMode = readSettingValue(settings, "stripe_mode") || "test";
  const stripeEnabled = readSettingValue(settings, "stripe_enabled") === "1";
  const stripeKey = stripeOverrideKey !== ""
    ? stripeOverrideKey
    : stripeMode === "live"
      ? readSettingValue(settings, "stripe_live_secret_key")
      : readSettingValue(settings, "stripe_test_secret_key");
  const stripeWebhookSecret = (env.STRIPE_WEBHOOK_SECRET?.trim() ?? "") || readSettingValue(settings, "stripe_webhook_secret");
  const turnstileSiteKey = (env.TURNSTILE_SITE_KEY?.trim() ?? "") || readSettingValue(settings, "turnstile_site_key");
  const turnstileKey = (env.TURNSTILE_SECRET_KEY?.trim() ?? "") || readSettingValue(settings, "turnstile_secret_key");
  const imapEnabled = readSettingValue(settings, "imap_enabled") === "1";
  const imapHost = (env.IMAP_HOST?.trim() ?? "") || readSettingValue(settings, "imap_host");
  const smtpHost = (env.SMTP_HOST?.trim() ?? "") || readSettingValue(settings, "smtp_host");
  const googleCalendarEnabled = readSettingValue(settings, "google_calendar_enabled") === "1";
  const googleClientId = (env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "") || readSettingValue(settings, "google_oauth_client_id");
  const googleClientSecret = (env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "") || readSettingValue(settings, "google_oauth_client_secret");

  return [
    !settingsSourceMissing && !stripeEnabled && stripeOverrideKey === ""
      ? {
        provider: "stripe" as const,
        configured: true,
        liveModeReady: true,
        mode: "n/a" as const,
        issues: [] as string[]
      }
      : stripeKey === ""
      ? {
        provider: "stripe" as const,
        configured: false,
        liveModeReady: false,
        mode: "unknown" as const,
        issues: ["Missing required stripe settings."]
      }
      : stripeWebhookSecret === ""
        ? {
          provider: "stripe" as const,
          configured: false,
          liveModeReady: false,
          mode: "unknown" as const,
          issues: ["Missing required stripe settings."]
        }
        : syntheticValidationEnvironment
            ? {
              provider: "stripe" as const,
              configured: true,
              liveModeReady: false,
              mode: "synthetic" as const,
              issues: [syntheticProviderIssue]
            }
            : stripeKey.startsWith("sk_live_")
              ? {
                provider: "stripe" as const,
                configured: true,
                liveModeReady: true,
                mode: "live" as const,
                issues: [] as string[]
              }
              : stripeKey.startsWith("sk_test_")
                ? {
                  provider: "stripe" as const,
                  configured: true,
                  liveModeReady: false,
                  mode: "test" as const,
                  issues: ["Stripe secret key is configured in test mode."]
                }
                : {
                  provider: "stripe" as const,
                  configured: true,
                  liveModeReady: false,
                  mode: "unknown" as const,
                  issues: ["Stripe secret key format is unrecognized."]
                },
    turnstileKey === ""
      ? {
        provider: "turnstile" as const,
        configured: false,
        liveModeReady: false,
        mode: "unknown" as const,
        issues: ["Missing required turnstile settings."]
      }
      : turnstileSiteKey === ""
        ? {
          provider: "turnstile" as const,
          configured: false,
          liveModeReady: false,
          mode: "unknown" as const,
          issues: ["Missing required turnstile settings."]
        }
        : syntheticValidationEnvironment
          ? {
            provider: "turnstile" as const,
            configured: true,
            liveModeReady: false,
            mode: "synthetic" as const,
            issues: [syntheticProviderIssue]
          }
          : {
          provider: "turnstile" as const,
          configured: true,
          liveModeReady: true,
          mode: "n/a" as const,
          issues: [] as string[]
          },
    !settingsSourceMissing && !imapEnabled && (env.IMAP_HOST?.trim() ?? "") === ""
      ? {
        provider: "imap" as const,
        configured: true,
        liveModeReady: true,
        mode: "n/a" as const,
        issues: [] as string[]
      }
      : imapHost === ""
      ? {
        provider: "imap" as const,
        configured: false,
        liveModeReady: false,
        mode: "unknown" as const,
        issues: ["Missing required imap settings."]
      }
      : syntheticValidationEnvironment
          ? {
            provider: "imap" as const,
            configured: true,
            liveModeReady: false,
            mode: "synthetic" as const,
            issues: [syntheticProviderIssue]
          }
          : {
            provider: "imap" as const,
            configured: true,
            liveModeReady: true,
            mode: "n/a" as const,
            issues: [] as string[]
          },
    smtpHost === ""
      ? {
        provider: "smtp" as const,
        configured: false,
        liveModeReady: false,
        mode: "unknown" as const,
        issues: ["Missing required smtp settings."]
      }
      : syntheticValidationEnvironment
        ? {
          provider: "smtp" as const,
          configured: true,
          liveModeReady: false,
          mode: "synthetic" as const,
          issues: [syntheticProviderIssue]
        }
        : {
          provider: "smtp" as const,
          configured: true,
          liveModeReady: true,
          mode: "n/a" as const,
          issues: [] as string[]
        },
    (() => {
      if (!settingsSourceMissing
        && !googleCalendarEnabled
        && (env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "") === ""
        && (env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "") === "") {
        return {
          provider: "google_oauth" as const,
          configured: true,
          liveModeReady: true,
          mode: "n/a" as const,
          issues: [] as string[]
        };
      }

      const issues: string[] = [];
      if (googleClientId === "") {
        issues.push("Missing required google_oauth settings.");
      }
      if (googleClientSecret === "" && issues.length === 0) {
        issues.push("Missing required google_oauth settings.");
      }

      if (issues.length === 0 && syntheticValidationEnvironment) {
        return {
          provider: "google_oauth" as const,
          configured: true,
          liveModeReady: false,
          mode: "synthetic" as const,
          issues: [syntheticProviderIssue]
        };
      }

      return issues.length === 0
        ? {
          provider: "google_oauth" as const,
          configured: true,
          liveModeReady: true,
          mode: "n/a" as const,
          issues
        }
        : {
          provider: "google_oauth" as const,
          configured: false,
          liveModeReady: false,
          mode: "unknown" as const,
          issues
        };
    })()
  ];
}

function readExplicitDocumentationFlag(value: string | undefined): boolean | undefined {
  if (value == null) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "" || normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  return undefined;
}

function documentationExists(candidatePath: string | undefined, workspaceRoot: string): boolean {
  if (candidatePath == null || candidatePath.trim() === "") {
    return false;
  }

  return existsSync(path.resolve(workspaceRoot, candidatePath));
}

export function resolveDocumentationReadiness(
  environment: Record<string, string | undefined> | undefined,
  workspaceRoot: string,
  options: {
    explicitFlagName: string;
    pathName: string;
    defaultRelativePath: string;
  }
): boolean {
  const env = environment ?? {};
  const explicitFlag = readExplicitDocumentationFlag(env[options.explicitFlagName]);
  if (explicitFlag != null) {
    return explicitFlag;
  }

  if (documentationExists(env[options.pathName], workspaceRoot)) {
    return true;
  }

  return documentationExists(options.defaultRelativePath, workspaceRoot);
}

export function buildOperationalAudits(
  environment: Record<string, string | undefined> | undefined,
  workspaceRoot: string
): LaunchReadinessOperationalAudit[] {
  const backupPlanReady = resolveDocumentationReadiness(environment, workspaceRoot, {
    explicitFlagName: "BACKUP_PLAN_DOCUMENTED",
    pathName: "BACKUP_PLAN_PATH",
    defaultRelativePath: defaultOperationsDocumentationPaths.backups
  });
  const monitoringReady = resolveDocumentationReadiness(environment, workspaceRoot, {
    explicitFlagName: "MONITORING_CONFIGURED",
    pathName: "MONITORING_RUNBOOK_PATH",
    defaultRelativePath: defaultOperationsDocumentationPaths.monitoring
  });
  const errorLoggingReady = resolveDocumentationReadiness(environment, workspaceRoot, {
    explicitFlagName: "ERROR_LOGGING_CONFIGURED",
    pathName: "ERROR_LOGGING_RUNBOOK_PATH",
    defaultRelativePath: defaultOperationsDocumentationPaths.errorLogging
  });

  return [
    backupPlanReady
      ? {
        area: "backups" as const,
        ready: true,
        issues: [] as string[]
      }
      : {
        area: "backups" as const,
        ready: false,
        issues: ["Backup plan is not documented."]
      },
    monitoringReady
      ? {
        area: "monitoring" as const,
        ready: true,
        issues: [] as string[]
      }
      : {
        area: "monitoring" as const,
        ready: false,
        issues: ["Monitoring configuration is not documented."]
      },
    errorLoggingReady
      ? {
        area: "error_logging" as const,
        ready: true,
        issues: [] as string[]
      }
      : {
        area: "error_logging" as const,
        ready: false,
        issues: ["Error logging configuration is not documented."]
      }
  ];
}

function formatRuntimeBlockingIssue(audit: LaunchReadinessRuntimeConfigAudit, issue: string): string {
  return `Invalid runtime configuration for ${audit.runtime}: ${issue}`;
}

function formatProviderBlockingIssue(audit: LaunchReadinessProviderAudit, issue: string): string {
  return `Provider readiness failed for ${audit.provider}: ${issue}`;
}

function formatOperationalBlockingIssue(audit: LaunchReadinessOperationalAudit, issue: string): string {
  return `Operational readiness failed for ${audit.area}: ${issue}`;
}

export function buildLaunchReadinessAssessment(options: {
  environment?: Record<string, string | undefined>;
  settings: Record<string, string>;
  workspaceRoot?: string;
}): LaunchReadinessAssessment {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const runtimeConfigAudits = buildRuntimeConfigAudits(options.environment, options.settings);
  const providerAudits = buildProviderAudits(options.environment, options.settings);
  const operationalAudits = buildOperationalAudits(options.environment, workspaceRoot);
  const syntheticProviders = providerAudits
    .filter((audit) => audit.mode === "synthetic")
    .map((audit) => audit.provider);
  const runtimeBlockingIssues = runtimeConfigAudits
    .flatMap((audit) => audit.issues.map((issue) => formatRuntimeBlockingIssue(audit, issue)));
  const providerBlockingIssues = providerAudits
    .flatMap((audit) => audit.issues.map((issue) => formatProviderBlockingIssue(audit, issue)));
  const syntheticProviderBlockingIssues = new Set(
    providerAudits
      .filter((audit) => audit.mode === "synthetic" && audit.issues.every((issue) => issue === syntheticProviderIssue))
      .flatMap((audit) => audit.issues.map((issue) => formatProviderBlockingIssue(audit, issue)))
  );
  const operationalBlockingIssues = operationalAudits
    .flatMap((audit) => audit.issues.map((issue) => formatOperationalBlockingIssue(audit, issue)));
  const validationBlockingIssues = unique([
    ...runtimeBlockingIssues,
    ...providerBlockingIssues.filter((issue) => !syntheticProviderBlockingIssues.has(issue)),
    ...operationalBlockingIssues
  ]);
  const liveLaunchBlockingIssues = unique([
    ...runtimeBlockingIssues,
    ...providerBlockingIssues,
    ...operationalBlockingIssues
  ]);
  const nonSyntheticLiveLaunchBlockingIssues = liveLaunchBlockingIssues.filter((issue) => !syntheticProviderBlockingIssues.has(issue));
  const liveLaunchEvaluated = liveLaunchBlockingIssues.length === 0 || nonSyntheticLiveLaunchBlockingIssues.length > 0;
  const syntheticProviderWarning = buildSyntheticProviderWarning(syntheticProviders);

  return {
    runtimeConfigAudits,
    providerAudits,
    operationalAudits,
    validationBlockingIssues,
    liveLaunchBlockingIssues,
    liveLaunchEvaluated,
    liveLaunchEvaluationNotes: !liveLaunchEvaluated && syntheticProviderWarning != null
      ? [syntheticProviderWarning]
      : [],
    validationWarnings: syntheticProviderWarning == null
      ? []
      : [syntheticProviderWarning],
    readyForValidation: validationBlockingIssues.length === 0,
    readyForLiveLaunch: liveLaunchBlockingIssues.length === 0,
    syntheticProviders
  };
}

export function indexSettingValues(
  settings: Array<{ key: string; value: string | null | undefined }>
): Record<string, string> {
  return settings.reduce<Record<string, string>>((accumulator, setting) => {
    accumulator[setting.key] = setting.value?.trim() ?? "";
    return accumulator;
  }, {});
}
