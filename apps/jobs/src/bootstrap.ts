import {
  buildJobRuntime,
  jobRuntimeManifest
} from "./index.js";
import {
  processBookingReminderJob,
  type BookingReminderDependencies,
  processContractReminderJob,
  type ContractReminderDependencies,
  processFormReminderJob,
  type FormReminderDependencies,
  processInvoiceReminderJob,
  type InvoiceReminderDependencies,
  processInboundEmailReceiverJob,
  type InboundEmailProcessingDependencies,
  processQuoteReminderJob,
  type QuoteReminderDependencies,
  processScheduledEmailSenderJob,
  type ScheduledEmailSenderDependencies,
  processUnmatchedEmailCleanerJob,
  type UnmatchedEmailCleanerDependencies,
  processWorkflowProcessorJob,
  type WorkflowProcessorDependencies
} from "@bdta/application";
import {
  applyMySqlBootstrap,
  createMySqlJobProcessorDependencies,
  createMySqlPoolFromDatabaseUrl,
  resolveMySqlPortalBaseUrl,
  type SqlExecutor
} from "@bdta/infrastructure";
import type { Booking, Contract, FormSubmission, OutboundEmailMessage, Quote, UnmatchedEmail, Workflow, WorkflowEnrollment, WorkflowStep, WorkflowStepExecution } from "@bdta/domain";
import type { JobEnvelope, SupportedJobKind } from "@bdta/contracts";
import { randomUUID } from "node:crypto";

type BootstrapOptions = {
  executor: SqlExecutor;
  portalBaseUrl?: string;
  now?: () => string;
};

type WorkerPollOptions = BootstrapOptions & {
  jobBatchSize: number;
  emailBatchSize: number;
  pollIntervalMs: number;
  onCycleError?: (error: unknown) => void | Promise<void>;
};

type ProductionJobWorker = {
  manifest: typeof jobRuntimeManifest;
  runtime: Awaited<ReturnType<typeof buildProductionJobRuntime>>;
  stop(): Promise<void>;
};

export async function applyProductionJobBootstrap(executor: SqlExecutor): Promise<void> {
  await applyMySqlBootstrap(executor);
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function createQueuedEmailWriter(executor: SqlExecutor) {
  return async (message: OutboundEmailMessage): Promise<void> => {
    await executor.execute(
      [
        "INSERT INTO email_outbox (recipient, subject, html_body, template_key, status, created_at)",
        "VALUES (?, ?, ?, ?, 'queued', CURRENT_TIMESTAMP)"
      ].join(" "),
      [message.to[0] ?? "", message.subject, message.html, message.templateKey]
    );
  };
}

function buildPublicAccessUrl(
  portalBaseUrl: string,
  resourceKind: "quotes" | "contracts" | "forms",
  resourceId: string,
  token: string | null
): string {
  if (token == null) {
    return `${normalizeBaseUrl(portalBaseUrl)}/${resourceKind}/${encodeURIComponent(resourceId)}`;
  }

  const origin = new URL(portalBaseUrl).origin;
  return `${origin}/api/public/${resourceKind}/${encodeURIComponent(resourceId)}?token=${encodeURIComponent(token)}`;
}

function buildBookingRecord(row: {
  id: number;
  client_id: number;
  service_type: string;
  appointment_date: string;
  appointment_time: string;
  duration_minutes: number;
  status: Booking["status"];
  ical_token: string | null;
}): Booking {
  const startsAt = `${row.appointment_date}T${row.appointment_time}.000Z`;
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    petIds: [],
    serviceId: row.service_type,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + row.duration_minutes * 60_000).toISOString(),
    status: row.status,
    icalAccess: row.ical_token == null ? null : {
      token: row.ical_token,
      issuedAt: startsAt,
      expiresAt: null,
      legacySourceId: String(row.id)
    }
  };
}

function buildQuoteRecord(row: {
  id: number;
  client_id: number;
  status: Quote["status"];
  total_amount: number;
  access_token: string | null;
}, now: () => string): Quote {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    status: row.status,
    totalAmount: Number(row.total_amount),
    publicAccess: row.access_token == null ? null : {
      token: row.access_token,
      issuedAt: now(),
      expiresAt: null,
      legacySourceId: String(row.id)
    }
  };
}

