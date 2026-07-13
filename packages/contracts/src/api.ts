import { z } from "zod";

import {
  blogPostSchema,
  bookingSchema,
  achievementTypeSchema,
  appointmentTypeSchema,
  clientAchievementSchema,
  clientSchema,
  clientContactSchema,
  clientProfileSchema,
  contractSchema,
  creditSchema,
  emailTemplateSchema,
  emailSchema,
  expenseSchema,
  formTemplateSchema,
  formSubmissionSchema,
  idSchema,
  invoiceSchema,
  notificationSchema,
  packageSchema,
  petSchema,
  petFileSchema,
  quoteSchema,
  scheduledTaskSchema,
  settingSchema,
  sitePageSchema,
  workflowAutoEnrollmentTriggerTypeSchema,
  workflowEnrollmentSchema,
  workflowStepSchema,
  workflowSchema,
  workflowTriggerSchema,
  timestampSchema
} from "@bdta/domain";
import { jobKindSchema } from "./jobs.js";

export const authSessionSchema = z.object({
  actorId: idSchema,
  actorType: z.enum(["admin_user", "portal_user"]),
  issuedAt: timestampSchema,
  expiresAt: timestampSchema
});

export const portalActorProfileSchema = z.object({
  clientId: idSchema,
  email: emailSchema,
  displayName: z.string().min(1),
  archived: z.boolean()
});

export const portalProfileSchema = clientProfileSchema.pick({
  id: true,
  name: true,
  email: true,
  phone: true,
  address: true,
  archived: true
});

export const portalProfileDetailSchema = z.object({
  item: portalProfileSchema
});

export const portalProfileUpdateRequestSchema = z.object({
  name: z.string().trim().min(1),
  email: emailSchema,
  phone: z.string().trim(),
  address: z.string().trim(),
  currentPassword: z.string(),
  newPassword: z.string(),
  confirmPassword: z.string()
});

export const adminActorProfileSchema = z.object({
  actorId: idSchema,
  source: z.enum(["admin_user", "client_admin"]),
  username: z.string().min(1).optional(),
  email: emailSchema.optional(),
  displayName: z.string().min(1),
  role: z.enum(["owner", "admin", "accountant", "staff"]),
  active: z.boolean()
});

export const adminRouteAccessSchema = z.object({
  allowed: z.boolean(),
  reason: z.enum(["allowed", "unauthenticated", "accountant_restricted", "invalid_path"])
});

export const portalSummarySchema = z.object({
  upcomingBookings: z.array(bookingSchema),
  openInvoices: z.array(invoiceSchema),
  activeQuotes: z.array(quoteSchema)
});

export const adminDashboardSchema = z.object({
  metrics: z.object({
    pendingBookings: z.number().int().nonnegative(),
    todaysBookings: z.number().int().nonnegative(),
    overdueInvoices: z.number().int().nonnegative(),
    activeClients: z.number().int().nonnegative()
  }),
  recentBookings: z.array(bookingSchema)
});

export const adminJobLogSchema = z.object({
  jobId: idSchema,
  kind: jobKindSchema,
  scheduledFor: timestampSchema,
  status: z.enum(["queued", "processing", "processed", "failed"]),
  processedAt: timestampSchema.nullable(),
  summary: z.string().min(1).nullable(),
  payload: z.record(z.unknown())
});

export const adminJobLogCollectionSchema = z.object({
  items: z.array(adminJobLogSchema)
});

export const adminJobLogDetailSchema = z.object({
  item: adminJobLogSchema
});

export const adminIntegrationCallbackLogSchema = z.object({
  callbackId: idSchema,
  provider: z.enum(["stripe", "google_calendar", "mail_provider", "imap"]),
  receivedAt: timestampSchema,
  queuedJobId: idSchema.nullable(),
  payload: z.record(z.unknown())
});

export const adminIntegrationCallbackLogCollectionSchema = z.object({
  items: z.array(adminIntegrationCallbackLogSchema)
});

export const adminIntegrationCallbackLogDetailSchema = z.object({
  item: adminIntegrationCallbackLogSchema
});

export const bookingCollectionSchema = z.object({
  items: z.array(bookingSchema)
});

