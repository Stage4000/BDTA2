import { z } from "zod";

import {
  adminRoleSchema,
  achievementModeSchema,
  achievementScopeSchema,
  bookingStatusSchema,
  clientAchievementStatusSchema,
  dateSchema,
  contractStatusSchema,
  emailSchema,
  idSchema,
  invoiceStatusSchema,
  moneySchema,
  publicAccessTokenSchema,
  quoteStatusSchema,
  timestampSchema,
  workflowTriggerSchema
} from "./common.js";

export const adminUserSchema = z.object({
  id: idSchema,
  email: emailSchema,
  displayName: z.string().min(1),
  role: adminRoleSchema,
  active: z.boolean()
});

export const clientSchema = z.object({
  id: idSchema,
  email: emailSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  archived: z.boolean()
});

export const clientContactSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  name: z.string().min(1),
  email: emailSchema,
  phone: z.string().min(1),
  isPrimary: z.boolean()
});

export const clientProfileSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  email: emailSchema,
  phone: z.string(),
  address: z.string(),
  notes: z.string(),
  isAdmin: z.boolean(),
  archived: z.boolean()
});

export const blogPostSchema = z.object({
  id: idSchema,
  title: z.string().min(1),
  slug: z.string().min(1),
  content: z.string(),
  excerpt: z.string(),
  coverPhoto: z.string().min(1).nullable(),
  author: z.string().min(1),
  published: z.boolean(),
  publishDate: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});

export const sitePageSchema = z.object({
  id: idSchema,
  slug: z.string().min(1),
  title: z.string().min(1),
  htmlContent: z.string(),
  cssContent: z.string(),
  metaDescription: z.string(),
  metaKeywords: z.string(),
  ogTitle: z.string().min(1).nullable(),
  ogDescription: z.string().min(1).nullable(),
  ogImage: z.string().min(1).nullable(),
  isHomepage: z.boolean(),
  published: z.boolean(),
  sortOrder: z.number().int(),
  updatedByAdminUserId: idSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});

export const settingSchema = z.object({
  id: idSchema,
  key: z.string().min(1),
  value: z.string(),
  type: z.string().min(1),
  category: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  secret: z.boolean(),
  updatedAt: timestampSchema
});

export const petSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  name: z.string().min(1),
  species: z.string().min(1),
  archived: z.boolean()
});

export const petFileSchema = z.object({
  id: idSchema,
  petId: idSchema,
  fileType: z.enum(["photo", "document"]),
  fileName: z.string().min(1),
  originalName: z.string().min(1),
  fileSize: z.number().int().nonnegative(),
  mimeType: z.string().min(1),
  description: z.string(),
  uploadedByAdminUserId: idSchema.nullable(),
  uploadedAt: timestampSchema
});

export const achievementTypeSchema = z.object({
  id: idSchema,
  title: z.string().min(1),
  description: z.string(),
  scopeType: achievementScopeSchema,
  awardMode: achievementModeSchema,
  badgeIconPath: z.string().min(1).nullable(),
  certificateTemplatePath: z.string().min(1).nullable(),
  certificateBodyHtml: z.string().nullable(),
  active: z.boolean()
});

export const clientAchievementSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  achievementTypeId: idSchema,
  title: z.string().min(1),
  description: z.string(),
  scopeType: achievementScopeSchema,
  awardMode: achievementModeSchema,
  badgeIconPath: z.string().min(1).nullable(),
  certificateTemplatePath: z.string().min(1).nullable(),
  certificateBodyHtml: z.string().nullable(),
  status: clientAchievementStatusSchema,
  awardedOn: dateSchema,
  dogName: z.string().nullable(),
  programName: z.string().nullable(),
  notes: z.string(),
  awardedByAdminUserId: idSchema.nullable(),
  updatedByAdminUserId: idSchema.nullable(),
  revokedByAdminUserId: idSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});

