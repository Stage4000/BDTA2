import { z } from "zod";

import { idSchema, timestampSchema } from "@bdta/domain";

export const supportedJobKinds = [
  "booking_reminder",
  "contract_reminder",
  "form_reminder",
  "quote_reminder",
  "invoice_reminder",
  "workflow_processor",
  "scheduled_email_sender",
  "email_receiver",
  "unmatched_email_cleaner"
] as const;

export const jobKindSchema = z.enum(supportedJobKinds);

export const jobEnvelopeSchema = z.object({
  jobId: idSchema,
  kind: jobKindSchema,
  scheduledFor: timestampSchema,
  payload: z.record(z.unknown())
});

export const jobResultSchema = z.object({
  jobId: idSchema,
  kind: jobKindSchema,
  processedAt: timestampSchema,
  success: z.boolean(),
  summary: z.string().min(1)
});

export type SupportedJobKind = (typeof supportedJobKinds)[number];
export type JobEnvelope = z.infer<typeof jobEnvelopeSchema>;
export type JobResult = z.infer<typeof jobResultSchema>;
