import type { CutoverExecutionReport } from "@bdta/contracts";

import type { RepositoryReadinessAssessment } from "./repository-readiness.js";

export type ReleaseReadinessAssessment = {
  readyForValidation: boolean;
  readyForLiveLaunch: boolean;
  liveLaunchEvaluated: boolean;
  validationBlockingIssues: string[];
  liveLaunchBlockingIssues: string[];
  liveLaunchEvaluationNotes: string[];
  validationWarnings: string[];
  syntheticProviders: Array<"stripe" | "turnstile" | "imap" | "smtp" | "google_oauth">;
};

const syntheticProviderIssue = "Synthetic validation value is in use.";

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function buildSyntheticProviderIssueSet(report: CutoverExecutionReport): Set<string> {
  return new Set(
    report.preflightReport.providerAudits
      .filter((audit) => audit.mode === "synthetic" && audit.issues.every((issue) => issue === syntheticProviderIssue))
      .flatMap((audit) => audit.issues.map((issue) => `Provider readiness failed for ${audit.provider}: ${issue}`))
  );
}

function buildSyntheticProviderWarning(
  syntheticProviders: ReleaseReadinessAssessment["syntheticProviders"]
): string | null {
  return syntheticProviders.length === 0
    ? null
    : `Synthetic validation values are in use for: ${syntheticProviders.join(", ")}.`;
}

export function buildReleaseReadinessAssessment(input: {
  repositoryReadiness: RepositoryReadinessAssessment;
  launchReadiness: CutoverExecutionReport;
  settingsCatalogBlockingIssues?: string[];
}): ReleaseReadinessAssessment {
  const syntheticProviders = input.launchReadiness.preflightReport.providerAudits
    .filter((audit) => audit.mode === "synthetic")
    .map((audit) => audit.provider);
  const syntheticProviderIssues = buildSyntheticProviderIssueSet(input.launchReadiness);
  const validationLaunchIssues = input.launchReadiness.blockingIssues.filter((issue) => !syntheticProviderIssues.has(issue));
  const validationBlockingIssues = unique([
    ...input.repositoryReadiness.blockingIssues,
    ...(input.settingsCatalogBlockingIssues ?? []),
    ...validationLaunchIssues
  ]);
  const liveLaunchBlockingIssues = unique([
    ...input.repositoryReadiness.blockingIssues,
    ...(input.settingsCatalogBlockingIssues ?? []),
    ...input.launchReadiness.blockingIssues
  ]);
  const nonSyntheticLiveLaunchBlockingIssues = liveLaunchBlockingIssues.filter((issue) => !syntheticProviderIssues.has(issue));
  const liveLaunchEvaluated = liveLaunchBlockingIssues.length === 0 || nonSyntheticLiveLaunchBlockingIssues.length > 0;
  const syntheticProviderWarning = buildSyntheticProviderWarning(syntheticProviders);

  return {
    readyForValidation: validationBlockingIssues.length === 0,
    readyForLiveLaunch: liveLaunchBlockingIssues.length === 0,
    liveLaunchEvaluated,
    validationBlockingIssues,
    liveLaunchBlockingIssues,
    liveLaunchEvaluationNotes: !liveLaunchEvaluated && syntheticProviderWarning != null
      ? [syntheticProviderWarning]
      : [],
    validationWarnings: syntheticProviderWarning == null
      ? []
      : [syntheticProviderWarning],
    syntheticProviders
  };
}