function buildContractRecord(row: {
  id: number;
  client_id: number;
  status: Contract["status"];
  access_token: string | null;
}, now: () => string): Contract {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    status: row.status,
    publicAccess: row.access_token == null ? null : {
      token: row.access_token,
      issuedAt: now(),
      expiresAt: null,
      legacySourceId: String(row.id)
    }
  };
}

function buildFormSubmissionRecord(row: {
  id: number;
  template_id: number;
  client_id: number;
  submitted_at: string | null;
  access_token: string | null;
}, now: () => string): FormSubmission {
  return {
    id: String(row.id),
    templateId: String(row.template_id),
    clientId: String(row.client_id),
    submittedAt: row.submitted_at,
    publicAccess: row.access_token == null ? null : {
      token: row.access_token,
      issuedAt: now(),
      expiresAt: null,
      legacySourceId: String(row.id)
    }
  };
}

function createMySqlInboundEmailProcessingDependencies(
  executor: SqlExecutor,
  now: () => string
): InboundEmailProcessingDependencies {
  return {
    now,
    generateId: (prefix) => `${prefix}-${randomUUID()}`,
    async saveInboundEmail(record) {
      await executor.execute(
        [
          "INSERT INTO inbound_emails (",
          "inbound_email_id, provider, mailbox, message_id, received_at, from_email, subject, matched_client_id, raw_payload_json, created_at",
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
        ].join(" "),
        [
          record.id,
          record.provider,
          record.mailbox,
          record.messageId,
          record.receivedAt,
          record.fromEmail,
          record.subject,
          record.matchedClientId,
          JSON.stringify(record.rawPayload)
        ]
      );
    },
    async findPortalUsersByEmail(email) {
      const [rows] = await executor.execute<Array<{ id: number; email: string }>>(
        [
          "SELECT id, email FROM clients",
          "WHERE email = ? AND COALESCE(is_archived, 0) = 0"
        ].join(" "),
        [email]
      );

      return rows.map((row) => ({
        id: String(row.id),
        email: row.email
      }));
    },
    async recordUnmatchedEmail(record) {
      await executor.execute(
        [
          "INSERT INTO unmatched_emails (",
          "unmatched_email_id, inbound_email_id, reason, detected_at, resolved_at, created_at",
          ") VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
        ].join(" "),
        [record.id, record.inboundEmailId, record.reason, record.detectedAt, record.resolvedAt]
      );
    }
  };
}

function createMySqlBookingReminderDependencies(
  executor: SqlExecutor,
  portalBaseUrl: string
): BookingReminderDependencies {
  const queueReminderEmail = createQueuedEmailWriter(executor);

  return {
    async findBookingReminderTarget(bookingId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        service_type: string;
        appointment_date: string;
        appointment_time: string;
        duration_minutes: number;
        status: Booking["status"];
        ical_token: string | null;
        recipient_email: string;
      }>>(
        [
          "SELECT b.id, b.client_id, b.service_type, b.appointment_date, b.appointment_time, b.duration_minutes, b.status, b.ical_token, c.email AS recipient_email",
          "FROM bookings b",
          "INNER JOIN clients c ON c.id = b.client_id",
          "WHERE b.id = ?",
          "LIMIT 1"
        ].join(" "),
        [bookingId]
      );

      const row = rows[0];
      if (row == null) {
        return null;
      }

      return {
        booking: buildBookingRecord(row),
        recipientEmail: row.recipient_email
      };
    },
    queueReminderEmail,
    buildPortalBookingUrl(bookingId) {
      return `${normalizeBaseUrl(portalBaseUrl)}/bookings/${encodeURIComponent(bookingId)}`;
    }
  };
}

