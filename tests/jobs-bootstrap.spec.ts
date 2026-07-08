import { buildProductionJobRuntime, createDefaultJobHandlers, startProductionJobWorker } from "../apps/jobs/src/bootstrap.js";
import type { SqlExecutor } from "@bdta/infrastructure";
import { vi } from "vitest";

class RecordingExecutor implements SqlExecutor {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];

  async execute<T>(sql: string, params: unknown[] = []): Promise<[T, { affectedRows?: number }]> {
    this.calls.push({ sql, params });
    if (sql.includes("FROM job_queue")) {
      return [[{
        job_id: "job-1",
        job_kind: "invoice_reminder",
        run_at: "2026-05-27T17:00:00.000Z",
        payload_json: JSON.stringify({ invoiceId: "invoice-1" })
      }] as T, { affectedRows: 0 }];
    }

    if (sql.includes("FROM email_outbox")) {
      return [[{
        id: 9001,
        recipient: "client@example.com",
        subject: "Invoice reminder",
        html_body: "<p>Reminder</p>",
        template_key: "invoice_reminder"
      }] as T, { affectedRows: 0 }];
    }

    if (sql.includes("SELECT i.id, i.client_id")) {
      return [[{
        id: "invoice-1",
        client_id: "client-1",
        status: "overdue",
        total_amount: 225,
        outstanding_amount: 125,
        due_at: "2026-06-05T00:00:00.000Z",
        recipient_email: "client@example.com"
      }] as T, { affectedRows: 0 }];
    }

    if (sql.includes("FROM clients")) {
      return [[] as unknown as T, { affectedRows: 0 }];
    }

    return [[] as unknown as T, { affectedRows: 1 }];
  }
}

