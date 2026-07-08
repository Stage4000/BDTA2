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
  "settings",
  "workflows",
  "workflow_triggers",
  "workflow_steps",
  "workflow_step_executions",
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

export const launchPreflightRuntimeSchema = z.enum(["api", "jobs", "web"]);

export const launchPreflightEnvironmentAuditSchema = z.object({
  runtime: launchPreflightRuntimeSchema,
  requiredVariables: z.array(z.string().min(1)).min(1),
  missingVariables: z.array(z.string().min(1))
});

export const launchPreflightRuntimeTableAuditSchema = z.object({
  table: z.string().min(1),
  purpose: z.string().min(1),
  required: z.boolean(),
  exists: z.boolean()
});

export const launchPreflightRuntimeConfigAuditSchema = z.object({
  runtime: launchPreflightRuntimeSchema,
  valid: z.boolean(),
  issues: z.array(z.string().min(1))
});

export const launchPreflightProviderSchema = z.enum([
  "stripe",
  "turnstile",
  "imap",
  "smtp",
  "google_oauth"
]);

export const launchPreflightProviderAuditSchema = z.object({
  provider: launchPreflightProviderSchema,
  configured: z.boolean(),
  liveModeReady: z.boolean(),
  mode: z.enum(["live", "test", "synthetic", "n/a", "unknown"]),
  issues: z.array(z.string().min(1))
});

export const launchPreflightOperationalAreaSchema = z.enum([
  "backups",
  "monitoring",
  "error_logging"
]);

export const launchPreflightOperationalAuditSchema = z.object({
  area: launchPreflightOperationalAreaSchema,
  ready: z.boolean(),
  issues: z.array(z.string().min(1))
});

export const launchPreflightReportSchema = z.object({
  executedAt: timestampSchema,
  cutoverReport: cutoverRehearsalReportSchema,
  environmentAudits: z.array(launchPreflightEnvironmentAuditSchema).min(1),
  runtimeConfigAudits: z.array(launchPreflightRuntimeConfigAuditSchema).min(1),
  providerAudits: z.array(launchPreflightProviderAuditSchema).min(1),
  operationalAudits: z.array(launchPreflightOperationalAuditSchema).min(1),
  runtimeTableAudits: z.array(launchPreflightRuntimeTableAuditSchema).min(1),
  blockingIssues: z.array(z.string()),
  readyForLaunch: z.boolean()
});

export const bootstrapStatementAuditSchema = z.object({
  order: z.number().int().positive(),
  statement: z.string().min(1),
  executed: z.boolean()
});

export const cutoverExecutionReportSchema = z.object({
  executedAt: timestampSchema,
  applyBootstrap: z.boolean(),
  requireReady: z.boolean(),
  preflightReport: launchPreflightReportSchema,
  bootstrapStatementAudits: z.array(bootstrapStatementAuditSchema),
  blockingIssues: z.array(z.string()),
  executionBlocked: z.boolean(),
  bootstrapApplied: z.boolean()
});

export type MigrationEntity = z.infer<typeof migrationEntitySchema>;
export type LegacyMapping = z.infer<typeof legacyMappingSchema>;
export type TokenizedPublicLinkMigration = z.infer<typeof tokenizedPublicLinkMigrationSchema>;
export type CutoverRehearsal = z.infer<typeof cutoverRehearsalSchema>;
export type LegacyMappingAudit = z.infer<typeof legacyMappingAuditSchema>;
export type TokenizedPublicLinkAudit = z.infer<typeof tokenizedPublicLinkAuditSchema>;
export type CutoverRehearsalReport = z.infer<typeof cutoverRehearsalReportSchema>;
export type LaunchPreflightRuntime = z.infer<typeof launchPreflightRuntimeSchema>;
export type LaunchPreflightEnvironmentAudit = z.infer<typeof launchPreflightEnvironmentAuditSchema>;
export type LaunchPreflightRuntimeConfigAudit = z.infer<typeof launchPreflightRuntimeConfigAuditSchema>;
export type LaunchPreflightProvider = z.infer<typeof launchPreflightProviderSchema>;
export type LaunchPreflightProviderAudit = z.infer<typeof launchPreflightProviderAuditSchema>;
export type LaunchPreflightOperationalArea = z.infer<typeof launchPreflightOperationalAreaSchema>;
export type LaunchPreflightOperationalAudit = z.infer<typeof launchPreflightOperationalAuditSchema>;
export type LaunchPreflightRuntimeTableAudit = z.infer<typeof launchPreflightRuntimeTableAuditSchema>;
export type LaunchPreflightReport = z.infer<typeof launchPreflightReportSchema>;
export type BootstrapStatementAudit = z.infer<typeof bootstrapStatementAuditSchema>;
export type CutoverExecutionReport = z.infer<typeof cutoverExecutionReportSchema>;