function createMySqlQuoteReminderDependencies(
  executor: SqlExecutor,
  portalBaseUrl: string,
  now: () => string
): QuoteReminderDependencies {
  const queueReminderEmail = createQueuedEmailWriter(executor);

  return {
    async findQuoteReminderTarget(quoteId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        status: Quote["status"];
        total_amount: number;
        access_token: string | null;
        recipient_email: string;
      }>>(
        [
          "SELECT q.id, q.client_id, q.status, q.total_amount, q.access_token, c.email AS recipient_email",
          "FROM quotes q",
          "INNER JOIN clients c ON c.id = q.client_id",
          "WHERE q.id = ?",
          "LIMIT 1"
        ].join(" "),
        [quoteId]
      );

      const row = rows[0];
      if (row == null) {
        return null;
      }

      return {
        quote: buildQuoteRecord(row, now),
        recipientEmail: row.recipient_email
      };
    },
    queueReminderEmail,
    buildQuoteAccessUrl(quoteId, token) {
      return buildPublicAccessUrl(portalBaseUrl, "quotes", quoteId, token);
    }
  };
}

function createMySqlContractReminderDependencies(
  executor: SqlExecutor,
  portalBaseUrl: string,
  now: () => string
): ContractReminderDependencies {
  const queueReminderEmail = createQueuedEmailWriter(executor);

  return {
    async findContractReminderTarget(contractId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        status: Contract["status"];
        access_token: string | null;
        recipient_email: string;
      }>>(
        [
          "SELECT ct.id, ct.client_id, ct.status, ct.access_token, c.email AS recipient_email",
          "FROM contracts ct",
          "INNER JOIN clients c ON c.id = ct.client_id",
          "WHERE ct.id = ?",
          "LIMIT 1"
        ].join(" "),
        [contractId]
      );

      const row = rows[0];
      if (row == null) {
        return null;
      }

      return {
        contract: buildContractRecord(row, now),
        recipientEmail: row.recipient_email
      };
    },
    queueReminderEmail,
    buildContractAccessUrl(contractId, token) {
      return buildPublicAccessUrl(portalBaseUrl, "contracts", contractId, token);
    }
  };
}

function createMySqlFormReminderDependencies(
  executor: SqlExecutor,
  portalBaseUrl: string,
  now: () => string
): FormReminderDependencies {
  const queueReminderEmail = createQueuedEmailWriter(executor);

  return {
    async findFormReminderTarget(formId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        template_id: number;
        client_id: number;
        submitted_at: string | null;
        access_token: string | null;
        recipient_email: string;
      }>>(
        [
          "SELECT fs.id, fs.template_id, fs.client_id, fs.submitted_at, fs.access_token, c.email AS recipient_email",
          "FROM form_submissions fs",
          "INNER JOIN clients c ON c.id = fs.client_id",
          "WHERE fs.id = ?",
          "LIMIT 1"
        ].join(" "),
        [formId]
      );

      const row = rows[0];
      if (row == null) {
        return null;
      }

      return {
        submission: buildFormSubmissionRecord(row, now),
        recipientEmail: row.recipient_email
      };
    },
    queueReminderEmail,
    buildFormAccessUrl(formId, token) {
      return buildPublicAccessUrl(portalBaseUrl, "forms", formId, token);
    }
  };
}

function createMySqlInvoiceReminderDependencies(
  executor: SqlExecutor,
  portalBaseUrl: string
): InvoiceReminderDependencies {
  const queueReminderEmail = createQueuedEmailWriter(executor);

  return {
    async findInvoiceReminderTarget(invoiceId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        status: "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "void";
        total_amount: number;
        outstanding_amount: number;
        due_at: string | null;
        recipient_email: string;
      }>>(
        [
          "SELECT i.id, i.client_id, i.status, i.total_amount, i.outstanding_amount, i.due_at, c.email AS recipient_email",
          "FROM invoices i",
          "INNER JOIN clients c ON c.id = i.client_id",
          "WHERE i.id = ?",
          "LIMIT 1"
        ].join(" "),
        [invoiceId]
      );

      const row = rows[0];
      if (row == null) {
        return null;
      }

      return {
        invoice: {
          id: String(row.id),
          clientId: String(row.client_id),
          status: row.status,
          totalAmount: Number(row.total_amount),
          outstandingAmount: Number(row.outstanding_amount),
          dueAt: row.due_at
        },
        recipientEmail: row.recipient_email
      };
    },
    queueReminderEmail,
    buildPortalInvoiceUrl(invoiceId) {
      return `${normalizeBaseUrl(portalBaseUrl)}/invoices/${encodeURIComponent(invoiceId)}`;
    }
  };
}