describe("job worker bootstrap", () => {
  it("provides default summaries for supported built-in job kinds", async () => {
    const handlers = createDefaultJobHandlers();
    const summary = await handlers.invoice_reminder?.({
      jobId: "job-1",
      kind: "invoice_reminder",
      scheduledFor: "2026-05-27T17:00:00.000Z",
      payload: {
        invoiceId: "invoice-1"
      }
    });

    expect(summary).toContain("invoice-1");
  });

  it("applies bootstrap DDL and runs a processing cycle with default handlers", async () => {
    const executor = new RecordingExecutor();
    const runtime = await buildProductionJobRuntime({
      executor,
      portalBaseUrl: "https://portal.example.test/portal",
      now: () => "2026-05-27T18:00:00.000Z"
    });

    const result = await runtime.processDueWork({
      jobLimit: 10,
      emailLimit: 10
    });

    expect(executor.calls[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS settings");
    expect(executor.calls.some((call) => call.sql.includes("CREATE TABLE IF NOT EXISTS email_outbox"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("CREATE TABLE IF NOT EXISTS job_queue"))).toBe(true);
    expect(result.jobResults[0]?.success).toBe(true);
    expect(result.emailsSent).toBe(1);
  });

  it("does not overlap scheduled polling cycles and waits for in-flight work on stop", async () => {
    vi.useFakeTimers();

    class NonOverlappingExecutor extends RecordingExecutor {
      jobQueueCalls = 0;
      private resolveSecondCycle: (() => void) | null = null;

      override async execute<T>(sql: string, params: unknown[] = []): Promise<[T, { affectedRows?: number }]> {
        this.calls.push({ sql, params });
        if (sql.includes("information_schema.statistics")) {
          return [[{ indexName: String(params[1] ?? "existing_index") }] as unknown as T, { affectedRows: 0 }];
        }

        if (sql.includes("FROM job_queue")) {
          this.jobQueueCalls += 1;
          if (this.jobQueueCalls === 2) {
            return await new Promise<[T, { affectedRows?: number }]>((resolve) => {
              this.resolveSecondCycle = () => resolve([[] as unknown as T, { affectedRows: 0 }]);
            });
          }

          return [[] as unknown as T, { affectedRows: 0 }];
        }

        if (sql.includes("FROM email_outbox")) {
          return [[] as unknown as T, { affectedRows: 0 }];
        }

        return [[] as unknown as T, { affectedRows: 1 }];
      }

      finishSecondCycle() {
        this.resolveSecondCycle?.();
        this.resolveSecondCycle = null;
      }
    }

    const executor = new NonOverlappingExecutor();
    const worker = await startProductionJobWorker({
      executor,
      portalBaseUrl: "https://portal.example.test/portal",
      now: () => "2026-05-27T18:00:00.000Z",
      jobBatchSize: 10,
      emailBatchSize: 10,
      pollIntervalMs: 1000
    });

    expect(executor.jobQueueCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(executor.jobQueueCalls).toBe(2);

    await vi.advanceTimersByTimeAsync(5000);
    expect(executor.jobQueueCalls).toBe(2);

    let stopped = false;
    const stopPromise = worker.stop().then(() => {
      stopped = true;
    });

    await Promise.resolve();
    expect(stopped).toBe(false);

    executor.finishSecondCycle();
    await stopPromise;
    expect(stopped).toBe(true);

    vi.useRealTimers();
  });

  it("continues polling after a scheduled cycle error", async () => {
    vi.useFakeTimers();

    class RecoveringExecutor extends RecordingExecutor {
      jobQueueCalls = 0;

      override async execute<T>(sql: string, params: unknown[] = []): Promise<[T, { affectedRows?: number }]> {
        this.calls.push({ sql, params });
        if (sql.includes("information_schema.statistics")) {
          return [[{ indexName: String(params[1] ?? "existing_index") }] as unknown as T, { affectedRows: 0 }];
        }

        if (sql.includes("FROM job_queue")) {
          this.jobQueueCalls += 1;
          if (this.jobQueueCalls === 2) {
            throw new Error("temporary job queue failure");
          }

          return [[] as unknown as T, { affectedRows: 0 }];
        }

        if (sql.includes("FROM email_outbox")) {
          return [[] as unknown as T, { affectedRows: 0 }];
        }

        return [[] as unknown as T, { affectedRows: 1 }];
      }
    }

    const executor = new RecoveringExecutor();
    const cycleErrors: string[] = [];
    const worker = await startProductionJobWorker({
      executor,
      portalBaseUrl: "https://portal.example.test/portal",
      now: () => "2026-05-27T18:00:00.000Z",
      jobBatchSize: 10,
      emailBatchSize: 10,
      pollIntervalMs: 1000,
      onCycleError(error) {
        cycleErrors.push(error instanceof Error ? error.message : String(error));
      }
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(cycleErrors).toEqual(["temporary job queue failure"]);
    expect(executor.jobQueueCalls).toBe(3);

    await worker.stop();
    vi.useRealTimers();
  });

  it("persists inbound email and unmatched-email records for email receiver jobs", async () => {
    class EmailReceiverExecutor extends RecordingExecutor {
      override async execute<T>(sql: string, params: unknown[] = []): Promise<[T, { affectedRows?: number }]> {
        this.calls.push({ sql, params });
        if (sql.includes("FROM job_queue")) {
          return [[{
            job_id: "job-email-1",
            job_kind: "email_receiver",
            run_at: "2026-05-27T17:00:00.000Z",
            payload_json: JSON.stringify({
              callbackId: "callback-1",
              provider: "imap",
              mailbox: "INBOX",
              messageId: "imap-message-1",
              receivedAt: "2026-05-27T16:55:00.000Z",
              from: "unknown@example.com",
              subject: "Need help with my booking"
            })
          }] as T, { affectedRows: 0 }];
        }

        if (sql.includes("FROM email_outbox")) {
          return [[] as unknown as T, { affectedRows: 0 }];
        }

        if (sql.includes("FROM clients")) {
          return [[] as unknown as T, { affectedRows: 0 }];
        }

        return [[] as unknown as T, { affectedRows: 1 }];
      }
    }

    const executor = new EmailReceiverExecutor();
    const runtime = await buildProductionJobRuntime({
      executor,
      portalBaseUrl: "https://portal.example.test/portal",
      now: () => "2026-05-27T18:00:00.000Z"
    });

    const result = await runtime.processDueWork({
      jobLimit: 10,
      emailLimit: 10
    });

    expect(result.jobResults[0]?.success).toBe(true);
    expect(result.jobResults[0]?.summary).toContain("imap-message-1");
    expect(executor.calls.some((call) => call.sql.includes("INSERT INTO inbound_emails"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("INSERT INTO unmatched_emails"))).toBe(true);
  });

  it("queues invoice reminder emails for invoice reminder jobs", async () => {
    class InvoiceReminderExecutor extends RecordingExecutor {
      override async execute<T>(sql: string, params: unknown[] = []): Promise<[T, { affectedRows?: number }]> {
        this.calls.push({ sql, params });
        if (sql.includes("FROM job_queue")) {
          return [[{
            job_id: "job-invoice-1",
            job_kind: "invoice_reminder",
            run_at: "2026-05-27T17:00:00.000Z",
            payload_json: JSON.stringify({
              invoiceId: "invoice-1"
            })
          }] as T, { affectedRows: 0 }];
        }

        if (sql.includes("SELECT i.id, i.client_id")) {
          return [[{
            id: 1,
            client_id: 12,
            status: "overdue",
            total_amount: 225,
            outstanding_amount: 125,
            due_at: "2026-06-05T00:00:00.000Z",
            recipient_email: "client@example.com"
          }] as T, { affectedRows: 0 }];
        }

        if (sql.includes("FROM email_outbox")) {
          return [[] as unknown as T, { affectedRows: 0 }];
        }

        return [[] as unknown as T, { affectedRows: 1 }];
      }
    }

    const executor = new InvoiceReminderExecutor();
    const runtime = await buildProductionJobRuntime({
      executor,
      portalBaseUrl: "https://portal.example.test/portal",
      now: () => "2026-05-27T18:00:00.000Z"
    });

    const result = await runtime.processDueWork({
      jobLimit: 10,
      emailLimit: 10
    });

    expect(result.jobResults[0]?.success).toBe(true);
    expect(result.jobResults[0]?.summary).toContain("invoice-1");
    expect(executor.calls.some((call) => call.sql.includes("INSERT INTO email_outbox"))).toBe(true);
  });

  it("queues booking, quote, contract, form, and scheduled emails with production handlers", async () => {
    class ReminderExecutor extends RecordingExecutor {
      override async execute<T>(sql: string, params: unknown[] = []): Promise<[T, { affectedRows?: number }]> {
        this.calls.push({ sql, params });
        if (sql.includes("FROM job_queue")) {
          return [[
            {
              job_id: "job-booking-1",
              job_kind: "booking_reminder",
              run_at: "2026-05-27T17:00:00.000Z",
              payload_json: JSON.stringify({ bookingId: "booking-1" })
            },
            {
              job_id: "job-quote-1",
              job_kind: "quote_reminder",
              run_at: "2026-05-27T17:01:00.000Z",
              payload_json: JSON.stringify({ quoteId: "quote-1" })
            },
            {
              job_id: "job-contract-1",
              job_kind: "contract_reminder",
              run_at: "2026-05-27T17:02:00.000Z",
              payload_json: JSON.stringify({ contractId: "contract-1" })
            },
            {
              job_id: "job-form-1",
              job_kind: "form_reminder",
              run_at: "2026-05-27T17:03:00.000Z",
              payload_json: JSON.stringify({ formId: "form-1" })
            },
            {
              job_id: "job-scheduled-email-1",
              job_kind: "scheduled_email_sender",
              run_at: "2026-05-27T17:04:00.000Z",
              payload_json: JSON.stringify({
                to: ["client@example.com"],
                subject: "Scheduled follow-up",
                html: "<p>We are checking in about your training plan.</p>",
                template_key: "scheduled_follow_up",
                templateKey: "scheduled_follow_up"
              })
            }
          ] as T, { affectedRows: 0 }];
        }

        if (sql.includes("FROM email_outbox")) {
          return [[
            {
              id: 9101,
              recipient: "client@example.com",
              subject: "Booking reminder",
              html_body: "<p>Booking reminder</p>",
              template_key: "booking_reminder"
            },
            {
              id: 9102,
              recipient: "client@example.com",
              subject: "Quote reminder",
              html_body: "<p>Quote reminder</p>",
              template_key: "quote_reminder"
            },
            {
              id: 9103,
              recipient: "client@example.com",
              subject: "Contract reminder",
              html_body: "<p>Contract reminder</p>",
              template_key: "contract_reminder"
            },
            {
              id: 9104,
              recipient: "client@example.com",
              subject: "Form reminder",
              html_body: "<p>Form reminder</p>",
              template_key: "form_reminder"
            },
            {
              id: 9105,
              recipient: "client@example.com",
              subject: "Scheduled follow-up",
              html_body: "<p>We are checking in about your training plan.</p>",
              template_key: "scheduled_follow_up"
            }
          ] as T, { affectedRows: 0 }];
        }

        if (sql.includes("SELECT b.id, b.client_id")) {
          return [[{
            id: "booking-1",
            client_id: "client-1",
            service_type: "svc-private-lesson",
            appointment_date: "2026-06-02",
            appointment_time: "16:00:00",
            duration_minutes: 60,
            status: "confirmed",
            ical_token: "ical-access-token-123456",
            recipient_email: "client@example.com"
          }] as T, { affectedRows: 0 }];
        }

        if (sql.includes("SELECT q.id, q.client_id")) {
          return [[{
            id: "quote-1",
            client_id: "client-1",
            status: "sent",
            total_amount: 425,
            access_token: "quote-access-token-123456",
            recipient_email: "client@example.com"
          }] as T, { affectedRows: 0 }];
        }

        if (sql.includes("SELECT ct.id, ct.client_id")) {
          return [[{
            id: "contract-1",
            client_id: "client-1",
            status: "sent",
            access_token: "contract-access-token-123456",
            recipient_email: "client@example.com"
          }] as T, { affectedRows: 0 }];
        }

        if (sql.includes("SELECT fs.id, fs.template_id")) {
          return [[{
            id: "form-1",
            template_id: "template-44",
            client_id: "client-1",
            submitted_at: null,
            access_token: "form-access-token-123456",
            recipient_email: "client@example.com"
          }] as T, { affectedRows: 0 }];
        }

        return [[] as unknown as T, { affectedRows: 1 }];
      }
    }

    const executor = new ReminderExecutor();
    const runtime = await buildProductionJobRuntime({
      executor,
      portalBaseUrl: "https://portal.example.test/portal",
      now: () => "2026-05-27T18:00:00.000Z"
    });

    const result = await runtime.processDueWork({
      jobLimit: 10,
      emailLimit: 10
    });

    const outboxInserts = executor.calls.filter((call) => call.sql.includes("INSERT INTO email_outbox"));

    expect(result.jobResults).toHaveLength(5);
    expect(result.jobResults.every((jobResult) => jobResult.success)).toBe(true);
    expect(result.emailsSent).toBe(5);
    expect(outboxInserts).toHaveLength(5);
    expect(outboxInserts.some((call) => JSON.stringify(call.params).includes("https://portal.example.test/portal/bookings/booking-1"))).toBe(true);
    expect(outboxInserts.some((call) => JSON.stringify(call.params).includes("https://portal.example.test/api/public/quotes/quote-1?token=quote-access-token-123456"))).toBe(true);
    expect(outboxInserts.some((call) => JSON.stringify(call.params).includes("https://portal.example.test/api/public/contracts/contract-1?token=contract-access-token-123456"))).toBe(true);
    expect(outboxInserts.some((call) => JSON.stringify(call.params).includes("https://portal.example.test/api/public/forms/form-1?token=form-access-token-123456"))).toBe(true);
    expect(outboxInserts.some((call) => call.params[1] === "Scheduled follow-up")).toBe(true);
  });

  it("reconciles unmatched emails with production handlers when a client match becomes available", async () => {
    class UnmatchedCleanerExecutor extends RecordingExecutor {
      override async execute<T>(sql: string, params: unknown[] = []): Promise<[T, { affectedRows?: number }]> {
        this.calls.push({ sql, params });
        if (sql.includes("FROM job_queue")) {
          return [[{
            job_id: "job-unmatched-cleaner-1",
            job_kind: "unmatched_email_cleaner",
            run_at: "2026-05-27T17:00:00.000Z",
            payload_json: JSON.stringify({ limit: 10 })
          }] as T, { affectedRows: 0 }];
        }

        if (sql.includes("FROM unmatched_emails ue")) {
          return [[{
            unmatched_email_id: "unmatched-email-1",
            inbound_email_id: "inbound-email-1",
            reason: "no_client_match",
            detected_at: "2026-05-27T16:01:00.000Z",
            resolved_at: null,
            from_email: "resolved@example.com"
          }] as T, { affectedRows: 0 }];
        }

        if (sql.includes("SELECT id, email FROM clients")) {
          return [[{
            id: "client-1",
            email: "resolved@example.com"
          }] as T, { affectedRows: 0 }];
        }

        if (sql.includes("FROM email_outbox")) {
          return [[] as unknown as T, { affectedRows: 0 }];
        }

        return [[] as unknown as T, { affectedRows: 1 }];
      }
    }

    const executor = new UnmatchedCleanerExecutor();
    const runtime = await buildProductionJobRuntime({
      executor,
      portalBaseUrl: "https://portal.example.test/portal",
      now: () => "2026-05-27T18:00:00.000Z"
    });

    const result = await runtime.processDueWork({
      jobLimit: 10,
      emailLimit: 10
    });

    expect(result.jobResults[0]?.success).toBe(true);
    expect(result.jobResults[0]?.summary).toContain("Resolved 1 unmatched email");
    expect(executor.calls.some((call) => call.sql.includes("UPDATE inbound_emails SET matched_client_id = ?"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("UPDATE unmatched_emails SET resolved_at = ?"))).toBe(true);
  });

  it("processes workflow step executions with production handlers", async () => {
    class WorkflowProcessorExecutor extends RecordingExecutor {
      override async execute<T>(sql: string, params: unknown[] = []): Promise<[T, { affectedRows?: number }]> {
        this.calls.push({ sql, params });
        if (sql.includes("FROM job_queue")) {
          return [[{
            job_id: "job-workflow-1",
            job_kind: "workflow_processor",
            run_at: "2026-05-27T17:00:00.000Z",
            payload_json: JSON.stringify({ limit: 10 })
          }] as T, { affectedRows: 0 }];
        }

        if (sql.includes("FROM workflow_step_executions wse")) {
          return [[{
            workflow_step_execution_id: "workflow-step-execution-1",
            execution_enrollment_id: "enrollment-1",
            step_id: "workflow-step-1",
            scheduled_for: "2026-05-27T17:30:00.000Z",
            executed_at: null,
            execution_status: "pending",
            error_message: null,
            workflow_enrollment_id: "enrollment-1",
            workflow_id: "workflow-1",
            client_id: "client-1",
            enrolled_at: "2026-05-27T16:00:00.000Z",
            completed_at: null,
            enrollment_status: "active",
            workflow_step_id: "workflow-step-1",
            step_order: 1,
            step_name: "Invoice Reminder",
            email_subject: "Reminder for {client_name}",
            email_body_html: "<p>Hello {client_name}</p>",
            email_body_text: "Hello {client_name}",
            delay_type: "after_enrollment",
            delay_value: "90 minutes",
            scheduled_date: null,
            attach_contract_id: null,
            attach_form_id: null,
            attach_quote_id: null,
            attach_invoice_id: null,
            include_appointment_link: 0,
            appointment_type_id: null,
            step_created_at: "2026-05-27T16:00:00.000Z",
            step_updated_at: "2026-05-27T16:00:00.000Z",
            workflow_name: "Invoice Overdue Follow-up",
            workflow_trigger: "scheduled",
            workflow_active: 1,
            recipient_email: "workflow-client@example.com",
            recipient_name: "Workflow Client"
          }] as T, { affectedRows: 0 }];
        }

        if (sql.includes("SELECT enrollment_id") && sql.includes("FROM workflow_step_executions")) {
          return [[{
            enrollment_id: "enrollment-1"
          }] as T, { affectedRows: 0 }];
        }

        if (sql.includes("WHERE enrollment_id = ? AND status = 'pending' AND executed_at IS NULL")) {
          return [[] as unknown as T, { affectedRows: 0 }];
        }

        if (sql.includes("FROM email_outbox")) {
          return [[{
            id: 9301,
            recipient: "workflow-client@example.com",
            subject: "Reminder for Workflow Client",
            html_body: "<p>Hello Workflow Client</p>",
            template_key: "workflow_step"
          }] as T, { affectedRows: 0 }];
        }

        return [[] as unknown as T, { affectedRows: 1 }];
      }
    }

    const executor = new WorkflowProcessorExecutor();
    const runtime = await buildProductionJobRuntime({
      executor,
      portalBaseUrl: "https://portal.example.test/portal",
      now: () => "2026-05-27T18:00:00.000Z"
    });

    const result = await runtime.processDueWork({
      jobLimit: 10,
      emailLimit: 10
    });

    expect(result.jobResults[0]?.success).toBe(true);
    expect(result.jobResults[0]?.summary).toContain("Processed 1 workflow step execution");
    expect(result.emailsSent).toBe(1);
    expect(executor.calls.some((call) => call.sql.includes("INSERT INTO email_outbox"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("UPDATE workflow_step_executions SET executed_at = ?"))).toBe(true);
    expect(executor.calls.some((call) => call.sql.includes("UPDATE workflow_enrollments SET completed_at = ?"))).toBe(true);
  });
});
