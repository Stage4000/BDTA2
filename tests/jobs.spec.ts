import { buildJobRuntime } from "../apps/jobs/src/index.js";
import {
  createInMemoryJobProcessorDependencies,
  createInMemoryPlatformState
} from "@bdta/infrastructure";

describe("job runtime", () => {
  it("processes due jobs and queued emails through the in-memory runtime", async () => {
    const state = createInMemoryPlatformState({
      queuedJobs: [
        {
          jobId: "job-due-1",
          kind: "booking_reminder",
          scheduledFor: "2026-05-27T17:00:00.000Z",
          payload: {
            bookingId: "booking-1"
          }
        },
        {
          jobId: "job-future-1",
          kind: "invoice_reminder",
          scheduledFor: "2026-05-27T19:00:00.000Z",
          payload: {
            invoiceId: "invoice-1"
          }
        }
      ],
      queuedEmails: [
        {
          to: ["client@example.com"],
          subject: "Booking confirmed",
          html: "<p>Confirmed</p>",
          templateKey: "booking_confirmation"
        }
      ]
    });

    const runtime = buildJobRuntime(createInMemoryJobProcessorDependencies(state, {
      handlers: {
        booking_reminder: async () => "Booking reminder sent."
      }
    }));

    const result = await runtime.processDueWork();

    expect(result.jobResults).toEqual([
      {
        jobId: "job-due-1",
        kind: "booking_reminder",
        processedAt: "2026-05-27T18:00:00.000Z",
        success: true,
        summary: "Booking reminder sent."
      }
    ]);
    expect(result.emailsSent).toBe(1);
    expect(result.emailsFailed).toBe(0);
    expect(state.processedJobResults).toHaveLength(1);
    expect(state.failedJobResults).toHaveLength(0);
    expect(state.sentEmails).toHaveLength(1);
    expect(state.failedEmailAttempts).toHaveLength(0);
    expect(state.queuedJobs).toHaveLength(1);
    expect(state.queuedJobs[0]?.jobId).toBe("job-future-1");
    expect(state.queuedEmails).toHaveLength(0);
  });

  it("records failures for unsupported job kinds and failed email deliveries", async () => {
    const state = createInMemoryPlatformState({
      queuedJobs: [{
        jobId: "job-due-2",
        kind: "workflow_processor",
        scheduledFor: "2026-05-27T17:30:00.000Z",
        payload: {}
      }],
      queuedEmails: [{
        to: ["client@example.com"],
        subject: "Invoice reminder",
        html: "<p>Reminder</p>",
        templateKey: "invoice_reminder"
      }]
    });

    const runtime = buildJobRuntime(createInMemoryJobProcessorDependencies(state, {
      sendEmail: async () => {
        throw new Error("SMTP unavailable");
      }
    }));

    const result = await runtime.processDueWork();

    expect(result.jobResults).toHaveLength(1);
    expect(result.jobResults[0]?.success).toBe(false);
    expect(result.jobResults[0]?.summary).toContain("No handler registered");
    expect(result.emailsSent).toBe(0);
    expect(result.emailsFailed).toBe(1);
    expect(state.failedJobResults).toHaveLength(1);
    expect(state.failedEmailAttempts[0]?.reason).toContain("SMTP unavailable");
  });

  it("processes email receiver jobs into inbound email records and unmatched email records", async () => {
    const state = createInMemoryPlatformState({
      queuedJobs: [{
        jobId: "job-email-1",
        kind: "email_receiver",
        scheduledFor: "2026-05-27T17:30:00.000Z",
        payload: {
          callbackId: "callback-1",
          provider: "imap",
          mailbox: "INBOX",
          messageId: "imap-message-1",
          receivedAt: "2026-05-27T17:25:00.000Z",
          from: "unknown@example.com",
          subject: "Need help with my booking"
        }
      }]
    });

    const { createDefaultJobHandlers } = await import("../apps/jobs/src/bootstrap.js");
    const runtime = buildJobRuntime(createInMemoryJobProcessorDependencies(state, {
      handlers: createDefaultJobHandlers({
        inboundEmailProcessing: {
          now: state.now,
          generateId: (prefix) => `${prefix}-generated-1`,
          saveInboundEmail: async (record) => {
            state.inboundEmails.push(record);
          },
          findPortalUsersByEmail: async (email) => state.portalUsers
            .filter((user) => user.email === email)
            .map((user) => ({
              id: user.clientId,
              email: user.email
            })),
          recordUnmatchedEmail: async (record) => {
            state.unmatchedEmails.push(record);
          }
        }
      })
    }));

    const result = await runtime.processDueWork();

    expect(result.jobResults[0]?.success).toBe(true);
    expect(result.jobResults[0]?.summary).toContain("imap-message-1");
    expect(state.inboundEmails).toEqual([{
      id: "inbound_email-generated-1",
      provider: "imap",
      mailbox: "INBOX",
      messageId: "imap-message-1",
      receivedAt: "2026-05-27T17:25:00.000Z",
      fromEmail: "unknown@example.com",
      subject: "Need help with my booking",
      matchedClientId: null,
      rawPayload: {
        callbackId: "callback-1",
        provider: "imap",
        mailbox: "INBOX",
        messageId: "imap-message-1",
        receivedAt: "2026-05-27T17:25:00.000Z",
        from: "unknown@example.com",
        subject: "Need help with my booking"
      }
    }]);
    expect(state.unmatchedEmails).toEqual([{
      id: "unmatched_email-generated-1",
      inboundEmailId: "inbound_email-generated-1",
      reason: "no_client_match",
      detectedAt: "2026-05-27T18:00:00.000Z",
      resolvedAt: null
    }]);
  });

  it("processes mail provider email receiver jobs into inbound email records", async () => {
    const state = createInMemoryPlatformState({
      queuedJobs: [{
        jobId: "job-email-provider-1",
        kind: "email_receiver",
        scheduledFor: "2026-05-27T17:35:00.000Z",
        payload: {
          callbackId: "callback-provider-1",
          provider: "mail_provider",
          mailbox: "support",
          messageId: "provider-message-1",
          receivedAt: "2026-05-27T17:26:00.000Z",
          from: "client@example.com",
          subject: "Reply to contract reminder"
        }
      }],
      portalUsers: [{
        clientId: "client-1",
        email: "client@example.com",
        displayName: "Client One",
        passwordHash: "hash-1",
        archived: false
      }]
    });

    const { createDefaultJobHandlers } = await import("../apps/jobs/src/bootstrap.js");
    const runtime = buildJobRuntime(createInMemoryJobProcessorDependencies(state, {
      handlers: createDefaultJobHandlers({
        inboundEmailProcessing: {
          now: state.now,
          generateId: (prefix) => `${prefix}-provider-1`,
          saveInboundEmail: async (record) => {
            state.inboundEmails.push(record);
          },
          findPortalUsersByEmail: async (email) => state.portalUsers
            .filter((user) => user.email === email)
            .map((user) => ({
              id: user.clientId,
              email: user.email
            })),
          recordUnmatchedEmail: async (record) => {
            state.unmatchedEmails.push(record);
          }
        }
      })
    }));

    const result = await runtime.processDueWork();

    expect(result.jobResults[0]?.success).toBe(true);
    expect(result.jobResults[0]?.summary).toContain("provider-message-1");
    expect(state.inboundEmails).toEqual([{
      id: "inbound_email-provider-1",
      provider: "mail_provider",
      mailbox: "support",
      messageId: "provider-message-1",
      receivedAt: "2026-05-27T17:26:00.000Z",
      fromEmail: "client@example.com",
      subject: "Reply to contract reminder",
      matchedClientId: "client-1",
      rawPayload: {
        callbackId: "callback-provider-1",
        provider: "mail_provider",
        mailbox: "support",
        messageId: "provider-message-1",
        receivedAt: "2026-05-27T17:26:00.000Z",
        from: "client@example.com",
        subject: "Reply to contract reminder"
      }
    }]);
    expect(state.unmatchedEmails).toEqual([]);
  });

  it("queues invoice reminder email content for due invoice reminder jobs", async () => {
    const state = createInMemoryPlatformState({
      invoices: [{
        id: "invoice-1",
        clientId: "client-1",
        status: "overdue",
        totalAmount: 225,
        outstandingAmount: 125,
        dueAt: "2026-06-05T00:00:00.000Z"
      }],
      portalUsers: [{
        clientId: "client-1",
        email: "client@example.com",
        displayName: "Client One",
        passwordHash: "hash-1",
        archived: false
      }],
      queuedJobs: [{
        jobId: "job-invoice-1",
        kind: "invoice_reminder",
        scheduledFor: "2026-05-27T17:30:00.000Z",
        payload: {
          invoiceId: "invoice-1"
        }
      }]
    });

    const { createDefaultJobHandlers } = await import("../apps/jobs/src/bootstrap.js");
    const runtime = buildJobRuntime(createInMemoryJobProcessorDependencies(state, {
      handlers: createDefaultJobHandlers({
        invoiceReminder: {
          findInvoiceReminderTarget: async (invoiceId) => {
            const invoice = state.invoices.find((candidate) => candidate.id === invoiceId) ?? null;
            if (invoice == null) {
              return null;
            }

            const portalUser = state.portalUsers.find((user) => user.clientId === invoice.clientId);
            if (portalUser == null) {
              return null;
            }

            return {
              invoice,
              recipientEmail: portalUser.email
            };
          },
          queueReminderEmail: async (message) => {
            state.queuedEmails.push(message);
          },
          buildPortalInvoiceUrl: (invoiceId) => `https://portal.example.test/portal/invoices/${invoiceId}`
        }
      })
    }));

    const result = await runtime.processDueWork();

    expect(result.jobResults[0]?.success).toBe(true);
    expect(result.jobResults[0]?.summary).toContain("invoice-1");
    expect(state.sentEmails).toEqual([{
      to: ["client@example.com"],
      subject: "Invoice reminder",
      html: expect.stringContaining("https://portal.example.test/portal/invoices/invoice-1"),
      templateKey: "invoice_reminder"
    }]);
  });

  it("queues booking, quote, contract, and form reminder email content for due reminder jobs", async () => {
    const state = createInMemoryPlatformState({
      portalUsers: [{
        clientId: "client-1",
        email: "client@example.com",
        displayName: "Client One",
        passwordHash: "hash-1",
        archived: false
      }],
      bookings: [{
        id: "booking-1",
        clientId: "client-1",
        petIds: [],
        serviceId: "svc-private-lesson",
        startsAt: "2026-06-02T16:00:00.000Z",
        endsAt: "2026-06-02T17:00:00.000Z",
        status: "confirmed",
        icalAccess: {
          token: "ical-access-token-123456",
          issuedAt: "2026-05-27T18:00:00.000Z",
          expiresAt: null,
          legacySourceId: "booking-1"
        }
      }],
      quotes: [{
        id: "quote-1",
        clientId: "client-1",
        status: "sent",
        totalAmount: 425,
        publicAccess: {
          token: "quote-access-token-123456",
          issuedAt: "2026-05-27T18:00:00.000Z",
          expiresAt: null,
          legacySourceId: "quote-1"
        }
      }],
      contracts: [{
        id: "contract-1",
        clientId: "client-1",
        status: "sent",
        publicAccess: {
          token: "contract-access-token-123456",
          issuedAt: "2026-05-27T18:00:00.000Z",
          expiresAt: null,
          legacySourceId: "contract-1"
        }
      }],
      formSubmissions: [{
        id: "form-1",
        templateId: "template-1",
        clientId: "client-1",
        submittedAt: null,
        publicAccess: {
          token: "form-access-token-123456",
          issuedAt: "2026-05-27T18:00:00.000Z",
          expiresAt: null,
          legacySourceId: "form-1"
        }
      }],
      queuedJobs: [
        {
          jobId: "job-booking-1",
          kind: "booking_reminder",
          scheduledFor: "2026-05-27T17:30:00.000Z",
          payload: {
            bookingId: "booking-1"
          }
        },
        {
          jobId: "job-quote-1",
          kind: "quote_reminder",
          scheduledFor: "2026-05-27T17:31:00.000Z",
          payload: {
            quoteId: "quote-1"
          }
        },
        {
          jobId: "job-contract-1",
          kind: "contract_reminder",
          scheduledFor: "2026-05-27T17:32:00.000Z",
          payload: {
            contractId: "contract-1"
          }
        },
        {
          jobId: "job-form-1",
          kind: "form_reminder",
          scheduledFor: "2026-05-27T17:33:00.000Z",
          payload: {
            formId: "form-1"
          }
        }
      ]
    });

    const { createDefaultJobHandlers } = await import("../apps/jobs/src/bootstrap.js");
    const runtime = buildJobRuntime(createInMemoryJobProcessorDependencies(state, {
      handlers: createDefaultJobHandlers({
        bookingReminder: {
          findBookingReminderTarget: async (bookingId: string) => {
            const booking = state.bookings.find((candidate) => candidate.id === bookingId) ?? null;
            if (booking == null) {
              return null;
            }

            const portalUser = state.portalUsers.find((user) => user.clientId === booking.clientId);
            if (portalUser == null) {
              return null;
            }

            return {
              booking,
              recipientEmail: portalUser.email
            };
          },
          queueReminderEmail: async (message: (typeof state.sentEmails)[number]) => {
            state.queuedEmails.push(message);
          },
          buildPortalBookingUrl: (bookingId: string) => `https://portal.example.test/portal/bookings/${bookingId}`
        },
        quoteReminder: {
          findQuoteReminderTarget: async (quoteId: string) => {
            const quote = state.quotes.find((candidate) => candidate.id === quoteId) ?? null;
            if (quote == null) {
              return null;
            }

            const portalUser = state.portalUsers.find((user) => user.clientId === quote.clientId);
            if (portalUser == null) {
              return null;
            }

            return {
              quote,
              recipientEmail: portalUser.email
            };
          },
          queueReminderEmail: async (message: (typeof state.sentEmails)[number]) => {
            state.queuedEmails.push(message);
          },
          buildQuoteAccessUrl: (quoteId: string, token: string | null) => token == null
            ? `https://portal.example.test/portal/quotes/${quoteId}`
            : `https://portal.example.test/api/public/quotes/${quoteId}?token=${token}`
        },
        contractReminder: {
          findContractReminderTarget: async (contractId: string) => {
            const contract = state.contracts.find((candidate) => candidate.id === contractId) ?? null;
            if (contract == null) {
              return null;
            }

            const portalUser = state.portalUsers.find((user) => user.clientId === contract.clientId);
            if (portalUser == null) {
              return null;
            }

            return {
              contract,
              recipientEmail: portalUser.email
            };
          },
          queueReminderEmail: async (message: (typeof state.sentEmails)[number]) => {
            state.queuedEmails.push(message);
          },
          buildContractAccessUrl: (contractId: string, token: string | null) => token == null
            ? `https://portal.example.test/portal/contracts/${contractId}`
            : `https://portal.example.test/api/public/contracts/${contractId}?token=${token}`
        },
        formReminder: {
          findFormReminderTarget: async (formId: string) => {
            const submission = state.formSubmissions.find((candidate) => candidate.id === formId) ?? null;
            if (submission == null) {
              return null;
            }

            const portalUser = state.portalUsers.find((user) => user.clientId === submission.clientId);
            if (portalUser == null) {
              return null;
            }

            return {
              submission,
              recipientEmail: portalUser.email
            };
          },
          queueReminderEmail: async (message: (typeof state.sentEmails)[number]) => {
            state.queuedEmails.push(message);
          },
          buildFormAccessUrl: (formId: string, token: string | null) => token == null
            ? `https://portal.example.test/portal/forms/${formId}`
            : `https://portal.example.test/api/public/forms/${formId}?token=${token}`
        }
      } as unknown as Parameters<typeof createDefaultJobHandlers>[0])
    }));

    const result = await runtime.processDueWork();

    expect(result.jobResults).toHaveLength(4);
    expect(result.jobResults.every((jobResult) => jobResult.success)).toBe(true);
    expect(state.sentEmails).toHaveLength(4);
    expect(state.sentEmails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        templateKey: "booking_reminder",
        html: expect.stringContaining("https://portal.example.test/portal/bookings/booking-1")
      }),
      expect.objectContaining({
        templateKey: "quote_reminder",
        html: expect.stringContaining("https://portal.example.test/api/public/quotes/quote-1?token=quote-access-token-123456")
      }),
      expect.objectContaining({
        templateKey: "contract_reminder",
        html: expect.stringContaining("https://portal.example.test/api/public/contracts/contract-1?token=contract-access-token-123456")
      }),
      expect.objectContaining({
        templateKey: "form_reminder",
        html: expect.stringContaining("https://portal.example.test/api/public/forms/form-1?token=form-access-token-123456")
      })
    ]));
  });

  it("queues scheduled email sender payloads into outbound delivery", async () => {
    const state = createInMemoryPlatformState({
      queuedJobs: [{
        jobId: "job-scheduled-email-1",
        kind: "scheduled_email_sender",
        scheduledFor: "2026-05-27T17:30:00.000Z",
        payload: {
          to: ["client@example.com"],
          subject: "Scheduled follow-up",
          html: "<p>We are checking in about your training plan.</p>",
          templateKey: "scheduled_follow_up"
        }
      }]
    });

    const { createDefaultJobHandlers } = await import("../apps/jobs/src/bootstrap.js");
    const runtime = buildJobRuntime(createInMemoryJobProcessorDependencies(state, {
      handlers: createDefaultJobHandlers({
        scheduledEmailSender: {
          queueScheduledEmail: async (message: (typeof state.sentEmails)[number]) => {
            state.queuedEmails.push(message);
          }
        }
      } as unknown as Parameters<typeof createDefaultJobHandlers>[0])
    }));

    const result = await runtime.processDueWork();

    expect(result.jobResults[0]?.success).toBe(true);
    expect(result.jobResults[0]?.summary).toContain("client@example.com");
    expect(state.sentEmails).toEqual([{
      to: ["client@example.com"],
      subject: "Scheduled follow-up",
      html: "<p>We are checking in about your training plan.</p>",
      templateKey: "scheduled_follow_up"
    }]);
  });

  it("reconciles unresolved unmatched emails when a single client match now exists", async () => {
    const state = createInMemoryPlatformState({
      portalUsers: [{
        clientId: "client-1",
        email: "resolved@example.com",
        displayName: "Resolved Client",
        passwordHash: "hash-1",
        archived: false
      }],
      queuedJobs: [{
        jobId: "job-unmatched-cleaner-1",
        kind: "unmatched_email_cleaner",
        scheduledFor: "2026-05-27T17:30:00.000Z",
        payload: {
          limit: 10
        }
      }]
    });

    state.inboundEmails.push({
      id: "inbound-email-1",
      provider: "imap",
      mailbox: "INBOX",
      messageId: "imap-message-2",
      receivedAt: "2026-05-27T16:00:00.000Z",
      fromEmail: "resolved@example.com",
      subject: "Need help with credits",
      matchedClientId: null,
      rawPayload: {
        messageId: "imap-message-2"
      }
    });
    state.unmatchedEmails.push({
      id: "unmatched-email-1",
      inboundEmailId: "inbound-email-1",
      reason: "no_client_match",
      detectedAt: "2026-05-27T16:01:00.000Z",
      resolvedAt: null
    });

    const { createDefaultJobHandlers } = await import("../apps/jobs/src/bootstrap.js");
    const runtime = buildJobRuntime(createInMemoryJobProcessorDependencies(state, {
      handlers: createDefaultJobHandlers({
        unmatchedEmailCleaner: {
          now: state.now,
          listUnresolvedUnmatchedEmails: async (limit: number) => state.unmatchedEmails
            .filter((record) => record.resolvedAt == null)
            .slice(0, limit)
            .map((record) => ({
              unmatchedEmail: record,
              inboundEmail: state.inboundEmails.find((email) => email.id === record.inboundEmailId) ?? null
            }))
            .filter((record) => record.inboundEmail != null),
          findPortalUsersByEmail: async (email: string) => state.portalUsers
            .filter((user) => user.email === email && !user.archived)
            .map((user) => ({
              id: user.clientId,
              email: user.email
            })),
          resolveUnmatchedEmail: async ({
            unmatchedEmailId,
            inboundEmailId,
            matchedClientId,
            resolvedAt
          }: {
            unmatchedEmailId: string;
            inboundEmailId: string;
            matchedClientId: string;
            resolvedAt: string;
          }) => {
            const unmatchedIndex = state.unmatchedEmails.findIndex((record) => record.id === unmatchedEmailId);
            if (unmatchedIndex >= 0) {
              state.unmatchedEmails[unmatchedIndex] = {
                ...state.unmatchedEmails[unmatchedIndex],
                resolvedAt
              };
            }

            const inboundIndex = state.inboundEmails.findIndex((record) => record.id === inboundEmailId);
            if (inboundIndex >= 0) {
              state.inboundEmails[inboundIndex] = {
                ...state.inboundEmails[inboundIndex],
                matchedClientId
              };
            }
          }
        }
      } as unknown as Parameters<typeof createDefaultJobHandlers>[0])
    }));

    const result = await runtime.processDueWork();

    expect(result.jobResults[0]?.success).toBe(true);
    expect(result.jobResults[0]?.summary).toContain("Resolved 1 unmatched email");
    expect(state.inboundEmails[0]?.matchedClientId).toBe("client-1");
    expect(state.unmatchedEmails[0]?.resolvedAt).toBe("2026-05-27T18:00:00.000Z");
  });

  it("processes due workflow step executions into outbound workflow emails", async () => {
    const state = createInMemoryPlatformState({
      portalUsers: [{
        clientId: "client-1",
        email: "workflow-client@example.com",
        displayName: "Workflow Client",
        passwordHash: "hash-1",
        archived: false
      }],
      queuedJobs: [{
        jobId: "job-workflow-1",
        kind: "workflow_processor",
        scheduledFor: "2026-05-27T17:30:00.000Z",
        payload: {
          limit: 10
        }
      }]
    });

    const workflows = [{
      id: "workflow-1",
      name: "Invoice Overdue Follow-up",
      trigger: "scheduled" as const,
      active: true
    }];
    const workflowSteps = [{
      id: "workflow-step-1",
      workflowId: "workflow-1",
      stepOrder: 1,
      stepName: "Reminder Email",
      emailSubject: "Reminder for {client_name}",
      emailBodyHtml: "<p>Hello {client_name}, review {workflow_name}.</p>",
      emailBodyText: "Hello {client_name}",
      delayType: "immediate" as const,
      delayValue: null,
      scheduledDate: null,
      attachContractId: null,
      attachFormId: null,
      attachQuoteId: null,
      attachInvoiceId: null,
      includeAppointmentLink: false,
      appointmentTypeId: null
    }];
    const workflowEnrollments = [{
      id: "enrollment-1",
      workflowId: "workflow-1",
      clientId: "client-1",
      enrolledAt: "2026-05-27T16:00:00.000Z",
      completedAt: null as string | null
    }];
    const workflowStepExecutions: Array<{
      id: string;
      enrollmentId: string;
      stepId: string;
      scheduledFor: string;
      executedAt: string | null;
      status: "pending" | "completed";
      errorMessage: string | null;
    }> = [{
      id: "workflow-step-execution-1",
      enrollmentId: "enrollment-1",
      stepId: "workflow-step-1",
      scheduledFor: "2026-05-27T17:00:00.000Z",
      executedAt: null as string | null,
      status: "pending",
      errorMessage: null as string | null
    }];

    const { createDefaultJobHandlers } = await import("../apps/jobs/src/bootstrap.js");
    const runtime = buildJobRuntime(createInMemoryJobProcessorDependencies(state, {
      handlers: createDefaultJobHandlers({
        workflowProcessor: {
          now: state.now,
          listDueWorkflowStepExecutions: async (limit: number) => workflowStepExecutions
            .filter((execution) => execution.status === "pending")
            .slice(0, limit)
            .map((execution) => ({
              execution,
              enrollment: workflowEnrollments.find((enrollment) => enrollment.id === execution.enrollmentId) ?? null,
              step: workflowSteps.find((step) => step.id === execution.stepId) ?? null
            }))
            .filter((record): record is {
              execution: typeof workflowStepExecutions[number];
              step: typeof workflowSteps[number];
              workflow: typeof workflows[number];
              enrollment: typeof workflowEnrollments[number];
            } => record.enrollment != null && record.step != null)
            .map((record) => ({
              workflow: workflows.find((workflow) => workflow.id === record.enrollment.workflowId) ?? workflows[0],
              enrollment: record.enrollment,
              step: record.step,
              execution: record.execution,
              recipientEmail: "workflow-client@example.com",
              recipientDisplayName: "Workflow Client"
            })),
          queueWorkflowEmail: async (message: (typeof state.sentEmails)[number]) => {
            state.queuedEmails.push(message);
          },
          markWorkflowStepExecutionCompleted: async (executionId: string, completedAt: string) => {
            const index = workflowStepExecutions.findIndex((execution) => execution.id === executionId);
            if (index >= 0) {
              workflowStepExecutions[index] = {
                ...workflowStepExecutions[index],
                executedAt: completedAt,
                status: "completed"
              };
            }
            workflowEnrollments[0] = {
              ...workflowEnrollments[0],
              completedAt
            };
          },
          buildPortalClientUrl: (clientId: string) => `https://portal.example.test/portal?client=${clientId}`
        }
      } as unknown as Parameters<typeof createDefaultJobHandlers>[0])
    }));

    const result = await runtime.processDueWork();

    expect(result.jobResults[0]?.success).toBe(true);
    expect(result.jobResults[0]?.summary).toContain("Processed 1 workflow step execution");
    expect(workflowEnrollments[0]?.completedAt).toBe("2026-05-27T18:00:00.000Z");
    expect(workflowStepExecutions[0]?.status).toBe("completed");
    expect(workflowStepExecutions[0]?.executedAt).toBe("2026-05-27T18:00:00.000Z");
    expect(state.sentEmails).toEqual([{
      to: ["workflow-client@example.com"],
      subject: "Reminder for Workflow Client",
      html: expect.stringContaining("https://portal.example.test/portal?client=client-1"),
      templateKey: "workflow_step"
    }]);
  });
});