function createMySqlUnmatchedEmailCleanerDependencies(
  executor: SqlExecutor,
  now: () => string
): UnmatchedEmailCleanerDependencies {
  return {
    now,
    async listUnresolvedUnmatchedEmails(limit) {
      const [rows] = await executor.execute<Array<{
        unmatched_email_id: string;
        inbound_email_id: string;
        reason: UnmatchedEmail["reason"];
        detected_at: string;
        resolved_at: string | null;
        from_email: string | null;
      }>>(
        [
          "SELECT ue.unmatched_email_id, ue.inbound_email_id, ue.reason, ue.detected_at, ue.resolved_at, ie.from_email",
          "FROM unmatched_emails ue",
          "LEFT JOIN inbound_emails ie ON ie.inbound_email_id = ue.inbound_email_id",
          "WHERE ue.resolved_at IS NULL",
          "ORDER BY ue.detected_at ASC",
          "LIMIT ?"
        ].join(" "),
        [limit]
      );

      return rows.map((row) => ({
        unmatchedEmail: {
          id: row.unmatched_email_id,
          inboundEmailId: row.inbound_email_id,
          reason: row.reason,
          detectedAt: row.detected_at,
          resolvedAt: row.resolved_at
        },
        inboundEmail: row.from_email == null ? null : {
          id: row.inbound_email_id,
          fromEmail: row.from_email
        }
      }));
    },
    async findPortalUsersByEmail(email) {
      const [rows] = await executor.execute<Array<{ id: number | string; email: string }>>(
        [
          "SELECT id, email FROM clients",
          "WHERE email = ? AND COALESCE(is_archived, 0) = 0"
        ].join(" "),
        [email]
      );

      return rows.map((row) => ({
        id: String(row.id),
        email: row.email
      }));
    },
    async resolveUnmatchedEmail({ unmatchedEmailId, inboundEmailId, matchedClientId, resolvedAt }) {
      await executor.execute(
        "UPDATE inbound_emails SET matched_client_id = ? WHERE inbound_email_id = ?",
        [matchedClientId, inboundEmailId]
      );
      await executor.execute(
        "UPDATE unmatched_emails SET resolved_at = ? WHERE unmatched_email_id = ?",
        [resolvedAt, unmatchedEmailId]
      );
    }
  };
}

