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
  workflowAutoEnrollmentTriggerTypeSchema,
  workflowEnrollmentStatusSchema,
  workflowStepDelayTypeSchema,
  workflowStepExecutionStatusSchema,
  workflowTriggerSchema
} from "./common.js";

const blankStringToNull = (value: unknown) => value === "" ? null : value;
const blankStringToUndefined = (value: unknown) => value === "" ? undefined : value;

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

const timeOfDaySchema = z.string().regex(/^\d{2}:\d{2}$/);

const appointmentTypeSpecificDateTimeslotSchema = z.union([
  z.object({
    type: z.literal("point"),
    time: timeOfDaySchema
  }),
  z.object({
    type: z.literal("range"),
    start: timeOfDaySchema,
    end: timeOfDaySchema
  })
]);

const appointmentTypeSpecificDateSchema = z.object({
  date: dateSchema,
  timeslots: z.array(appointmentTypeSpecificDateTimeslotSchema)
});

const appointmentTypeDayScheduleSchema = z.object({
  start: timeOfDaySchema,
  end: timeOfDaySchema
});

export const appointmentTypeSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  description: z.string(),
  bulletPoints: z.array(z.string().min(1)),
  adminUserId: idSchema.nullable(),
  durationMinutes: z.number().int().positive(),
  bufferBeforeMinutes: z.number().int().nonnegative(),
  bufferAfterMinutes: z.number().int().nonnegative(),
  useTravelTimeBuffer: z.boolean(),
  travelTimeMinutes: z.number().int().nonnegative(),
  advanceBookingMinDays: z.number().int().nonnegative(),
  advanceBookingMaxDays: z.number().int().nonnegative(),
  cancellationNoticeHours: z.number().int().nonnegative(),
  requiresForms: z.boolean(),
  formTemplateIds: z.array(idSchema),
  requiresContract: z.boolean(),
  contractTemplateId: idSchema.nullable(),
  autoInvoice: z.boolean(),
  invoiceDueDays: z.number().int().nonnegative(),
  invoiceDueTiming: z.string().min(1),
  defaultAmount: moneySchema,
  consumesCredits: z.boolean(),
  creditCount: z.number().int().positive(),
  isGroupClass: z.boolean(),
  maxParticipants: z.number().int().positive(),
  publicAvailable: z.boolean(),
  portalAvailable: z.boolean(),
  scheduleType: z.string().min(1),
  specificDate: dateSchema.nullable(),
  specificDates: z.array(appointmentTypeSpecificDateSchema),
  availableDays: z.array(z.number().int().min(0).max(6)),
  availableStartTime: timeOfDaySchema,
  availableEndTime: timeOfDaySchema,
  timeSlotInterval: z.number().int().positive(),
  perDaySchedule: z.record(z.string(), appointmentTypeDayScheduleSchema),
  isMiniSession: z.boolean(),
  miniSessionLocation: z.string(),
  miniSessionTopic: z.string(),
  isFieldRental: z.boolean(),
  fieldRentalLocation: z.string(),
  groupClassLocation: z.string(),
  locationTypes: z.array(z.string().min(1)),
  confirmationTemplateId: idSchema.nullable(),
  bookingRequestTemplateId: idSchema.nullable(),
  invoiceTemplateId: idSchema.nullable(),
  reminderTemplateId: idSchema.nullable(),
  cancellationTemplateId: idSchema.nullable(),
  requiresAdminConfirmation: z.boolean(),
  usesResource: z.boolean(),
  resourceName: z.string(),
  resourceCapacity: z.number().int().positive(),
  resourceAllocation: z.string().min(1),
  uniqueLink: z.string().min(1),
  active: z.boolean(),
  createdAt: timestampSchema.nullable().optional(),
  updatedAt: timestampSchema.nullable().optional()
});

export const emailTemplateSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  templateType: z.string().min(1),
  subject: z.string().min(1),
  bodyHtml: z.string(),
  bodyText: z.string(),
  active: z.boolean(),
  createdAt: timestampSchema.nullable().optional(),
  updatedAt: timestampSchema.nullable().optional()
});

export const petSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  name: z.string().min(1),
  species: z.string().min(1),
  petSittingNotes: z.string(),
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
  adminUserId: idSchema.nullable().optional(),
  icalAccess: publicAccessTokenSchema.nullable()
});

export const expenseSchema = z.object({
  id: idSchema,
  clientId: idSchema.nullable(),
  clientName: z.string().min(1).nullable().optional(),
  category: z.string().min(1),
  description: z.string().min(1),
  amount: moneySchema,
  expenseDate: dateSchema.nullable(),
  receiptFile: z.string().min(1).nullable().optional(),
  billable: z.boolean(),
  invoiced: z.boolean(),
  notes: z.string(),
  createdAt: timestampSchema.nullable().optional()
});

