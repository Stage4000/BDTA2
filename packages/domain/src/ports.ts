import { z } from "zod";

import { idSchema, publicAccessTokenSchema, timestampSchema } from "./common.js";

export const paymentProviderSchema = z.object({
  provider: z.literal("stripe"),
  invoiceId: idSchema,
  amount: z.number().finite(),
  returnUrl: z.string().url()
});

export const calendarSyncRequestSchema = z.object({
  bookingId: idSchema,
  adminUserId: idSchema,
  provider: z.enum(["google_calendar", "ical"])
});

export const outboundEmailSchema = z.object({
  to: z.array(z.string().email()).min(1),
  subject: z.string().min(1),
  html: z.string().min(1),
  templateKey: z.string().min(1)
});

export const inboundImapMessageSchema = z.object({
  mailbox: z.string().min(1),
  messageId: z.string().min(1),
  receivedAt: timestampSchema,
  subject: z.string().min(1)
});

export const captchaVerificationSchema = z.object({
  provider: z.enum(["turnstile"]),
  token: z.string().min(1),
  remoteIp: z.string().min(1).optional()
});

export const publicLinkRequestSchema = z.object({
  resourceKind: z.enum(["quote", "contract", "form_submission", "booking_ical"]),
  resourceId: idSchema,
  access: publicAccessTokenSchema
});

export type PaymentProviderRequest = z.infer<typeof paymentProviderSchema>;
export type CalendarSyncRequest = z.infer<typeof calendarSyncRequestSchema>;
export type OutboundEmailMessage = z.infer<typeof outboundEmailSchema>;
export type InboundImapMessage = z.infer<typeof inboundImapMessageSchema>;
export type CaptchaVerificationRequest = z.infer<typeof captchaVerificationSchema>;
export type PublicLinkRequest = z.infer<typeof publicLinkRequestSchema>;