function createMySqlWorkflowProcessorDependencies(
  executor: SqlExecutor,
  portalBaseUrl: string,
  now: () => string
): WorkflowProcessorDependencies {
  const queueWorkflowEmail = createQueuedEmailWriter(executor);

  return {
    now,
    async listDueWorkflowStepExecutions(limit: number) {
      const [rows] = await executor.execute<Array<{
        workflow_step_execution_id: string;
        execution_enrollment_id: string;
        step_id: string;
        scheduled_for: string;
        executed_at: string | null;
        execution_status: WorkflowStepExecution["status"];
        error_message: string | null;
        workflow_enrollment_id: string;
        workflow_id: string;
        client_id: string;
        enrolled_at: string;
        completed_at: string | null;
        enrollment_status: WorkflowEnrollment["status"] | null;
        workflow_step_id: string;
        step_order: number;
        step_name: string;
        email_subject: string;
        email_body_html: string;
        email_body_text: string | null;
        delay_type: WorkflowStep["delayType"];
        delay_value: string | null;
        scheduled_date: string | null;
        attach_contract_id: string | null;
        attach_form_id: string | null;
        attach_quote_id: string | null;
        attach_invoice_id: string | null;
        include_appointment_link: number;
        appointment_type_id: string | null;
        step_created_at: string | null;
        step_updated_at: string | null;
        workflow_name: string;
        workflow_trigger: Workflow["trigger"];
        workflow_active: number;
        recipient_email: string;
        recipient_name: string | null;
      }>>(
        [
          "SELECT wse.workflow_step_execution_id, wse.enrollment_id AS execution_enrollment_id, wse.step_id,",
          "wse.scheduled_for, wse.executed_at, wse.status AS execution_status, wse.error_message,",
          "we.workflow_enrollment_id, we.workflow_id, we.client_id, we.enrolled_at, we.completed_at, we.status AS enrollment_status,",
          "ws.workflow_step_id, ws.step_order, ws.step_name, ws.email_subject, ws.email_body_html, ws.email_body_text,",
          "ws.delay_type, ws.delay_value, ws.scheduled_date, ws.attach_contract_id, ws.attach_form_id, ws.attach_quote_id, ws.attach_invoice_id,",
          "ws.include_appointment_link, ws.appointment_type_id, ws.created_at AS step_created_at, ws.updated_at AS step_updated_at,",
          "w.workflow_name, w.workflow_trigger, w.active AS workflow_active,",
          "c.email AS recipient_email, c.name AS recipient_name",
          "FROM workflow_step_executions wse",
          "INNER JOIN workflow_enrollments we ON we.workflow_enrollment_id = wse.enrollment_id",
          "INNER JOIN workflow_steps ws ON ws.workflow_step_id = wse.step_id",
          "INNER JOIN workflows w ON w.workflow_id = we.workflow_id",
          "INNER JOIN clients c ON c.id = we.client_id",
          "WHERE wse.executed_at IS NULL",
          "AND wse.status = 'pending'",
          "AND COALESCE(we.status, 'active') = 'active'",
          "AND w.active = 1",
          "AND wse.scheduled_for <= ?",
          "ORDER BY wse.scheduled_for ASC",
          "LIMIT ?"
        ].join(" "),
        [now(), limit]
      );

      return rows.map((row) => ({
        workflow: {
          id: row.workflow_id,
          name: row.workflow_name,
          trigger: row.workflow_trigger,
          active: Number(row.workflow_active) === 1
        } satisfies Workflow,
        enrollment: {
          id: row.workflow_enrollment_id,
          workflowId: row.workflow_id,
          clientId: row.client_id,
          enrolledAt: row.enrolled_at,
          completedAt: row.completed_at,
          status: row.enrollment_status ?? undefined
        } satisfies WorkflowEnrollment,
        step: {
          id: row.workflow_step_id,
          workflowId: row.workflow_id,
          stepOrder: Number(row.step_order),
          stepName: row.step_name,
          emailSubject: row.email_subject,
          emailBodyHtml: row.email_body_html,
          emailBodyText: row.email_body_text,
          delayType: row.delay_type,
          delayValue: row.delay_value,
          scheduledDate: row.scheduled_date,
          attachContractId: row.attach_contract_id,
          attachFormId: row.attach_form_id,
          attachQuoteId: row.attach_quote_id,
          attachInvoiceId: row.attach_invoice_id,
          includeAppointmentLink: Number(row.include_appointment_link) === 1,
          appointmentTypeId: row.appointment_type_id,
          createdAt: row.step_created_at ?? undefined,
          updatedAt: row.step_updated_at ?? undefined
        } satisfies WorkflowStep,
        execution: {
          id: row.workflow_step_execution_id,
          enrollmentId: row.execution_enrollment_id,
          stepId: row.step_id,
          scheduledFor: row.scheduled_for,
          executedAt: row.executed_at,
          status: row.execution_status,
          errorMessage: row.error_message
        } satisfies WorkflowStepExecution,
        recipientEmail: row.recipient_email,
        recipientDisplayName: row.recipient_name
      }));
    },
    queueWorkflowEmail,
    async markWorkflowStepExecutionCompleted(executionId: string, completedAt: string) {
      const [executionRows] = await executor.execute<Array<{ enrollment_id: string }>>(
        [
          "SELECT enrollment_id",
          "FROM workflow_step_executions",
          "WHERE workflow_step_execution_id = ?",
          "LIMIT 1"
        ].join(" "),
        [executionId]
      );
      const enrollmentId = executionRows[0]?.enrollment_id ?? null;

      await executor.execute(
        "UPDATE workflow_step_executions SET executed_at = ?, status = 'completed' WHERE workflow_step_execution_id = ?",
        [completedAt, executionId]
      );

      if (enrollmentId == null) {
        return;
      }

      const [pendingRows] = await executor.execute<Array<{ scheduled_for: string }>>(
        [
          "SELECT scheduled_for",
          "FROM workflow_step_executions",
          "WHERE enrollment_id = ? AND status = 'pending' AND executed_at IS NULL",
          "ORDER BY scheduled_for ASC"
        ].join(" "),
        [enrollmentId]
      );

      const nextPending = pendingRows[0]?.scheduled_for ?? null;
      if (nextPending == null) {
        await executor.execute(
          "UPDATE workflow_enrollments SET completed_at = ?, status = 'completed', next_run_at = NULL WHERE workflow_enrollment_id = ?",
          [completedAt, enrollmentId]
        );
        return;
      }

      await executor.execute(
        "UPDATE workflow_enrollments SET next_run_at = ? WHERE workflow_enrollment_id = ?",
        [nextPending, enrollmentId]
      );
    },
    buildPortalClientUrl(clientId) {
      return `${normalizeBaseUrl(portalBaseUrl)}?client=${encodeURIComponent(clientId)}`;
    }
  };
}

