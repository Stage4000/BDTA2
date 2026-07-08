import type { CutoverExecutionReport } from "@bdta/contracts";

import type { RepositoryReadinessAssessment } from "../apps/release/src/repository-readiness.js";
import { buildReleaseReadinessAssessment } from "../apps/release/src/release-readiness.js";

function createRepositoryReadiness(blockingIssues: string[] = []): RepositoryReadinessAssessment {
  return {
    audits: [],
    blockingIssues
  };
}

function createLaunchReadinessReport(
  overrides: Partial<CutoverExecutionReport["preflightReport"]> = {}
): CutoverExecutionReport {
  return {
    executedAt: "2026-06-05T18:00:00.000Z",
    applyBootstrap: false,
    requireReady: false,
    preflightReport: {
      executedAt: "2026-06-05T18:00:00.000Z",
      cutoverReport: {
        rehearsalId: "release-validation",
        dryRun: true,
        entitiesValidated: ["clients"],
        rollbackPlanDocumented: true,
        executedAt: "2026-06-05T18:00:00.000Z",
        entityAudits: [],
        tokenAudits: [],
        blockingIssues: [],
        readyForCutover: true
      },
      environmentAudits: [],
      runtimeConfigAudits: [
        { runtime: "api", valid: true, issues: [] },
        { runtime: "jobs", valid: true, issues: [] },
        { runtime: "web", valid: true, issues: [] }
      ],
      providerAudits: [
        { provider: "stripe", configured: true, liveModeReady: true, mode: "live", issues: [] },
        { provider: "turnstile", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
        { provider: "imap", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
        { provider: "smtp", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
        { provider: "google_oauth", configured: true, liveModeReady: true, mode: "n/a", issues: [] }
      ],
      operationalAudits: [
        { area: "backups", ready: true, issues: [] },
        { area: "monitoring", ready: true, issues: [] },
        { area: "error_logging", ready: true, issues: [] }
      ],
      runtimeTableAudits: [],
      blockingIssues: [],
      readyForLaunch: true,
      ...overrides
    },
    bootstrapStatementAudits: [],
    blockingIssues: overrides.blockingIssues ?? [],
    executionBlocked: false,
    bootstrapApplied: false
  };
}

describe("release readiness assessment", () => {
  it("treats synthetic provider values as validation-ready and defers live-launch evaluation", () => {
    const launchReadiness = createLaunchReadinessReport({
      providerAudits: [
        { provider: "stripe", configured: true, liveModeReady: false, mode: "synthetic", issues: ["Synthetic validation value is in use."] },
        { provider: "turnstile", configured: true, liveModeReady: false, mode: "synthetic", issues: ["Synthetic validation value is in use."] },
        { provider: "imap", configured: true, liveModeReady: false, mode: "synthetic", issues: ["Synthetic validation value is in use."] },
        { provider: "smtp", configured: true, liveModeReady: false, mode: "synthetic", issues: ["Synthetic validation value is in use."] },
        { provider: "google_oauth", configured: true, liveModeReady: false, mode: "synthetic", issues: ["Synthetic validation value is in use."] }
      ],
      blockingIssues: [
        "Provider readiness failed for stripe: Synthetic validation value is in use.",
        "Provider readiness failed for turnstile: Synthetic validation value is in use.",
        "Provider readiness failed for imap: Synthetic validation value is in use.",
        "Provider readiness failed for smtp: Synthetic validation value is in use.",
        "Provider readiness failed for google_oauth: Synthetic validation value is in use."
      ],
      readyForLaunch: false
    });

    const assessment = buildReleaseReadinessAssessment({
      repositoryReadiness: createRepositoryReadiness(),
      launchReadiness
    });

    expect(assessment.readyForValidation).toBe(true);
    expect(assessment.readyForLiveLaunch).toBe(false);
    expect(assessment.liveLaunchEvaluated).toBe(false);
    expect(assessment.validationBlockingIssues).toEqual([]);
    expect(assessment.liveLaunchBlockingIssues).toEqual(expect.arrayContaining([
      "Provider readiness failed for stripe: Synthetic validation value is in use."
    ]));
    expect(assessment.liveLaunchEvaluationNotes).toEqual(expect.arrayContaining([
      "Synthetic validation values are in use for: stripe, turnstile, imap, smtp, google_oauth."
    ]));
    expect(assessment.validationWarnings).toEqual(expect.arrayContaining([
      "Synthetic validation values are in use for: stripe, turnstile, imap, smtp, google_oauth."
    ]));
  });

  it("blocks validation when a provider is actually missing", () => {
    const launchReadiness = createLaunchReadinessReport({
      providerAudits: [
        { provider: "stripe", configured: false, liveModeReady: false, mode: "unknown", issues: ["Missing required STRIPE_SECRET_KEY environment variable."] },
        { provider: "turnstile", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
        { provider: "imap", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
        { provider: "smtp", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
        { provider: "google_oauth", configured: true, liveModeReady: true, mode: "n/a", issues: [] }
      ],
      blockingIssues: [
        "Provider readiness failed for stripe: Missing required STRIPE_SECRET_KEY environment variable."
      ],
      readyForLaunch: false
    });

    const assessment = buildReleaseReadinessAssessment({
      repositoryReadiness: createRepositoryReadiness(),
      launchReadiness
    });

    expect(assessment.readyForValidation).toBe(false);
    expect(assessment.readyForLiveLaunch).toBe(false);
    expect(assessment.liveLaunchEvaluated).toBe(true);
    expect(assessment.validationBlockingIssues).toEqual([
      "Provider readiness failed for stripe: Missing required STRIPE_SECRET_KEY environment variable."
    ]);
  });

  it("blocks validation when the admin settings catalog does not expose launch configuration", () => {
    const assessment = buildReleaseReadinessAssessment({
      repositoryReadiness: createRepositoryReadiness(),
      launchReadiness: createLaunchReadinessReport(),
      settingsCatalogBlockingIssues: [
        "Settings catalog is missing required launch setting: smtp_host."
      ]
    });

    expect(assessment.readyForValidation).toBe(false);
    expect(assessment.readyForLiveLaunch).toBe(false);
    expect(assessment.liveLaunchEvaluated).toBe(true);
    expect(assessment.validationBlockingIssues).toContain("Settings catalog is missing required launch setting: smtp_host.");
    expect(assessment.liveLaunchBlockingIssues).toContain("Settings catalog is missing required launch setting: smtp_host.");
  });
});
