import {
  bootstrapStatementAuditSchema,
  cutoverExecutionReportSchema,
  cutoverRehearsalReportSchema,
  cutoverRehearsalSchema,
  legacyMappingSchema,
  launchPreflightEnvironmentAuditSchema,
  launchPreflightOperationalAuditSchema,
  launchPreflightProviderAuditSchema,
  launchPreflightReportSchema,
  launchPreflightRuntimeConfigAuditSchema,
  launchPreflightRuntimeTableAuditSchema,
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
  { entity: "settings", legacyTable: "settings", targetAggregate: "settings", preservesIds: true },
  { entity: "workflows", legacyTable: "workflows", targetAggregate: "workflows", preservesIds: true },
  { entity: "workflow_triggers", legacyTable: "workflow_triggers", targetAggregate: "workflowTriggers", preservesIds: true },
  { entity: "workflow_steps", legacyTable: "workflow_steps", targetAggregate: "workflowSteps", preservesIds: true },
  { entity: "workflow_step_executions", legacyTable: "workflow_step_executions", targetAggregate: "workflowStepExecutions", preservesIds: true },
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

export type LaunchPreflightDependencies = MigrationAuditDependencies & {
  tableExists(table: string): Promise<boolean>;
};

export type CutoverExecutionDependencies = LaunchPreflightDependencies & {
  applyBootstrapStatement(statement: string): Promise<boolean>;
};

export const defaultLaunchPreflightEnvironmentRequirements = launchPreflightEnvironmentAuditSchema.array().parse([
  {
    runtime: "api",
    requiredVariables: ["DATABASE_URL"],
    missingVariables: []
  },
  {
    runtime: "jobs",
    requiredVariables: ["DATABASE_URL"],
    missingVariables: []
  },
  {
    runtime: "web",
    requiredVariables: ["DATABASE_URL"],
    missingVariables: []
  }
]);

export const defaultLaunchPreflightRuntimeConfigAudits = launchPreflightRuntimeConfigAuditSchema.array().parse([
  { runtime: "api", valid: true, issues: [] },
  { runtime: "jobs", valid: true, issues: [] },
  { runtime: "web", valid: true, issues: [] }
]);

export const defaultLaunchPreflightProviderAudits = launchPreflightProviderAuditSchema.array().parse([
  { provider: "stripe", configured: true, liveModeReady: true, mode: "live", issues: [] },
  { provider: "turnstile", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
  { provider: "imap", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
  { provider: "smtp", configured: true, liveModeReady: true, mode: "n/a", issues: [] },
  { provider: "google_oauth", configured: true, liveModeReady: true, mode: "n/a", issues: [] }
]);

export const defaultLaunchPreflightOperationalAudits = launchPreflightOperationalAuditSchema.array().parse([
  { area: "backups", ready: true, issues: [] },
  { area: "monitoring", ready: true, issues: [] },
  { area: "error_logging", ready: true, issues: [] }
]);

export const defaultLaunchPreflightRuntimeTables = launchPreflightRuntimeTableAuditSchema.array().parse([
  {
    table: "settings",
    purpose: "Admin-managed launch and provider configuration",
    required: true,
    exists: true
  },
  {
    table: "app_sessions",
    purpose: "Persisted admin and portal sessions",
    required: true,
    exists: true
  },
  {
    table: "email_outbox",
    purpose: "Queued outbound email delivery",
    required: true,
    exists: true
  },
  {
    table: "job_queue",
    purpose: "Background jobs and reminders",
    required: true,
    exists: true
  },
  {
    table: "inbound_emails",
    purpose: "Persisted inbound mailbox ingestion",
    required: true,
    exists: true
  },
  {
    table: "unmatched_emails",
    purpose: "Unmatched inbound email reconciliation",
    required: true,
    exists: true
  },
  {
    table: "integration_callbacks",
    purpose: "Provider webhook and callback receipts",
    required: true,
    exists: true
  },
  {
    table: "calendar_sync_links",
    purpose: "Google Calendar synchronization state",
    required: true,
    exists: true
  },
  {
    table: "workflows",
    purpose: "Workflow definitions",
    required: true,
    exists: true
  },
  {
    table: "workflow_enrollments",
    purpose: "Workflow enrollment processing",
    required: true,
    exists: true
  },
  {
    table: "workflow_triggers",
    purpose: "Workflow auto-enrollment trigger records",
    required: true,
    exists: true
  },
  {
    table: "workflow_steps",
    purpose: "Workflow step definitions and sequencing",
    required: true,
    exists: true
  },
  {
    table: "workflow_step_executions",
    purpose: "Workflow step execution queue and delivery history",
    required: true,
    exists: true
  }
]);

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

export async function buildLaunchPreflightReport(
  input: {
    rehearsalId: string;
    dryRun: boolean;
    rollbackPlanDocumented: boolean;
    runtimeConfigAudits?: Array<{
      runtime: "api" | "jobs" | "web";
      valid: boolean;
      issues: string[];
    }>;
    providerAudits?: Array<{
      provider: "stripe" | "turnstile" | "imap" | "smtp" | "google_oauth";
      configured: boolean;
      liveModeReady: boolean;
      mode: "live" | "test" | "synthetic" | "n/a" | "unknown";
      issues: string[];
    }>;
    operationalAudits?: Array<{
      area: "backups" | "monitoring" | "error_logging";
      ready: boolean;
      issues: string[];
    }>;
    environment?: Record<string, string | undefined>;
  },
  dependencies: LaunchPreflightDependencies
) {
  const cutoverReport = await buildCutoverRehearsalReport({
    rehearsalId: input.rehearsalId,
    dryRun: input.dryRun,
    rollbackPlanDocumented: input.rollbackPlanDocumented
  }, dependencies);

  const environment = input.environment ?? {};
  const runtimeConfigAudits = launchPreflightRuntimeConfigAuditSchema.array().parse(
    input.runtimeConfigAudits ?? defaultLaunchPreflightRuntimeConfigAudits
  );
  const providerAudits = launchPreflightProviderAuditSchema.array().parse(
    input.providerAudits ?? defaultLaunchPreflightProviderAudits
  );
  const operationalAudits = launchPreflightOperationalAuditSchema.array().parse(
    input.operationalAudits ?? defaultLaunchPreflightOperationalAudits
  );
  const environmentAudits = defaultLaunchPreflightEnvironmentRequirements.map((requirement) => ({
    runtime: requirement.runtime,
    requiredVariables: requirement.requiredVariables,
    missingVariables: requirement.requiredVariables.filter((variableName) => {
      const value = environment[variableName];
      return value == null || value.trim() === "";
    })
  }));

  const runtimeTableAudits = await Promise.all(defaultLaunchPreflightRuntimeTables.map(async (table) => ({
    ...table,
    exists: await dependencies.tableExists(table.table)
  })));

  const blockingIssues = [
    ...cutoverReport.blockingIssues,
    ...environmentAudits
      .filter((audit) => audit.missingVariables.length > 0)
      .map((audit) => `Missing required environment variables for ${audit.runtime}: ${audit.missingVariables.join(", ")}.`),
    ...runtimeConfigAudits
      .filter((audit) => !audit.valid)
      .flatMap((audit) => audit.issues.map((issue) => `Invalid runtime configuration for ${audit.runtime}: ${issue}`)),
    ...providerAudits
      .filter((audit) => !audit.configured || !audit.liveModeReady)
      .flatMap((audit) => audit.issues.map((issue) => `Provider readiness failed for ${audit.provider}: ${issue}`)),
    ...operationalAudits
      .filter((audit) => !audit.ready)
      .flatMap((audit) => audit.issues.map((issue) => `Operational readiness failed for ${audit.area}: ${issue}`)),
    ...runtimeTableAudits
      .filter((audit) => audit.required && !audit.exists)
      .map((audit) => `Required runtime table is missing: ${audit.table}.`)
  ];

  return launchPreflightReportSchema.parse({
    executedAt: cutoverReport.executedAt,
    cutoverReport,
    environmentAudits,
    runtimeConfigAudits,
    providerAudits,
    operationalAudits,
    runtimeTableAudits,
    blockingIssues,
    readyForLaunch: blockingIssues.length === 0
  });
}

export async function buildCutoverExecutionReport(
  input: {
    rehearsalId: string;
    dryRun: boolean;
    rollbackPlanDocumented: boolean;
    applyBootstrap: boolean;
    requireReady: boolean;
    bootstrapStatements: string[];
    runtimeConfigAudits?: Array<{
      runtime: "api" | "jobs" | "web";
      valid: boolean;
      issues: string[];
    }>;
    providerAudits?: Array<{
      provider: "stripe" | "turnstile" | "imap" | "smtp" | "google_oauth";
      configured: boolean;
      liveModeReady: boolean;
      mode: "live" | "test" | "synthetic" | "n/a" | "unknown";
      issues: string[];
    }>;
    operationalAudits?: Array<{
      area: "backups" | "monitoring" | "error_logging";
      ready: boolean;
      issues: string[];
    }>;
    environment?: Record<string, string | undefined>;
  },
  dependencies: CutoverExecutionDependencies
) {
  const preflightReport = await buildLaunchPreflightReport({
    rehearsalId: input.rehearsalId,
    dryRun: input.dryRun,
    rollbackPlanDocumented: input.rollbackPlanDocumented,
    runtimeConfigAudits: input.runtimeConfigAudits,
    providerAudits: input.providerAudits,
    operationalAudits: input.operationalAudits,
    environment: input.environment
  }, dependencies);

  const bootstrapStatementAudits = bootstrapStatementAuditSchema.array().parse(
    input.bootstrapStatements.map((statement, index) => ({
      order: index + 1,
      statement,
      executed: false
    }))
  );

  const blockingIssues = [...preflightReport.blockingIssues];
  const executionBlocked = input.applyBootstrap && input.requireReady && !preflightReport.readyForLaunch;

  if (executionBlocked) {
    blockingIssues.push("Launch preflight is not ready; bootstrap execution was blocked.");
  }

  if (input.applyBootstrap && !executionBlocked) {
    for (const audit of bootstrapStatementAudits) {
      audit.executed = await dependencies.applyBootstrapStatement(audit.statement);
    }
  }

  return cutoverExecutionReportSchema.parse({
    executedAt: dependencies.now(),
    applyBootstrap: input.applyBootstrap,
    requireReady: input.requireReady,
    preflightReport,
    bootstrapStatementAudits,
    blockingIssues,
    executionBlocked,
    bootstrapApplied: input.applyBootstrap && !executionBlocked
  });
}
