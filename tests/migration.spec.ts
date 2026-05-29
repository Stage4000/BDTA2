import {
  buildCutoverRehearsalReport,
  defaultLegacyMappings,
  defaultTokenizedPublicLinkMappings,
  type MigrationAuditDependencies
} from "@bdta/application";

describe("migration rehearsal", () => {
  it("builds a ready cutover report when legacy counts and tokens validate cleanly", async () => {
    const rowCounts: Record<string, number> = {
      clients: 180,
      pets: 220,
      bookings: 340,
      invoices: 120,
      quotes: 46,
      contracts: 38,
      form_submissions: 96,
      packages: 8,
      client_package_credits: 74,
      workflows: 6,
      scheduled_tasks: 5,
      notifications: 18,
      admin_users: 4
    };
    const missingTokenCounts: Record<string, number> = {
      "quotes.access_token": 0,
      "contracts.access_token": 0,
      "form_submissions.access_token": 0,
      "bookings.ical_token": 0
    };
    const dependencies: MigrationAuditDependencies = {
      now: () => "2026-05-29T18:00:00.000Z",
      countLegacyRows: async (table) => rowCounts[table] ?? 0,
      countRowsMissingToken: async (table, field) => missingTokenCounts[`${table}.${field}`] ?? 0
    };

    const report = await buildCutoverRehearsalReport({
      rehearsalId: "rehearsal-1",
      dryRun: true,
      rollbackPlanDocumented: true
    }, dependencies);

    expect(report.rehearsalId).toBe("rehearsal-1");
    expect(report.readyForCutover).toBe(true);
    expect(report.entityAudits).toHaveLength(defaultLegacyMappings.length);
    expect(report.tokenAudits).toHaveLength(defaultTokenizedPublicLinkMappings.length);
    expect(report.entitiesValidated).toEqual(defaultLegacyMappings.map((mapping) => mapping.entity));
    expect(report.entityAudits.find((audit) => audit.entity === "clients")?.legacyRowCount).toBe(180);
    expect(report.tokenAudits.find((audit) => audit.resourceKind === "booking_ical")?.missingTokenCount).toBe(0);
    expect(report.blockingIssues).toEqual([]);
  });

  it("marks cutover blocked when rollback is undocumented or required access tokens are missing", async () => {
    const dependencies: MigrationAuditDependencies = {
      now: () => "2026-05-29T18:00:00.000Z",
      countLegacyRows: async (table) => table === "quotes" ? 4 : 1,
      countRowsMissingToken: async (table, field) => table === "quotes" && field === "access_token" ? 2 : 0
    };

    const report = await buildCutoverRehearsalReport({
      rehearsalId: "rehearsal-2",
      dryRun: false,
      rollbackPlanDocumented: false
    }, dependencies);

    expect(report.readyForCutover).toBe(false);
    expect(report.blockingIssues).toContain("Rollback plan is not documented.");
    expect(report.blockingIssues).toContain("Required public-link tokens are missing for quote records.");
    expect(report.tokenAudits.find((audit) => audit.resourceKind === "quote")?.missingTokenCount).toBe(2);
  });
});