type DefaultJobHandlerDependencies = {
  bookingReminder?: BookingReminderDependencies;
  quoteReminder?: QuoteReminderDependencies;
  contractReminder?: ContractReminderDependencies;
  formReminder?: FormReminderDependencies;
  invoiceReminder?: InvoiceReminderDependencies;
  scheduledEmailSender?: ScheduledEmailSenderDependencies;
  inboundEmailProcessing?: InboundEmailProcessingDependencies;
  unmatchedEmailCleaner?: UnmatchedEmailCleanerDependencies;
  workflowProcessor?: WorkflowProcessorDependencies;
};

export function createDefaultJobHandlers(
  dependencies: DefaultJobHandlerDependencies = {}
): Partial<Record<SupportedJobKind, (job: JobEnvelope) => Promise<string>>> {
  return {
    booking_reminder: async (job) => {
      if (dependencies.bookingReminder == null) {
        return `Processed booking reminder for ${String(job.payload.bookingId ?? "unknown booking")}.`;
      }

      return processBookingReminderJob(job, dependencies.bookingReminder);
    },
    contract_reminder: async (job) => {
      if (dependencies.contractReminder == null) {
        return `Processed contract reminder for ${String(job.payload.contractId ?? "unknown contract")}.`;
      }

      return processContractReminderJob(job, dependencies.contractReminder);
    },
    form_reminder: async (job) => {
      if (dependencies.formReminder == null) {
        return `Processed form reminder for ${String(job.payload.formId ?? "unknown form")}.`;
      }

      return processFormReminderJob(job, dependencies.formReminder);
    },
    quote_reminder: async (job) => {
      if (dependencies.quoteReminder == null) {
        return `Processed quote reminder for ${String(job.payload.quoteId ?? "unknown quote")}.`;
      }

      return processQuoteReminderJob(job, dependencies.quoteReminder);
    },
    invoice_reminder: async (job) => {
      if (dependencies.invoiceReminder == null) {
        return `Processed invoice reminder for ${String(job.payload.invoiceId ?? "unknown invoice")}.`;
      }

      return processInvoiceReminderJob(job, dependencies.invoiceReminder);
    },
    workflow_processor: async (job) => {
      if (dependencies.workflowProcessor == null) {
        return `Processed workflow processor job ${job.jobId}.`;
      }

      return processWorkflowProcessorJob(job, dependencies.workflowProcessor);
    },
    scheduled_email_sender: async (job) => {
      if (dependencies.scheduledEmailSender == null) {
        return `Processed scheduled email sender job ${job.jobId}.`;
      }

      return processScheduledEmailSenderJob(job, dependencies.scheduledEmailSender);
    },
    email_receiver: async (job) => {
      if (dependencies.inboundEmailProcessing == null) {
        return `Processed email receiver job ${job.jobId}.`;
      }

      return processInboundEmailReceiverJob(job, dependencies.inboundEmailProcessing);
    },
    unmatched_email_cleaner: async (job) => {
      if (dependencies.unmatchedEmailCleaner == null) {
        return `Processed unmatched email cleaner job ${job.jobId}.`;
      }

      return processUnmatchedEmailCleanerJob(job, dependencies.unmatchedEmailCleaner);
    }
  };
}

