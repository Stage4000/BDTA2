import { createRequiredLaunchSettingsCatalog, buildSettingsCatalogAssessment } from "../apps/release/src/settings-catalog.js";

describe("settings catalog assessment", () => {
  it("passes when the admin settings catalog exposes every required launch setting", () => {
    const assessment = buildSettingsCatalogAssessment({
      settings: createRequiredLaunchSettingsCatalog("2026-06-01T18:00:00.000Z"),
      capturedPages: ["admin-settings", "admin-setting-detail"]
    });

    expect(assessment.ready).toBe(true);
    expect(assessment.blockingIssues).toEqual([]);
    expect(assessment.presentCount).toBe(assessment.totalRequired);
  });

  it("fails when a required launch setting is missing from the admin catalog", () => {
    const settings = createRequiredLaunchSettingsCatalog("2026-06-01T18:00:00.000Z")
      .filter((setting) => setting.key !== "smtp_host");

    const assessment = buildSettingsCatalogAssessment({
      settings,
      capturedPages: ["admin-settings", "admin-setting-detail"]
    });

    expect(assessment.ready).toBe(false);
    expect(assessment.blockingIssues).toContain("Settings catalog is missing required launch setting: smtp_host.");
  });

  it("fails when a secret launch setting is exposed as a non-secret field", () => {
    const settings = createRequiredLaunchSettingsCatalog("2026-06-01T18:00:00.000Z").map((setting) => (
      setting.key === "google_oauth_client_secret"
        ? { ...setting, secret: false }
        : setting
    ));

    const assessment = buildSettingsCatalogAssessment({
      settings,
      capturedPages: ["admin-settings", "admin-setting-detail"]
    });

    expect(assessment.ready).toBe(false);
    expect(assessment.blockingIssues).toContain("Settings catalog entry google_oauth_client_secret must be marked secret.");
  });
});