export const invoiceSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  status: invoiceStatusSchema,
  totalAmount: moneySchema,
  outstandingAmount: moneySchema,
  dueAt: timestampSchema.nullable()
});

export const quoteLineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number(),
  unitPrice: moneySchema,
  amount: moneySchema,
  itemType: z.string().min(1).optional(),
  referenceId: idSchema.nullable().optional()
});

export const quoteSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  status: quoteStatusSchema,
  totalAmount: moneySchema,
  quoteNumber: z.preprocess(blankStringToUndefined, z.string().min(1).optional()),
  title: z.preprocess(blankStringToUndefined, z.string().min(1).optional()),
  description: z.string().optional(),
  expiresAt: z.preprocess(blankStringToNull, timestampSchema.nullable().optional()),
  acceptedAt: z.preprocess(blankStringToNull, timestampSchema.nullable().optional()),
  declinedAt: z.preprocess(blankStringToNull, timestampSchema.nullable().optional()),
  items: z.array(quoteLineItemSchema).optional(),
  publicAccess: publicAccessTokenSchema.nullable()
});

export const contractSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  status: contractStatusSchema,
  contractNumber: z.preprocess(blankStringToUndefined, z.string().min(1).optional()),
  title: z.preprocess(blankStringToUndefined, z.string().min(1).optional()),
  description: z.string().optional(),
  contractText: z.string().optional(),
  effectiveDate: z.preprocess(blankStringToNull, dateSchema.nullable().optional()),
  signedAt: z.preprocess(blankStringToNull, timestampSchema.nullable().optional()),
  signatureTypedName: z.string().nullable().optional(),
  signatureFont: z.string().nullable().optional(),
  publicAccess: publicAccessTokenSchema.nullable()
});

export const formTemplateSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  active: z.boolean(),
  description: z.string().optional(),
  fields: z.array(z.record(z.string(), z.unknown())).optional(),
  formType: z.string().min(1).optional(),
  requiredFrequency: z.preprocess(blankStringToNull, z.string().min(1).nullable().optional()),
  appointmentTypeId: idSchema.nullable().optional(),
  templateIsInternal: z.boolean().nullable().optional(),
  templateShowInClientPortal: z.boolean().nullable().optional()
});

export const formSubmissionSchema = z.object({
  id: idSchema,
  templateId: idSchema,
  clientId: idSchema,
  clientName: z.string().min(1).nullable().optional(),
  bookingId: idSchema.nullable().optional(),
  bookingSummary: z.string().nullable().optional(),
  petId: idSchema.nullable().optional(),
  petName: z.string().min(1).nullable().optional(),
  templateName: z.string().min(1).nullable().optional(),
  templateDescription: z.string().nullable().optional(),
  templateFields: z.array(z.record(z.string(), z.unknown())).optional(),
  formType: z.string().min(1).optional(),
  templateIsInternal: z.boolean().nullable().optional(),
  templateShowInClientPortal: z.boolean().nullable().optional(),
  clientReviewSubmission: z.boolean().optional(),
  status: z.string().min(1).optional(),
  submittedByAdminUserId: idSchema.nullable().optional(),
  submittedByName: z.string().min(1).nullable().optional(),
  reviewedByAdminUserId: idSchema.nullable().optional(),
  reviewedByName: z.string().min(1).nullable().optional(),
  reviewedAt: timestampSchema.nullable().optional(),
  notes: z.string().optional(),
  contactName: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  responses: z.array(z.unknown()).optional(),
  submittedAt: timestampSchema.nullable(),
  publicAccess: publicAccessTokenSchema.nullable()
});

export const packageItemSchema = z.object({
  appointmentTypeId: idSchema.nullable().optional(),
  appointmentTypeName: z.string().min(1),
  quantity: z.number().int().positive()
});

export const packageSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  active: z.boolean(),
  price: moneySchema,
  description: z.string().optional(),
  bulletPoints: z.array(z.string().min(1)).optional(),
  expirationDays: z.number().int().positive().nullable().optional(),
  shareToken: z.string().min(1).nullable().optional(),
  portalAvailable: z.boolean().optional(),
  formTemplateId: idSchema.nullable().optional(),
  items: z.array(packageItemSchema).optional()
});

export const creditSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  packageId: idSchema.nullable(),
  appointmentTypeId: idSchema,
  remainingUnits: z.number().int().nonnegative()
});

export const workflowSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  trigger: workflowTriggerSchema,
  active: z.boolean(),
  createdAt: timestampSchema.optional()
});

