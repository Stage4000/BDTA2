import {
  cutoverRehearsalReportSchema,
  cutoverRehearsalSchema,
  legacyMappingSchema,
  tokenizedPublicLinkMigrationSchema
} from "@bdta/contracts";

export const defaultLegacyMappings = legacyMappingSchema.array().parse([
  { entity: "clients", legacyTable: "clients", targetAggregate: "clientProfiles", preservesIds: true },
  { entity: "pets", legacyTable: "pets", targetAggregate: "pets", preservesIds: true },
  { entity: "bookings", legacyTable: "bookings", targetAggregate: "bookings", preservesIds: true },
  { entity: "invoices", legacyTable: "invoices", targetAggregate: "invoices", preservesIds: true },
  { entity: "quotes", legacyTable: "quotes", targetAggregate: "quotes", preservesIds: true },
  { entity: "contracts", legacyTable: "contracts", targetAggregate: "contracts", preservesIds: true },
  { entity: "forms", legacyTable: "form_submissions", targetAggregate: "formSubmissions", preservesIds: true },
  { entity: "packages", legacyTable: "packages", targetAggregate: "packages", preservesIds: true },
  { entity: "credits", legacyTable: "client_package_credits", targetAggregate: "credits", preservesIds: true },
  { entity: "workflows", legacyTable: "workflows", targetAggregate: "workflows", preservesIds: true },
  { entity: "scheduled_tasks", legacyTable: "scheduled_tasks", targetAggregate: "scheduledTasks", preservesIds: true },
  { entity: "notifications", legacyTable: "notifications", targetAggregate: "notifications", preservesIds: true },
  { entity: "admin_users", legacyTable: "admin_users", targetAggregate: "adminUsers", preservesIds: true }
]);

export const defaultTokenizedPublicLinkMappings = tokenizedPublicLinkMigrationSchema.array().parse([
  { resourceKind: "quote", legacyIdentifierField: "id", tokenField: "access_token", required: true },
  { resourceKind: "contract", legacyIdentifierField: "id", tokenField: "access_token", required: true },
  { resourceKind: "form_submission", legacyIdentifierField: "id", tokenField: "access_token", required: true },
  { resourceKind: "booking_ical", legacyIdentifierField: "id", tokenField: "ical_token", required: true }
]);

export type MigrationAuditDependencies = {
  now(): string;
  countLegacyRows(table: string): Promise<number>;
  countRowsMissingToken(table: string, tokenField: string): Promise<number>;
};

const tokenLegacyTables = {
  quote: "quotes",
  contract: "contracts",
  form_submission: "form_submissions",
  booking_ical: "bookings"
} as const;

export async function buildCutoverRehearsalReport(
  rehearsal: {
    rehearsalId: string;
    dryRun: boolean;
    rollbackPlanDocumented: boolean;
  },
  dependencies: MigrationAuditDependencies
) {
  const parsedRehearsal = cutoverRehearsalSchema.parse({
    ...rehearsal,
    entitiesValidated: defaultLegacyMappings.map((mapping) => mapping.entity)
  });

  const entityAudits = await Promise.all(defaultLegacyMappings.map(async (mapping) => ({
    ...mapping,
    legacyRowCount: await dependencies.countLegacyRows(mapping.legacyTable)
  })));

  const tokenAudits = await Promise.all(defaultTokenizedPublicLinkMappings.map(async (mapping) => {
    const legacyTable = tokenLegacyTables[mapping.resourceKind];
    return {
      ...mapping,
      legacyTable,
      legacyRowCount: await dependencies.countLegacyRows(legacyTable),
      missingTokenCount: await dependencies.countRowsMissingToken(legacyTable, mapping.tokenField)
    };
  }));

  const blockingIssues: string[] = [];

  if (!parsedRehearsal.rollbackPlanDocumented) {
    blockingIssues.push("Rollback plan is not documented.");
  }

  for (const audit of tokenAudits) {
    if (audit.required && audit.missingTokenCount > 0) {
      blockingIssues.push(`Required public-link tokens are missing for ${audit.resourceKind} records.`);
    }
  }

  return cutoverRehearsalReportSchema.parse({
    ...parsedRehearsal,
    executedAt: dependencies.now(),
    entityAudits,
    tokenAudits,
    blockingIssues,
    readyForCutover: blockingIssues.length === 0
  });
}
