import { runReleaseCli } from "../apps/release/src/cli.js";

function createReport(overrides: Partial<{
  validationReadinessPassed: boolean;
  liveLaunchReadinessPassed: boolean;
  readyForLaunch: boolean;
}> = {}) {
  return {
    generatedAt: "2026-06-06T18:00:00.000Z",
    repoRoot: "C:\\repo\\refactor",
    artifactRoot: "C:\\repo\\refactor\\reports\\release-validation\\2026-06-06",
    verification: [],
    legacyPhpTests: {
      total: 0,
      passed: 0,
      failed: 0,
      environmentBlocked: 0,
      behaviorFailures: 0,
      categoryCounts: {},
      results: []
    },
    legacyBehaviorReconciliation: {
      total: 0,
      reconciled: 0,
      unresolved: 0,
      items: []
    },
    screenshots: {
      mode: "playwright",
      total: 0,
      successful: 0,
      failures: 0,
      browserAcquisitionFailures: [],
      results: []
    },
    apiSmoke: {
      total: 0,
      passed: 0,
      failed: 0,
      results: []
    },
    databaseParity: [],
    featureParity: [],
    repositoryReadiness: {
      audits: [],
      blockingIssues: []
    },
    launchReadiness: {
      executedAt: "2026-06-06T18:00:00.000Z",
      applyBootstrap: false,
      requireReady: false,
      preflightReport: {
        executedAt: "2026-06-06T18:00:00.000Z",
        cutoverReport: {
          rehearsalId: "release-validation",
          dryRun: true,
          entitiesValidated: ["clients"],
          rollbackPlanDocumented: true,
          executedAt: "2026-06-06T18:00:00.000Z",
          entityAudits: [],
          tokenAudits: [],
          blockingIssues: [],
          readyForCutover: true
        },
        environmentAudits: [],
        runtimeConfigAudits: [],
        providerAudits: [],
        operationalAudits: [],
        runtimeTableAudits: [],
        blockingIssues: [],
        readyForLaunch: false
      },
      bootstrapStatementAudits: [],
      blockingIssues: [],
      executionBlocked: false,
      bootstrapApplied: false
    },
    releaseReadiness: {
      readyForValidation: true,
      readyForLiveLaunch: false,
      liveLaunchEvaluated: false,
      validationBlockingIssues: [],
      liveLaunchBlockingIssues: ["Synthetic validation values are in use."],
      liveLaunchEvaluationNotes: ["Synthetic validation values are in use for: stripe."],
      validationWarnings: ["Synthetic validation values are in use for: stripe."],
      syntheticProviders: ["stripe"]
    },
    summary: {
      typecheckPassed: true,
      testsPassed: true,
      buildPassed: true,
      productionDependencyAuditPassed: true,
      legacyPhpPassed: false,
      legacyPhpBehaviorPassed: false,
      legacyPhpBehaviorReconciled: true,
      screenshotsPassed: true,
      apiSmokePassed: true,
      databaseParityPassed: true,
      featureParityPassed: true,
      repositoryReadinessPassed: true,
      validationReadinessPassed: true,
      liveLaunchReadinessEvaluated: false,
      liveLaunchReadinessPassed: false,
      readyForLaunch: false,
      ...overrides
    }
  };
}

describe("release cli", () => {
  it("returns success when validation readiness passes even if live launch readiness is false", async () => {
    const outputs: string[] = [];

    const exitCode = await runReleaseCli({
      writeLine(line) {
        outputs.push(line);
      },
      runReleaseValidation: async () => ({
        report: createReport({ validationReadinessPassed: true, liveLaunchReadinessPassed: false }),
        reportPath: "C:\\repo\\refactor\\reports\\release-validation\\2026-06-06\\REPORT.md"
      })
    });

    expect(exitCode).toBe(0);
    expect(outputs).toEqual(["C:\\repo\\refactor\\reports\\release-validation\\2026-06-06\\REPORT.md"]);
  });

  it("returns a nonzero exit code when validation readiness fails", async () => {
    const exitCode = await runReleaseCli({
      writeLine() {
        return undefined;
      },
      runReleaseValidation: async () => ({
        report: createReport({ validationReadinessPassed: false }),
        reportPath: "C:\\repo\\refactor\\reports\\release-validation\\2026-06-06\\REPORT.md"
      })
    });

    expect(exitCode).toBe(1);
  });
});