export const expenseCollectionSchema = z.object({
  items: z.array(expenseSchema)
});

export const invoiceCollectionSchema = z.object({
  items: z.array(invoiceSchema)
});

export const quoteCollectionSchema = z.object({
  items: z.array(quoteSchema)
});

export const contractCollectionSchema = z.object({
  items: z.array(contractSchema)
});

export const formSubmissionCollectionSchema = z.object({
  items: z.array(formSubmissionSchema)
});

export const portalNotificationCollectionSchema = z.object({
  items: z.array(notificationSchema)
});

export const clientCollectionSchema = z.object({
  items: z.array(clientSchema)
});

export const achievementTypeCollectionSchema = z.object({
  items: z.array(achievementTypeSchema)
});

export const clientAchievementCollectionSchema = z.object({
  items: z.array(clientAchievementSchema)
});

export const clientContactCollectionSchema = z.object({
  items: z.array(clientContactSchema)
});

export const petCollectionSchema = z.object({
  items: z.array(petSchema)
});

export const petFileCollectionSchema = z.object({
  items: z.array(petFileSchema)
});

export const packageCollectionSchema = z.object({
  items: z.array(packageSchema)
});

export const creditCollectionSchema = z.object({
  items: z.array(creditSchema)
});

export const adminWorkflowSummarySchema = workflowSchema.extend({
  description: z.string().nullable().optional(),
  enrollmentCount: z.number().int().nonnegative(),
  activeEnrollmentCount: z.number().int().nonnegative(),
  triggerCount: z.number().int().nonnegative()
});

export const adminWorkflowCollectionSchema = z.object({
  items: z.array(adminWorkflowSummarySchema)
});

export const adminWorkflowDetailSchema = z.object({
  item: workflowSchema.extend({
    description: z.string().nullable().optional()
  })
});

export const adminWorkflowEnrollmentSchema = workflowEnrollmentSchema.extend({
  status: z.enum(["active", "completed", "cancelled"]),
  clientName: z.string().min(1),
  clientEmail: emailSchema,
  enrolledByName: z.string().nullable().optional()
});

export const adminWorkflowEnrollmentCollectionSchema = z.object({
  workflow: adminWorkflowDetailSchema.shape.item,
  items: z.array(adminWorkflowEnrollmentSchema)
});

export const workflowEnrollableClientSchema = z.object({
  clientId: idSchema,
  name: z.string().min(1),
  email: emailSchema,
  alreadyEnrolled: z.boolean()
});

export const workflowEnrollableClientCollectionSchema = z.object({
  workflow: adminWorkflowDetailSchema.shape.item,
  items: z.array(workflowEnrollableClientSchema)
});

export const workflowStepEditorOptionSchema = z.object({
  id: idSchema,
  label: z.string().min(1)
});

export const adminWorkflowTriggerSchema = z.object({
  id: idSchema,
  workflowId: idSchema,
  triggerType: workflowAutoEnrollmentTriggerTypeSchema,
  appointmentTypeId: idSchema.nullable().optional(),
  formTemplateId: idSchema.nullable().optional(),
  active: z.boolean(),
  createdAt: timestampSchema.optional(),
  appointmentTypeName: z.string().min(1).nullable().optional(),
  formTemplateName: z.string().min(1).nullable().optional()
});

export const workflowEmailTemplateOptionSchema = workflowStepEditorOptionSchema.extend({
  subject: z.string().min(1),
  bodyHtml: z.string(),
  bodyText: z.string()
});

export const workflowTriggerEditorOptionsSchema = z.object({
  appointmentTypes: z.array(workflowStepEditorOptionSchema),
  formTemplates: z.array(workflowStepEditorOptionSchema)
});

export const adminWorkflowTriggerCollectionSchema = z.object({
  workflow: adminWorkflowDetailSchema.shape.item,
  items: z.array(adminWorkflowTriggerSchema),
  options: workflowTriggerEditorOptionsSchema
});