export async function buildProductionJobRuntime(options: BootstrapOptions) {
  await applyProductionJobBootstrap(options.executor);
  const now = options.now ?? (() => new Date().toISOString());
  const portalBaseUrl = await resolveMySqlPortalBaseUrl(options.executor, options.portalBaseUrl);

  return buildJobRuntime(createMySqlJobProcessorDependencies(options.executor, {
    now,
    handlers: createDefaultJobHandlers({
      bookingReminder: createMySqlBookingReminderDependencies(options.executor, portalBaseUrl),
      quoteReminder: createMySqlQuoteReminderDependencies(options.executor, portalBaseUrl, now),
      contractReminder: createMySqlContractReminderDependencies(options.executor, portalBaseUrl, now),
      formReminder: createMySqlFormReminderDependencies(options.executor, portalBaseUrl, now),
      invoiceReminder: createMySqlInvoiceReminderDependencies(options.executor, portalBaseUrl),
      scheduledEmailSender: {
        queueScheduledEmail: createQueuedEmailWriter(options.executor)
      },
      inboundEmailProcessing: createMySqlInboundEmailProcessingDependencies(options.executor, now),
      unmatchedEmailCleaner: createMySqlUnmatchedEmailCleanerDependencies(options.executor, now),
      workflowProcessor: createMySqlWorkflowProcessorDependencies(options.executor, portalBaseUrl, now)
    })
  }));
}

export async function startProductionJobWorker(options: WorkerPollOptions): Promise<ProductionJobWorker> {
  const runtime = await buildProductionJobRuntime({
    executor: options.executor,
    portalBaseUrl: options.portalBaseUrl,
    now: options.now
  });

  await runtime.processDueWork({
    jobLimit: options.jobBatchSize,
    emailLimit: options.emailBatchSize
  });

  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let inFlightCycle: Promise<void> | null = null;
  const onCycleError = options.onCycleError ?? ((error: unknown) => {
    console.error("[bdta-jobs] scheduled worker cycle failed", error);
  });

  const scheduleNext = () => {
    if (stopped) {
      return;
    }

    timer = setTimeout(() => {
      timer = null;
      inFlightCycle = (async () => {
        try {
          await runtime.processDueWork({
            jobLimit: options.jobBatchSize,
            emailLimit: options.emailBatchSize
          });
        } catch (error) {
          await onCycleError(error);
        } finally {
          inFlightCycle = null;
          scheduleNext();
        }
      })();
    }, options.pollIntervalMs);
  };

  scheduleNext();

  return {
    manifest: jobRuntimeManifest,
    runtime,
    async stop() {
      stopped = true;
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      await inFlightCycle;
    }
  };
}

export async function startProductionJobWorkerFromDatabaseUrl(input: {
  databaseUrl: string;
  portalBaseUrl?: string;
  now?: () => string;
  jobBatchSize: number;
  emailBatchSize: number;
  pollIntervalMs: number;
}) {
  const pool = createMySqlPoolFromDatabaseUrl(input.databaseUrl);
  const executor: SqlExecutor = {
    async execute<T>(sql: string, params: unknown[] = []) {
      const [rows] = await pool.execute(sql, params as []);
      return [rows as T, rows as { insertId?: number; affectedRows?: number }];
    }
  };

  const worker = await startProductionJobWorker({
    executor,
    portalBaseUrl: input.portalBaseUrl,
    now: input.now,
    jobBatchSize: input.jobBatchSize,
    emailBatchSize: input.emailBatchSize,
    pollIntervalMs: input.pollIntervalMs
  });

  return {
    ...worker,
    async stop() {
      await worker.stop();
      await pool.end();
    }
  };
}
