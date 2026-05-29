import { z } from "zod";

export const timestampSchema = z.string().datetime();
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
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
export const workflowTriggerSchema = z.enum(["booking_created", "invoice_overdue", "manual", "scheduled"]);
