import path from "node:path";

import {
  buildLatestReleaseManifest,
  resolveReleaseArtifactRoot,
  resolveReleaseRunDate
} from "../apps/release/src/artifacts.js";

describe("release artifacts", () => {
  it("derives the release run date from the current timestamp when no override is provided", () => {
    const runDate = resolveReleaseRunDate({
      now: new Date("2026-06-06T18:00:00.000Z")
    });

    expect(runDate).toBe("2026-06-06");
  });

  it("uses an explicit release date override when provided", () => {
    const runDate = resolveReleaseRunDate({
      now: new Date("2026-06-06T18:00:00.000Z"),
      overrideDate: "2026-06-10"
    });

    expect(runDate).toBe("2026-06-10");
  });

  it("rejects invalid release date overrides", () => {
    expect(() => resolveReleaseRunDate({
      now: new Date("2026-06-06T18:00:00.000Z"),
      overrideDate: "06/10/2026"
    })).toThrow("Invalid RELEASE_VALIDATION_DATE value.");
  });

  it("builds dated artifact roots and latest manifest paths", () => {
    const refactorRoot = "C:\\repo\\refactor";
    const artifactRoot = resolveReleaseArtifactRoot(refactorRoot, {
      now: new Date("2026-06-06T18:00:00.000Z")
    });
    const latestManifest = buildLatestReleaseManifest({
      artifactRoot,
      generatedAt: "2026-06-06T18:00:00.000Z"
    });

    expect(artifactRoot).toBe(path.join(refactorRoot, "reports", "release-validation", "2026-06-06"));
    expect(latestManifest).toEqual({
      generatedAt: "2026-06-06T18:00:00.000Z",
      artifactRoot: path.join(refactorRoot, "reports", "release-validation", "2026-06-06"),
      reportPath: path.join(refactorRoot, "reports", "release-validation", "2026-06-06", "REPORT.md"),
      reportJsonPath: path.join(refactorRoot, "reports", "release-validation", "2026-06-06", "report.json")
    });
  });
});