export const workflowAutoEnrollmentTriggerSchema = z.object({
  id: idSchema,
  workflowId: idSchema,
  triggerType: workflowAutoEnrollmentTriggerTypeSchema,
  appointmentTypeId: idSchema.nullable().optional(),
  formTemplateId: idSchema.nullable().optional(),
  active: z.boolean(),
  createdAt: timestampSchema.optional()
}).superRefine((trigger, ctx) => {
  if (trigger.triggerType === "appointment_booking") {
    if (trigger.appointmentTypeId == null || trigger.appointmentTypeId.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Appointment-booking workflow triggers require an appointment type."
      });
    }
    if (trigger.formTemplateId != null && trigger.formTemplateId.trim() !== "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Appointment-booking workflow triggers cannot include a form template."
      });
    }
    return;
  }

  if (trigger.formTemplateId == null || trigger.formTemplateId.trim() === "") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Form-submission workflow triggers require a form template."
    });
  }
  if (trigger.appointmentTypeId != null && trigger.appointmentTypeId.trim() !== "") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Form-submission workflow triggers cannot include an appointment type."
    });
  }
});

export const workflowEnrollmentSchema = z.object({
  id: idSchema,
  workflowId: idSchema,
  clientId: idSchema,
  enrolledAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
  nextRunAt: timestampSchema.nullable().optional(),
  status: workflowEnrollmentStatusSchema.optional(),
  enrolledByAdminUserId: idSchema.nullable().optional(),
  cancelledAt: timestampSchema.nullable().optional()
});

export const workflowStepSchema = z.object({
  id: idSchema,
  workflowId: idSchema,
  stepOrder: z.number().int().positive(),
  stepName: z.string().min(1),
  emailSubject: z.string().min(1),
  emailBodyHtml: z.string(),
  emailBodyText: z.string().nullable().optional(),
  delayType: workflowStepDelayTypeSchema,
  delayValue: z.string().nullable().optional(),
  scheduledDate: timestampSchema.nullable().optional(),
  attachContractId: idSchema.nullable().optional(),
  attachFormId: idSchema.nullable().optional(),
  attachQuoteId: idSchema.nullable().optional(),
  attachInvoiceId: idSchema.nullable().optional(),
  includeAppointmentLink: z.boolean(),
  appointmentTypeId: idSchema.nullable().optional(),
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional()
});

export const workflowStepExecutionSchema = z.object({
  id: idSchema,
  enrollmentId: idSchema,
  stepId: idSchema,
  scheduledFor: timestampSchema,
  executedAt: timestampSchema.nullable(),
  status: workflowStepExecutionStatusSchema,
  errorMessage: z.string().nullable().optional()
});

export const scheduledTaskSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  taskType: z.string().min(1),
  scheduleType: z.string().min(1),
  scheduleValue: z.string(),
  active: z.boolean(),
  lastRunAt: timestampSchema.nullable().optional(),
  nextRunAt: timestampSchema.nullable().optional()
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
  entityType: z.string().min(1),
  entityId: idSchema.nullable(),
  createdAt: timestampSchema,
  subject: z.string().min(1),
  message: z.string(),
  url: z.string().min(1),
  isRead: z.boolean()
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
export type AppointmentType = z.infer<typeof appointmentTypeSchema>;
export type EmailTemplate = z.infer<typeof emailTemplateSchema>;
export type Pet = z.infer<typeof petSchema>;
export type PetFile = z.infer<typeof petFileSchema>;
export type AchievementType = z.infer<typeof achievementTypeSchema>;
export type ClientAchievement = z.infer<typeof clientAchievementSchema>;
export type Booking = z.infer<typeof bookingSchema>;
export type Expense = z.infer<typeof expenseSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type Contract = z.infer<typeof contractSchema>;
export type FormTemplate = z.infer<typeof formTemplateSchema>;
export type FormSubmission = z.infer<typeof formSubmissionSchema>;
export type PackageItem = z.infer<typeof packageItemSchema>;
export type Package = z.infer<typeof packageSchema>;
export type Credit = z.infer<typeof creditSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type WorkflowAutoEnrollmentTrigger = z.infer<typeof workflowAutoEnrollmentTriggerSchema>;
export type WorkflowEnrollment = z.infer<typeof workflowEnrollmentSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowStepExecution = z.infer<typeof workflowStepExecutionSchema>;
export type ScheduledTask = z.infer<typeof scheduledTaskSchema>;
export type TaskLog = z.infer<typeof taskLogSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type InboundEmail = z.infer<typeof inboundEmailSchema>;
export type UnmatchedEmail = z.infer<typeof unmatchedEmailSchema>;