export const bookingSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  petIds: z.array(idSchema),
  serviceId: idSchema,
  startsAt: timestampSchema,
  endsAt: timestampSchema,
  status: bookingStatusSchema,
  icalAccess: publicAccessTokenSchema.nullable()
});

export const invoiceSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  status: invoiceStatusSchema,
  totalAmount: moneySchema,
  outstandingAmount: moneySchema,
  dueAt: timestampSchema.nullable()
});

export const quoteSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  status: quoteStatusSchema,
  totalAmount: moneySchema,
  publicAccess: publicAccessTokenSchema.nullable()
});

export const contractSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  status: contractStatusSchema,
  publicAccess: publicAccessTokenSchema.nullable()
});

export const formTemplateSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  active: z.boolean()
});

export const formSubmissionSchema = z.object({
  id: idSchema,
  templateId: idSchema,
  clientId: idSchema,
  submittedAt: timestampSchema.nullable(),
  publicAccess: publicAccessTokenSchema.nullable()
});

export const packageSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  active: z.boolean(),
  price: moneySchema
});

export const creditSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  packageId: idSchema.nullable(),
  remainingUnits: z.number().int().nonnegative()
});

export const workflowSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  trigger: workflowTriggerSchema,
  active: z.boolean()
});

export const workflowEnrollmentSchema = z.object({
  id: idSchema,
  workflowId: idSchema,
  clientId: idSchema,
  enrolledAt: timestampSchema,
  completedAt: timestampSchema.nullable()
});

export const scheduledTaskSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  taskType: z.string().min(1),
  active: z.boolean()
});

export const taskLogSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  executedAt: timestampSchema,
  status: z.enum(["success", "failure"]),
  summary: z.string().min(1)
});

export const notificationSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  channel: z.enum(["email", "portal"]),
  createdAt: timestampSchema,
  subject: z.string().min(1)
});

export const inboundEmailSchema = z.object({
  id: idSchema,
  provider: z.enum(["imap", "mail_provider"]),
  mailbox: z.string().min(1),
  messageId: z.string().min(1),
  receivedAt: timestampSchema,
  fromEmail: emailSchema,
  subject: z.string().min(1),
  matchedClientId: idSchema.nullable(),
  rawPayload: z.record(z.unknown())
});

export const unmatchedEmailSchema = z.object({
  id: idSchema,
  inboundEmailId: idSchema,
  reason: z.enum(["no_client_match", "multiple_client_matches"]),
  detectedAt: timestampSchema,
  resolvedAt: timestampSchema.nullable()
});

export type AdminUser = z.infer<typeof adminUserSchema>;
export type Client = z.infer<typeof clientSchema>;
export type ClientContact = z.infer<typeof clientContactSchema>;
export type ClientProfile = z.infer<typeof clientProfileSchema>;
export type BlogPost = z.infer<typeof blogPostSchema>;
export type SitePage = z.infer<typeof sitePageSchema>;
export type Setting = z.infer<typeof settingSchema>;
export type Pet = z.infer<typeof petSchema>;
export type PetFile = z.infer<typeof petFileSchema>;
export type AchievementType = z.infer<typeof achievementTypeSchema>;
export type ClientAchievement = z.infer<typeof clientAchievementSchema>;
export type Booking = z.infer<typeof bookingSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type Contract = z.infer<typeof contractSchema>;
export type FormTemplate = z.infer<typeof formTemplateSchema>;
export type FormSubmission = z.infer<typeof formSubmissionSchema>;
export type Package = z.infer<typeof packageSchema>;
export type Credit = z.infer<typeof creditSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type WorkflowEnrollment = z.infer<typeof workflowEnrollmentSchema>;
export type ScheduledTask = z.infer<typeof scheduledTaskSchema>;
export type TaskLog = z.infer<typeof taskLogSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type InboundEmail = z.infer<typeof inboundEmailSchema>;
export type UnmatchedEmail = z.infer<typeof unmatchedEmailSchema>;