export const workflowStepEditorOptionsSchema = z.object({
  contractTemplates: z.array(workflowStepEditorOptionSchema),
  formTemplates: z.array(workflowStepEditorOptionSchema),
  appointmentTypes: z.array(workflowStepEditorOptionSchema),
  quotes: z.array(workflowStepEditorOptionSchema),
  invoices: z.array(workflowStepEditorOptionSchema),
  emailTemplates: z.array(workflowEmailTemplateOptionSchema),
  processorIntervalMinutes: z.number().int().positive()
});

export const adminWorkflowStepCollectionSchema = z.object({
  workflow: adminWorkflowDetailSchema.shape.item,
  items: z.array(workflowStepSchema)
});

export const adminWorkflowStepEditorSchema = z.object({
  workflow: adminWorkflowDetailSchema.shape.item,
  item: workflowStepSchema.nullable(),
  options: workflowStepEditorOptionsSchema
});

export const blogPostCollectionSchema = z.object({
  items: z.array(blogPostSchema)
});

export const sitePageCollectionSchema = z.object({
  items: z.array(sitePageSchema)
});

export const settingCollectionSchema = z.object({
  items: z.array(settingSchema)
});

export const adminSettingsAccountTypeSchema = z.enum(["main", "standard", "accountant"]);

export const adminSettingsUserSchema = z.object({
  actorId: idSchema,
  username: z.string().min(1),
  email: emailSchema,
  accountType: adminSettingsAccountTypeSchema,
  role: z.enum(["owner", "admin", "accountant", "staff"]),
  isMainAccount: z.boolean(),
  canManageAdminUsers: z.boolean(),
  canManageApiKeys: z.boolean(),
  active: z.boolean()
});

export const adminSettingsOverviewSchema = z.object({
  currentAdmin: adminSettingsUserSchema,
  items: z.array(settingSchema),
  adminUsers: z.array(adminSettingsUserSchema),
  categories: z.array(z.string().min(1))
});

export const appointmentTypeCollectionSchema = z.object({
  items: z.array(appointmentTypeSchema)
});

export const formTemplateCollectionSchema = z.object({
  items: z.array(formTemplateSchema)
});

export const emailTemplateCollectionSchema = z.object({
  items: z.array(emailTemplateSchema)
});

export const scheduledTaskCollectionSchema = z.object({
  items: z.array(scheduledTaskSchema)
});

export const bookingDetailSchema = z.object({
  item: bookingSchema
});

export const expenseDetailSchema = z.object({
  item: expenseSchema
});

export const blogPostDetailSchema = z.object({
  item: blogPostSchema
});

export const sitePageDetailSchema = z.object({
  item: sitePageSchema
});

export const settingDetailSchema = z.object({
  item: settingSchema
});

export const appointmentTypeDetailSchema = z.object({
  item: appointmentTypeSchema
});

export const formTemplateDetailSchema = z.object({
  item: formTemplateSchema
});

export const emailTemplateDetailSchema = z.object({
  item: emailTemplateSchema
});

export const scheduledTaskDetailSchema = z.object({
  item: scheduledTaskSchema
});

export const bookingIcalFeedSchema = z.string().min(1);

export const bookingCalendarSyncRequestSchema = z.object({
  provider: z.literal("google_calendar")
});

export const bookingCalendarSyncResponseSchema = z.object({
  booking: bookingSchema,
  provider: z.literal("google_calendar"),
  externalEventId: z.string().min(1),
  externalEventUrl: z.string().url().nullable(),
  syncedAt: timestampSchema
});

export const invoiceDetailSchema = z.object({
  item: invoiceSchema
});

export const quoteDetailSchema = z.object({
  item: quoteSchema
});

export const clientDetailSchema = z.object({
  item: clientSchema
});

export const achievementTypeDetailSchema = z.object({
  item: achievementTypeSchema
});

export const clientAchievementDetailSchema = z.object({
  item: clientAchievementSchema
});

export const achievementCertificateHtmlSchema = z.string().min(1);

export const adminClientProfileDetailSchema = z.object({
  item: clientProfileSchema
});

export const clientContactDetailSchema = z.object({
  item: clientContactSchema
});

export const petDetailSchema = z.object({
  item: petSchema
});

export const petFileDetailSchema = z.object({
  item: petFileSchema
});

