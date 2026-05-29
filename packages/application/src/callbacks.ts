import { z } from "zod";

import {
  integrationCallbackReceiptSchema,
  integrationCallbackSchema,
  jobEnvelopeSchema,
  type IntegrationCallback,
  type IntegrationCallbackReceipt,
  type SupportedJobKind
} from "@bdta/contracts";
import { invoiceStatusSchema, timestampSchema } from "@bdta/domain";

const integrationCallbackRequestSchema = z.object({
  provider: integrationCallbackSchema.shape.provider,
  receivedAt: timestampSchema.optional(),
  payload: integrationCallbackSchema.shape.payload
});

export type IntegrationCallbackRecord = IntegrationCallback & {
  callbackId: string;
  queuedJobId: string | null;
};

export type IntegrationCallbackDependencies = {
  now(): string;
  generateId(prefix: string): string;
  recordIntegrationCallback(record: IntegrationCallbackRecord): Promise<void>;
  queueJob(job: z.infer<typeof jobEnvelopeSchema>): Promise<void>;
  applyStripeInvoiceUpdate(input: {
    invoiceId: string;
    paymentStatus: Extract<z.infer<typeof invoiceStatusSchema>, "sent" | "partially_paid" | "paid" | "overdue" | "void">;
    outstandingAmount: number;
  }): Promise<void>;
  applyGoogleCalendarSyncUpdate(input: {
    bookingId: string;
    externalEventId: string;
    externalEventUrl: string | null;
    syncedAt: string;
  }): Promise<void>;
};

const stripeInvoiceCallbackPayloadSchema = z.object({
  invoiceId: z.string().min(1),
  paymentStatus: z.enum(["sent", "partially_paid", "paid", "overdue", "void"]),
  outstandingAmount: z.number().finite().nonnegative()
});

const googleCalendarCallbackPayloadSchema = z.object({
  bookingId: z.string().min(1),
  externalEventId: z.string().min(1),
  externalEventUrl: z.string().url().nullable().optional()
});

export async function acceptIntegrationCallback(
  input: unknown,
  dependencies: IntegrationCallbackDependencies
): Promise<IntegrationCallbackReceipt> {
  const request = integrationCallbackRequestSchema.parse(input);
  const callbackId = dependencies.generateId("callback");
  const receivedAt = request.receivedAt ?? dependencies.now();
  let queuedJobId: string | null = null;

  if (request.provider === "imap" || request.provider === "mail_provider") {
    queuedJobId = dependencies.generateId("job");
    await dependencies.queueJob(jobEnvelopeSchema.parse({
      jobId: queuedJobId,
      kind: "email_receiver" satisfies SupportedJobKind,
      scheduledFor: dependencies.now(),
      payload: {
        callbackId,
        provider: request.provider,
        receivedAt,
        ...request.payload
      }
    }));
  }

  if (request.provider === "stripe") {
    const stripePayload = stripeInvoiceCallbackPayloadSchema.parse(request.payload);
    await dependencies.applyStripeInvoiceUpdate(stripePayload);
  }

  if (request.provider === "google_calendar") {
    const googleCalendarPayload = googleCalendarCallbackPayloadSchema.parse(request.payload);
    await dependencies.applyGoogleCalendarSyncUpdate({
      bookingId: googleCalendarPayload.bookingId,
      externalEventId: googleCalendarPayload.externalEventId,
      externalEventUrl: googleCalendarPayload.externalEventUrl ?? null,
      syncedAt: receivedAt
    });
  }

  await dependencies.recordIntegrationCallback({
    callbackId,
    provider: request.provider,
    receivedAt,
    payload: request.payload,
    queuedJobId
  });

  return integrationCallbackReceiptSchema.parse({
    accepted: true,
    provider: request.provider,
    callbackId,
    queuedJobId
  });
}
