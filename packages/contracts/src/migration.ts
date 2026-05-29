import { z } from "zod";

import { idSchema, timestampSchema } from "@bdta/domain";

export const migrationEntitySchema = z.enum([
  "clients",
  "pets",
  "bookings",
  "invoices",
  "quotes",
  "contracts",
  "forms",
  "packages",
  "credits",
  "workflows",
  "scheduled_tasks",
  "notifications",
  "admin_users"
]);

export const legacyMappingSchema = z.object({
  entity: migrationEntitySchema,
  legacyTable: z.string().min(1),
  targetAggregate: z.string().min(1),
  preservesIds: z.boolean()
});

export const tokenizedPublicLinkMigrationSchema = z.object({
  resourceKind: z.enum(["quote", "contract", "form_submission", "booking_ical"]),
  legacyIdentifierField: z.string().min(1),
  tokenField: z.string().min(1),
  required: z.boolean()
});

export const cutoverRehearsalSchema = z.object({
  rehearsalId: idSchema,
  dryRun: z.boolean(),
  entitiesValidated: z.array(migrationEntitySchema).min(1),
  rollbackPlanDocumented: z.boolean()
});

export const legacyMappingAuditSchema = legacyMappingSchema.extend({
  legacyRowCount: z.number().int().nonnegative()
});

export const tokenizedPublicLinkAuditSchema = tokenizedPublicLinkMigrationSchema.extend({
  legacyTable: z.string().min(1),
  legacyRowCount: z.number().int().nonnegative(),
  missingTokenCount: z.number().int().nonnegative()
});

export const cutoverRehearsalReportSchema = cutoverRehearsalSchema.extend({
  executedAt: timestampSchema,
  entityAudits: z.array(legacyMappingAuditSchema),
  tokenAudits: z.array(tokenizedPublicLinkAuditSchema),
  blockingIssues: z.array(z.string()),
  readyForCutover: z.boolean()
});

export type MigrationEntity = z.infer<typeof migrationEntitySchema>;
export type LegacyMapping = z.infer<typeof legacyMappingSchema>;
export type TokenizedPublicLinkMigration = z.infer<typeof tokenizedPublicLinkMigrationSchema>;
export type CutoverRehearsal = z.infer<typeof cutoverRehearsalSchema>;
export type LegacyMappingAudit = z.infer<typeof legacyMappingAuditSchema>;
export type TokenizedPublicLinkAudit = z.infer<typeof tokenizedPublicLinkAuditSchema>;
export type CutoverRehearsalReport = z.infer<typeof cutoverRehearsalReportSchema>;