export const petFileContentSchema = z.object({
  item: petFileSchema,
  fileName: z.string().min(1),
  disposition: z.enum(["inline", "attachment"]),
  contentBase64: z.string().min(1)
});

export const contractDetailSchema = z.object({
  item: contractSchema
});

export const formSubmissionDetailSchema = z.object({
  item: formSubmissionSchema
});

export const portalNotificationDetailSchema = z.object({
  item: notificationSchema
});

export const packageDetailSchema = z.object({
  item: packageSchema
});

export const creditDetailSchema = z.object({
  item: creditSchema
});

export const clientContactUpsertRequestSchema = z.object({
  name: z.string().trim().min(1),
  email: emailSchema,
  phone: z.string().trim().min(1),
  isPrimary: z.boolean().default(false)
});

export const adminClientUpsertRequestSchema = z.object({
  name: z.string().trim().min(1),
  email: emailSchema,
  phone: z.string().trim(),
  address: z.string().trim(),
  notes: z.string().trim(),
  isAdmin: z.boolean().default(false)
});

export const adminBlogPostUpsertRequestSchema = z.object({
  title: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  content: z.string(),
  excerpt: z.string(),
  coverPhoto: z.string().trim().min(1).nullable(),
  author: z.string().trim().min(1),
  published: z.boolean(),
  publishDate: timestampSchema.nullable()
});

export const adminSitePageUpsertRequestSchema = z.object({
  slug: z.string().trim().min(1),
  title: z.string().trim().min(1),
  htmlContent: z.string(),
  cssContent: z.string(),
  metaDescription: z.string(),
  metaKeywords: z.string(),
  ogTitle: z.string().trim().min(1).nullable(),
  ogDescription: z.string().trim().min(1).nullable(),
  ogImage: z.string().trim().min(1).nullable(),
  isHomepage: z.boolean(),
  published: z.boolean(),
  sortOrder: z.number().int()
});

export const adminWorkflowUpsertRequestSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim(),
  trigger: workflowTriggerSchema,
  active: z.boolean()
});

