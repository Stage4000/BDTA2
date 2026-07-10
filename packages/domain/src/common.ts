import { z } from "zod";

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDateOnly(value: Date): string {
  return `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}`;
}

export const timestampSchema = z.union([
  z.string().datetime(),
  z.date().transform((value) => value.toISOString())
]);
export const dateSchema = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.date().transform((value) => formatDateOnly(value))
]);
export const idSchema = z.string().min(1);
export const emailSchema = z.string().email();
export const moneySchema = z.number().finite();

export const publicAccessTokenSchema = z.object({
  token: z.string().min(16),
  issuedAt: timestampSchema,
  expiresAt: timestampSchema.nullable(),
  legacySourceId: idSchema.nullable()
});

export type PublicAccessToken = z.infer<typeof publicAccessTokenSchema>;

export const adminRoleSchema = z.enum(["owner", "admin", "accountant", "staff"]);
export const bookingStatusSchema = z.enum(["pending", "confirmed", "completed", "cancelled"]);
export const invoiceStatusSchema = z.enum(["draft", "sent", "partially_paid", "paid", "overdue", "void"]);
export const quoteStatusSchema = z.enum(["draft", "sent", "accepted", "declined", "expired"]);
export const contractStatusSchema = z.enum(["draft", "sent", "signed", "void"]);
export const achievementScopeSchema = z.enum(["general", "custom"]);
export const achievementModeSchema = z.enum(["badge_only", "certificate_only", "badge_certificate"]);
export const clientAchievementStatusSchema = z.enum(["awarded", "revoked"]);
export const workflowTriggerSchema = z.enum([
  "appointment_booking",
  "booking_created",
  "form_submission",
  "invoice_overdue",
  "manual",
  "scheduled"
]);
export const workflowAutoEnrollmentTriggerTypeSchema = z.enum([
  "appointment_booking",
  "form_submission"
]);
export const workflowEnrollmentStatusSchema = z.enum(["active", "completed", "cancelled"]);
export const workflowStepDelayTypeSchema = z.enum([
  "immediate",
  "after_enrollment",
  "after_previous",
  "specific_date"
]);
export const workflowStepExecutionStatusSchema = z.enum(["pending", "completed", "cancelled", "failed"]);
