import path from "node:path";

export type LatestReleaseManifest = {
  generatedAt: string;
  artifactRoot: string;
  reportPath: string;
  reportJsonPath: string;
};

export function resolveReleaseRunDate(options?: {
  now?: Date;
  overrideDate?: string | undefined;
}): string {
  const overrideDate = options?.overrideDate?.trim();
  if (overrideDate != null && overrideDate !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(overrideDate)) {
      throw new Error("Invalid RELEASE_VALIDATION_DATE value.");
    }

    return overrideDate;
  }

  return (options?.now ?? new Date()).toISOString().slice(0, 10);
}

export function resolveReleaseArtifactRoot(refactorRoot: string, options?: {
  now?: Date;
  overrideDate?: string | undefined;
}): string {
  return path.join(
    refactorRoot,
    "reports",
    "release-validation",
    resolveReleaseRunDate(options)
  );
}

export function buildLatestReleaseManifest(input: {
  generatedAt: string;
  artifactRoot: string;
}): LatestReleaseManifest {
  return {
    generatedAt: input.generatedAt,
    artifactRoot: input.artifactRoot,
    reportPath: path.join(input.artifactRoot, "REPORT.md"),
    reportJsonPath: path.join(input.artifactRoot, "report.json")
  };
}