export const adminWorkflowTriggerCreateRequestSchema = z.object({
  triggerType: workflowAutoEnrollmentTriggerTypeSchema,
  appointmentTypeId: idSchema.nullable(),
  formTemplateId: idSchema.nullable(),
  active: z.boolean().default(true)
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

export const adminWorkflowStepUpsertRequestSchema = z.object({
  stepName: z.string().trim().min(1),
  emailSubject: z.string().trim().min(1),
  emailBodyHtml: z.string(),
  emailBodyText: z.string().nullable(),
  delayType: z.enum(["immediate", "after_enrollment", "after_previous", "specific_date"]),
  delayValue: z.string().trim().nullable(),
  scheduledDate: timestampSchema.nullable(),
  attachContractId: idSchema.nullable(),
  attachFormId: idSchema.nullable(),
  attachQuoteId: idSchema.nullable(),
  attachInvoiceId: idSchema.nullable(),
  includeAppointmentLink: z.boolean(),
  appointmentTypeId: idSchema.nullable()
});

export const workflowClientEnrollmentRequestSchema = z.object({
  clientIds: z.array(idSchema).min(1)
});

export const adminSettingUpdateRequestSchema = z.object({
  value: z.string()
});

export const adminSettingsUserCreateRequestSchema = z.object({
  username: z.string().trim().regex(/^(?=.{3,64}$)[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/),
  email: emailSchema,
  password: z.string().min(8),
  accountType: z.enum(["standard", "accountant"])
});

export const adminSettingsUserPermissionUpdateRequestSchema = z.object({
  canManageAdminUsers: z.boolean().default(false),
  canManageApiKeys: z.boolean().default(false)
});

export const adminAppointmentTypeUpsertRequestSchema = appointmentTypeSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const adminFormTemplateUpsertRequestSchema = z.object({
  name: z.string().trim().min(1),
  active: z.boolean(),
  description: z.string(),
  fields: z.array(z.record(z.string(), z.unknown())),
  formType: z.string().trim().min(1),
  requiredFrequency: z.string().trim().min(1).nullable(),
  appointmentTypeId: idSchema.nullable(),
  templateIsInternal: z.boolean().nullable(),
  templateShowInClientPortal: z.boolean().nullable()
});

export const adminEmailTemplateUpsertRequestSchema = z.object({
  name: z.string().trim().min(1),
  templateType: z.string().trim().min(1),
  subject: z.string().trim().min(1),
  bodyHtml: z.string(),
  bodyText: z.string(),
  active: z.boolean()
});

export const adminScheduledTaskUpsertRequestSchema = z.object({
  name: z.string().trim().min(1),
  taskType: z.string().trim().min(1),
  scheduleType: z.string().trim().min(1),
  scheduleValue: z.string(),
  active: z.boolean()
});

export const deleteResponseSchema = z.object({
  deleted: z.literal(true)
});

export const successResponseSchema = z.object({
  success: z.literal(true)
});

function normalizePublicContactInput(input: unknown): unknown {
  if (typeof input !== "object" || input == null || Array.isArray(input)) {
    return input;
  }

  const record = input as Record<string, unknown>;
  const readString = (value: unknown): string => typeof value === "string" ? value : "";

  return {
    name: readString(record.name),
    email: readString(record.email),
    phone: readString(record.phone),
    service: readString(record.service),
    message: readString(record.message),
    turnstileToken: readString(record.turnstileToken ?? record.turnstile_token ?? record["cf-turnstile-response"])
  };
}

export const publicContactRequestSchema = z.preprocess(normalizePublicContactInput, z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  service: z.string(),
  message: z.string(),
  turnstileToken: z.string()
}));

export const publicContactResponseSchema = successResponseSchema;

export const invoicePaymentSessionRequestSchema = z.object({
  returnUrl: z.string().url(),
  cancelUrl: z.string().url()
});

export const paymentSessionSchema = z.object({
  provider: z.enum(["stripe"]),
  checkoutUrl: z.string().url(),
  expiresAt: timestampSchema.nullable()
});

export const invoicePaymentSessionResponseSchema = z.object({
  invoice: invoiceSchema,
  paymentSession: paymentSessionSchema
});

export const publicBookingRequestSchema = z.object({
  serviceId: idSchema,
  clientEmail: emailSchema,
  petIds: z.array(idSchema),
  requestedStart: timestampSchema,
  requestedEnd: timestampSchema,
  turnstileToken: z.string().min(1)
});

export const publicBookingResponseSchema = z.object({
  bookingId: idSchema,
  status: z.enum(["pending", "confirmed"]),
  confirmationEmailQueued: z.boolean(),
  portalReturnUrl: z.string().url().nullable()
});

export const portalActionSchema = z.object({
  portalUserId: idSchema,
  action: z.enum(["book_credit", "pay_invoice", "sign_contract", "submit_form", "download_file"]),
  resourceId: idSchema
});

export const adminCrudActionSchema = z.object({
  adminUserId: idSchema,
  resource: z.enum([
    "client",
    "pet",
    "booking",
    "invoice",
    "quote",
    "contract",
    "form_template",
    "package",
    "workflow",
    "scheduled_task"
  ]),
  operation: z.enum(["create", "read", "update", "delete"])
});

export const integrationCallbackSchema = z.object({
  provider: z.enum(["stripe", "google_calendar", "mail_provider", "imap"]),
  receivedAt: timestampSchema,
  payload: z.record(z.unknown())
});

export const integrationCallbackReceiptSchema = z.object({
  accepted: z.literal(true),
  provider: integrationCallbackSchema.shape.provider,
  callbackId: idSchema,
  queuedJobId: idSchema.nullable()
});

export type AuthSession = z.infer<typeof authSessionSchema>;
export type PortalActorProfile = z.infer<typeof portalActorProfileSchema>;
export type PortalProfile = z.infer<typeof portalProfileSchema>;
export type PortalProfileDetail = z.infer<typeof portalProfileDetailSchema>;
export type PortalProfileUpdateRequest = z.infer<typeof portalProfileUpdateRequestSchema>;
export type AdminActorProfile = z.infer<typeof adminActorProfileSchema>;
export type AdminRouteAccess = z.infer<typeof adminRouteAccessSchema>;
export type PortalSummary = z.infer<typeof portalSummarySchema>;
export type AdminDashboard = z.infer<typeof adminDashboardSchema>;
export type AdminJobLog = z.infer<typeof adminJobLogSchema>;
export type AdminJobLogCollection = z.infer<typeof adminJobLogCollectionSchema>;
export type AdminJobLogDetail = z.infer<typeof adminJobLogDetailSchema>;
export type AdminIntegrationCallbackLog = z.infer<typeof adminIntegrationCallbackLogSchema>;
export type AdminIntegrationCallbackLogCollection = z.infer<typeof adminIntegrationCallbackLogCollectionSchema>;
export type AdminIntegrationCallbackLogDetail = z.infer<typeof adminIntegrationCallbackLogDetailSchema>;
export type BookingCollection = z.infer<typeof bookingCollectionSchema>;
export type ExpenseCollection = z.infer<typeof expenseCollectionSchema>;
export type InvoiceCollection = z.infer<typeof invoiceCollectionSchema>;
export type QuoteCollection = z.infer<typeof quoteCollectionSchema>;
export type ContractCollection = z.infer<typeof contractCollectionSchema>;
export type FormSubmissionCollection = z.infer<typeof formSubmissionCollectionSchema>;
export type PortalNotificationCollection = z.infer<typeof portalNotificationCollectionSchema>;
export type ClientCollection = z.infer<typeof clientCollectionSchema>;
export type AchievementTypeCollection = z.infer<typeof achievementTypeCollectionSchema>;
export type ClientAchievementCollection = z.infer<typeof clientAchievementCollectionSchema>;
export type ClientContactCollection = z.infer<typeof clientContactCollectionSchema>;
export type PetCollection = z.infer<typeof petCollectionSchema>;
export type PetFileCollection = z.infer<typeof petFileCollectionSchema>;
export type PackageCollection = z.infer<typeof packageCollectionSchema>;
export type CreditCollection = z.infer<typeof creditCollectionSchema>;
export type AdminWorkflowCollection = z.infer<typeof adminWorkflowCollectionSchema>;
export type AdminWorkflowDetail = z.infer<typeof adminWorkflowDetailSchema>;
export type AdminWorkflowEnrollmentCollection = z.infer<typeof adminWorkflowEnrollmentCollectionSchema>;
export type WorkflowEnrollableClientCollection = z.infer<typeof workflowEnrollableClientCollectionSchema>;
export type WorkflowStepEditorOption = z.infer<typeof workflowStepEditorOptionSchema>;
export type AdminWorkflowTrigger = z.infer<typeof adminWorkflowTriggerSchema>;
export type WorkflowEmailTemplateOption = z.infer<typeof workflowEmailTemplateOptionSchema>;
export type WorkflowTriggerEditorOptions = z.infer<typeof workflowTriggerEditorOptionsSchema>;
export type AdminWorkflowTriggerCollection = z.infer<typeof adminWorkflowTriggerCollectionSchema>;
export type WorkflowStepEditorOptions = z.infer<typeof workflowStepEditorOptionsSchema>;
export type AdminWorkflowStepCollection = z.infer<typeof adminWorkflowStepCollectionSchema>;
export type AdminWorkflowStepEditor = z.infer<typeof adminWorkflowStepEditorSchema>;
export type BlogPostCollection = z.infer<typeof blogPostCollectionSchema>;
export type SitePageCollection = z.infer<typeof sitePageCollectionSchema>;
export type SettingCollection = z.infer<typeof settingCollectionSchema>;
export type AdminSettingsAccountType = z.infer<typeof adminSettingsAccountTypeSchema>;
export type AdminSettingsUser = z.infer<typeof adminSettingsUserSchema>;
export type AdminSettingsOverview = z.infer<typeof adminSettingsOverviewSchema>;
export type BookingDetail = z.infer<typeof bookingDetailSchema>;
export type ExpenseDetail = z.infer<typeof expenseDetailSchema>;
export type BlogPostDetail = z.infer<typeof blogPostDetailSchema>;
export type SitePageDetail = z.infer<typeof sitePageDetailSchema>;
export type SettingDetail = z.infer<typeof settingDetailSchema>;
export type BookingIcalFeed = z.infer<typeof bookingIcalFeedSchema>;
export type BookingCalendarSyncRequest = z.infer<typeof bookingCalendarSyncRequestSchema>;
export type BookingCalendarSyncResponse = z.infer<typeof bookingCalendarSyncResponseSchema>;
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;
export type QuoteDetail = z.infer<typeof quoteDetailSchema>;
export type ClientDetail = z.infer<typeof clientDetailSchema>;
export type AchievementTypeDetail = z.infer<typeof achievementTypeDetailSchema>;
export type ClientAchievementDetail = z.infer<typeof clientAchievementDetailSchema>;
export type AchievementCertificateHtml = z.infer<typeof achievementCertificateHtmlSchema>;
export type AdminClientProfileDetail = z.infer<typeof adminClientProfileDetailSchema>;
export type ClientContactDetail = z.infer<typeof clientContactDetailSchema>;
export type PetDetail = z.infer<typeof petDetailSchema>;
export type PetFileDetail = z.infer<typeof petFileDetailSchema>;
export type PetFileContent = z.infer<typeof petFileContentSchema>;
export type ContractDetail = z.infer<typeof contractDetailSchema>;
export type FormSubmissionDetail = z.infer<typeof formSubmissionDetailSchema>;
export type PortalNotificationDetail = z.infer<typeof portalNotificationDetailSchema>;
export type PackageDetail = z.infer<typeof packageDetailSchema>;
export type CreditDetail = z.infer<typeof creditDetailSchema>;
export type ClientContactUpsertRequest = z.infer<typeof clientContactUpsertRequestSchema>;
export type AdminClientUpsertRequest = z.infer<typeof adminClientUpsertRequestSchema>;
export type AdminBlogPostUpsertRequest = z.infer<typeof adminBlogPostUpsertRequestSchema>;
export type AdminSitePageUpsertRequest = z.infer<typeof adminSitePageUpsertRequestSchema>;
export type AdminWorkflowUpsertRequest = z.infer<typeof adminWorkflowUpsertRequestSchema>;
export type AdminWorkflowTriggerCreateRequest = z.infer<typeof adminWorkflowTriggerCreateRequestSchema>;
export type AdminWorkflowStepUpsertRequest = z.infer<typeof adminWorkflowStepUpsertRequestSchema>;
export type WorkflowClientEnrollmentRequest = z.infer<typeof workflowClientEnrollmentRequestSchema>;
export type AdminSettingUpdateRequest = z.infer<typeof adminSettingUpdateRequestSchema>;
export type AdminSettingsUserCreateRequest = z.infer<typeof adminSettingsUserCreateRequestSchema>;
export type AdminSettingsUserPermissionUpdateRequest = z.infer<typeof adminSettingsUserPermissionUpdateRequestSchema>;
export type AdminFormTemplateUpsertRequest = z.infer<typeof adminFormTemplateUpsertRequestSchema>;
export type DeleteResponse = z.infer<typeof deleteResponseSchema>;
export type SuccessResponse = z.infer<typeof successResponseSchema>;
export type PublicContactRequest = z.infer<typeof publicContactRequestSchema>;
export type PublicContactResponse = z.infer<typeof publicContactResponseSchema>;
export type InvoicePaymentSessionRequest = z.infer<typeof invoicePaymentSessionRequestSchema>;
export type PaymentSession = z.infer<typeof paymentSessionSchema>;
export type InvoicePaymentSessionResponse = z.infer<typeof invoicePaymentSessionResponseSchema>;
export type PublicBookingRequest = z.infer<typeof publicBookingRequestSchema>;
export type PublicBookingResponse = z.infer<typeof publicBookingResponseSchema>;
export type PortalAction = z.infer<typeof portalActionSchema>;
export type AdminCrudAction = z.infer<typeof adminCrudActionSchema>;
export type IntegrationCallback = z.infer<typeof integrationCallbackSchema>;
export type IntegrationCallbackReceipt = z.infer<typeof integrationCallbackReceiptSchema>;
