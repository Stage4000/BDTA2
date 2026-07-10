import { z } from "zod";

import {
  achievementCertificateHtmlSchema,
  achievementTypeCollectionSchema,
  achievementTypeDetailSchema,
  adminIntegrationCallbackLogCollectionSchema,
  adminIntegrationCallbackLogDetailSchema,
  adminBlogPostUpsertRequestSchema,
  adminJobLogCollectionSchema,
  adminJobLogDetailSchema,
  appointmentTypeCollectionSchema,
  appointmentTypeDetailSchema,
  adminRouteAccessSchema,
  adminActorProfileSchema,
  adminClientProfileDetailSchema,
  adminDashboardSchema,
  formTemplateCollectionSchema,
  formTemplateDetailSchema,
  adminSettingUpdateRequestSchema,
  adminSitePageUpsertRequestSchema,
  authSessionSchema,
  blogPostCollectionSchema,
  blogPostDetailSchema,
  bookingCalendarSyncResponseSchema,
  bookingIcalFeedSchema,
  bookingCollectionSchema,
  bookingDetailSchema,
  clientAchievementCollectionSchema,
  clientAchievementDetailSchema,
  clientCollectionSchema,
  clientContactCollectionSchema,
  clientContactDetailSchema,
  clientDetailSchema,
  contractCollectionSchema,
  contractDetailSchema,
  creditCollectionSchema,
  creditDetailSchema,
  deleteResponseSchema,
  emailTemplateCollectionSchema,
  emailTemplateDetailSchema,
  formSubmissionCollectionSchema,
  formSubmissionDetailSchema,
  integrationCallbackReceiptSchema,
  invoiceCollectionSchema,
  invoiceDetailSchema,
  invoicePaymentSessionResponseSchema,
  packageCollectionSchema,
  packageDetailSchema,
  petCollectionSchema,
  petDetailSchema,
  petFileContentSchema,
  petFileCollectionSchema,
  petFileDetailSchema,
  portalActorProfileSchema,
  portalNotificationCollectionSchema,
  portalProfileDetailSchema,
  portalSummarySchema,
  publicContactResponseSchema,
  publicBookingRequestSchema,
  publicBookingResponseSchema,
  quoteCollectionSchema,
  quoteDetailSchema,
  scheduledTaskCollectionSchema,
  scheduledTaskDetailSchema,
  settingCollectionSchema,
  settingDetailSchema,
  sitePageCollectionSchema,
  sitePageDetailSchema,
  successResponseSchema,
  adminWorkflowTriggerCollectionSchema,
  adminWorkflowCollectionSchema,
  adminWorkflowDetailSchema,
  adminWorkflowEnrollmentCollectionSchema,
  adminWorkflowStepCollectionSchema,
  adminWorkflowStepEditorSchema,
  workflowEnrollableClientCollectionSchema
} from "@bdta/contracts";
import {
  AdminConfigurationError,
  createAdminAppointmentType,
  deleteAdminAppointmentType,
  createAdminEmailTemplate,
  createAdminFormTemplate,
  createAdminScheduledTask,
  getAdminAppointmentTypeDetail,
  getAdminEmailTemplateDetail,
  getAdminFormTemplateDetail,
  getAdminScheduledTaskDetail,
  listAdminAppointmentTypes,
  listAdminEmailTemplates,
  listAdminFormTemplates,
  listAdminScheduledTasks,
  type AdminConfigurationDependencies,
  updateAdminAppointmentType,
  updateAdminEmailTemplate,
  updateAdminFormTemplate,
  deleteAdminFormTemplate,
  updateAdminScheduledTask
} from "./admin-configuration.js";
import {
  AchievementError,
  getAdminAchievementTypeDetail,
  getAdminClientAchievementCertificate,
  getAdminClientAchievementDetail,
  getPortalAchievementCertificate,
  getPortalAchievementDetail,
  listAdminAchievementTypes,
  listAdminClientAchievements,
  listPortalAchievements,
  type AchievementDependencies
} from "./achievements.js";
import {
  acceptIntegrationCallback,
  type IntegrationCallbackDependencies
} from "./callbacks.js";
import {
  CalendarSyncError,
  getAdminBookingCalendarSync,
  syncAdminBookingCalendar,
  type AdminCalendarSyncDependencies
} from "./calendar-sync.js";
import {
  ClientProfileError,
  createAdminClientProfile,
  getAdminClientProfile,
  getPortalProfile,
  type ClientProfileDependencies,
  updateAdminClientProfile,
  updatePortalProfile
} from "./client-profiles.js";
import {
  authenticateAdminLogin,
  type AdminLoginDependencies,
  type AdminLoginInput,
  authenticatePortalLogin,
  type PortalLoginDependencies,
  type PortalLoginInput
} from "./auth.js";
import {
  ContentError,
  createAdminBlogPost,
  deleteAdminBlogPost,
  createAdminSitePage,
  deleteAdminSitePage,
  getAdminBlogPostDetail,
  getAdminSettingDetail,
  getAdminSitePageDetail,
  getPublicBlogPostDetail,
  getPublicSitePage,
  listAdminBlogPosts,
  listAdminSettings,
  listAdminSitePages,
  listPublicBlogPosts,
  type ContentManagementDependencies,
  updateAdminBlogPost,
  updateAdminSetting,
  updateAdminSitePage
} from "./content.js";
import {
  WorkflowActionError,
  createAdminWorkflow,
  createAdminWorkflowTrigger,
  updateAdminWorkflow,
  deleteAdminWorkflow as deleteWorkflow,
  getAdminWorkflowDetail,
  listAdminWorkflowEnrollments,
  listAdminWorkflowEnrollableClients,
  listAdminWorkflowTriggers,
  listAdminWorkflows,
  listAdminWorkflowSteps,
  getAdminWorkflowStepEditor,
  enrollAdminWorkflowClients,
  cancelAdminWorkflowEnrollment,
  createAdminWorkflowStep,
  deleteAdminWorkflowTrigger,
  updateAdminWorkflowStep,
  deleteAdminWorkflowStep,
  type WorkflowManagementDependencies
} from "./workflows.js";
import {
  acceptPortalQuote,
  CommerceActionError,
  createPortalInvoicePaymentSession,
  signPortalContract,
  submitPortalForm,
  type PortalCommerceDependencies
} from "./commerce.js";
import {
  ContactActionError,
  createAdminClientContact,
  createPortalContact,
  deleteAdminClientContact,
  deletePortalContact,
  getAdminClientContactDetail,
  getPortalContactDetail,
  listAdminClientContacts,
  listPortalContacts,
  type ContactManagementDependencies,
  updateAdminClientContact,
  updatePortalContact
} from "./contacts.js";
import {
  buildAdminDashboard,
  buildPortalSummary,
  type AdminDashboardDependencies,
  type PortalSummaryDependencies
} from "./dashboards.js";
import { PublicBookingError, PublicContactError } from "./errors.js";
import {
  AdminOperationsError,
  getAdminIntegrationCallbackLogDetail,
  getAdminJobLogDetail,
  listAdminIntegrationCallbackLogs,
  listAdminJobLogs,
  type AdminOperationsDependencies
} from "./operations.js";
import {
  PetFileUploadError,
  type PetFileManagementDependencies,
  uploadAdminPetFile,
  uploadPortalPetFile
} from "./pet-files.js";
import {
  getPublicBookingIcalDetail,
  getPublicContractDetail,
  getPublicFormSubmissionDetail,
  getPublicQuoteDetail,
  PublicDocumentAccessError,
  type PublicDocumentAccessDependencies
} from "./public-documents.js";
import {
  createPublicBooking,
  type PublicBookingDependencies
} from "./public-booking.js";
import {
  createPublicContact,
  type PublicContactDependencies
} from "./public-contact.js";
import { type PublicPackagePurchaseDependencies } from "./public-packages.js";
import {
  getAdminBookingDetail,
  getAdminClientDetail,
  getAdminContractDetail,
  getAdminCreditDetail,
  getAdminFormDetail,
  getAdminInvoiceDetail,
  getAdminPackageDetail,
  getAdminPetDetail,
  getAdminPetFileContent,
  getAdminPetFileDetail,
  getAdminQuoteDetail,
  getPortalBookingDetail,
  getPortalContractDetail,
  getPortalCreditDetail,
  getPortalFormDetail,
  getPortalInvoiceDetail,
  getPortalPackageDetail,
  getPortalPetDetail,
  getPortalPetFileContent,
  getPortalPetFileDetail,
  getPortalQuoteDetail,
  listAdminBookings,
  listAdminClients,
  listAdminContracts,
  listAdminCredits,
  listAdminForms,
  listAdminInvoices,
  listAdminPackages,
  listAdminPets,
  listAdminPetFiles,
  listAdminQuotes,
  listPortalBookings,
  listPortalContracts,
  listPortalCredits,
  listPortalForms,
  listPortalInvoices,
  listPortalNotifications,
  listPortalPackages,
  listPortalPets,
  listPortalPetFiles,
  listPortalQuotes,
  deleteAdminPetFile,
  deletePortalPetFile,
  type AdminResourceReadDependencies,
  type PortalResourceReadDependencies
} from "./resources.js";
import {
  type AdminActorProfileDependencies,
  type PortalActorProfileDependencies,
  resolveAdminActorProfile,
  resolveAdminRouteAccess,
  resolvePortalActorProfile,
  SessionActorError
} from "./session-actors.js";

const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional()
  })
});

export type ApiDependencies = {
  publicBooking: PublicBookingDependencies;
  publicContact: PublicContactDependencies;
  publicPackages: PublicPackagePurchaseDependencies;
  integrationCallbacks: IntegrationCallbackDependencies;
  portalLogin: PortalLoginDependencies;
  adminLogin: AdminLoginDependencies;
  portalActorProfile: PortalActorProfileDependencies;
  adminActorProfile: AdminActorProfileDependencies;
  clientProfiles: ClientProfileDependencies;
  portalSummary: PortalSummaryDependencies;
  adminDashboard: AdminDashboardDependencies;
  adminOperations: AdminOperationsDependencies;
  adminConfiguration: AdminConfigurationDependencies;
  content: ContentManagementDependencies;
  achievements: AchievementDependencies;
  portalResources: PortalResourceReadDependencies;
  adminResources: AdminResourceReadDependencies;
  petFiles: PetFileManagementDependencies;
  contacts: ContactManagementDependencies;
  adminCalendarSync: AdminCalendarSyncDependencies;
  portalCommerce: PortalCommerceDependencies;
  publicDocuments: PublicDocumentAccessDependencies;
  workflows: WorkflowManagementDependencies;
};

export type ApiSuccess<T> = {
  status: number;
  body: T;
};

export type ApiFailure = {
  status: number;
  body: z.infer<typeof apiErrorSchema>;
};

export type PublicBookingHandlerResult = ApiSuccess<z.infer<typeof publicBookingResponseSchema>> | ApiFailure;
export type PublicContactHandlerResult = ApiSuccess<z.infer<typeof publicContactResponseSchema>> | ApiFailure;
export type AdminLoginHandlerResult = ApiSuccess<Awaited<ReturnType<typeof authenticateAdminLogin>>> | ApiFailure;
export type PortalLoginHandlerResult = ApiSuccess<Awaited<ReturnType<typeof authenticatePortalLogin>>> | ApiFailure;
export type PortalActorProfileHandlerResult = ApiSuccess<{ actor: z.infer<typeof portalActorProfileSchema> }> | ApiFailure;
export type PortalProfileHandlerResult = ApiSuccess<z.infer<typeof portalProfileDetailSchema>> | ApiFailure;
export type AdminActorProfileHandlerResult = ApiSuccess<{ actor: z.infer<typeof adminActorProfileSchema> }> | ApiFailure;
export type AdminRouteAccessHandlerResult = ApiSuccess<z.infer<typeof adminRouteAccessSchema>> | ApiFailure;
export type PortalSummaryHandlerResult = ApiSuccess<z.infer<typeof portalSummarySchema>> | ApiFailure;
export type AdminDashboardHandlerResult = ApiSuccess<z.infer<typeof adminDashboardSchema>> | ApiFailure;
export type AdminJobLogListHandlerResult = ApiSuccess<z.infer<typeof adminJobLogCollectionSchema>> | ApiFailure;
export type AdminJobLogDetailHandlerResult = ApiSuccess<z.infer<typeof adminJobLogDetailSchema>> | ApiFailure;
export type AdminIntegrationCallbackLogListHandlerResult = ApiSuccess<z.infer<typeof adminIntegrationCallbackLogCollectionSchema>> | ApiFailure;
export type AdminIntegrationCallbackLogDetailHandlerResult = ApiSuccess<z.infer<typeof adminIntegrationCallbackLogDetailSchema>> | ApiFailure;
export type PortalAchievementListHandlerResult = ApiSuccess<z.infer<typeof clientAchievementCollectionSchema>> | ApiFailure;
export type PortalAchievementDetailHandlerResult = ApiSuccess<z.infer<typeof clientAchievementDetailSchema>> | ApiFailure;
export type PortalAchievementCertificateHandlerResult = ApiSuccess<z.infer<typeof achievementCertificateHtmlSchema>> | ApiFailure;
export type AdminAchievementTypeListHandlerResult = ApiSuccess<z.infer<typeof achievementTypeCollectionSchema>> | ApiFailure;
export type AdminAchievementTypeDetailHandlerResult = ApiSuccess<z.infer<typeof achievementTypeDetailSchema>> | ApiFailure;
export type AdminClientAchievementListHandlerResult = ApiSuccess<z.infer<typeof clientAchievementCollectionSchema>> | ApiFailure;
export type AdminClientAchievementDetailHandlerResult = ApiSuccess<z.infer<typeof clientAchievementDetailSchema>> | ApiFailure;
export type AdminClientAchievementCertificateHandlerResult = ApiSuccess<z.infer<typeof achievementCertificateHtmlSchema>> | ApiFailure;
export type PortalBookingListHandlerResult = ApiSuccess<z.infer<typeof bookingCollectionSchema>> | ApiFailure;
export type PortalBookingDetailHandlerResult = ApiSuccess<z.infer<typeof bookingDetailSchema>> | ApiFailure;
export type PortalContactListHandlerResult = ApiSuccess<z.infer<typeof clientContactCollectionSchema>> | ApiFailure;
export type PortalContactDetailHandlerResult = ApiSuccess<z.infer<typeof clientContactDetailSchema>> | ApiFailure;
export type PortalContactDeleteHandlerResult = ApiSuccess<z.infer<typeof deleteResponseSchema>> | ApiFailure;
export type PortalPetListHandlerResult = ApiSuccess<z.infer<typeof petCollectionSchema>> | ApiFailure;
export type PortalPetDetailHandlerResult = ApiSuccess<z.infer<typeof petDetailSchema>> | ApiFailure;
export type PortalPetFileListHandlerResult = ApiSuccess<z.infer<typeof petFileCollectionSchema>> | ApiFailure;
export type PortalPetFileDetailHandlerResult = ApiSuccess<z.infer<typeof petFileDetailSchema>> | ApiFailure;
export type PortalPetFileUploadHandlerResult = ApiSuccess<z.infer<typeof petFileDetailSchema>> | ApiFailure;
export type PortalPetFileContentHandlerResult = ApiSuccess<z.infer<typeof petFileContentSchema>> | ApiFailure;
export type PortalPetFileDeleteHandlerResult = ApiSuccess<z.infer<typeof deleteResponseSchema>> | ApiFailure;
export type PortalInvoiceListHandlerResult = ApiSuccess<z.infer<typeof invoiceCollectionSchema>> | ApiFailure;
export type PortalInvoiceDetailHandlerResult = ApiSuccess<z.infer<typeof invoiceDetailSchema>> | ApiFailure;
export type PortalQuoteListHandlerResult = ApiSuccess<z.infer<typeof quoteCollectionSchema>> | ApiFailure;
export type PortalQuoteDetailHandlerResult = ApiSuccess<z.infer<typeof quoteDetailSchema>> | ApiFailure;
export type PortalContractListHandlerResult = ApiSuccess<z.infer<typeof contractCollectionSchema>> | ApiFailure;
export type PortalContractDetailHandlerResult = ApiSuccess<z.infer<typeof contractDetailSchema>> | ApiFailure;
export type PortalFormListHandlerResult = ApiSuccess<z.infer<typeof formSubmissionCollectionSchema>> | ApiFailure;
export type PortalFormDetailHandlerResult = ApiSuccess<z.infer<typeof formSubmissionDetailSchema>> | ApiFailure;
export type PortalNotificationListHandlerResult = ApiSuccess<z.infer<typeof portalNotificationCollectionSchema>> | ApiFailure;
export type PortalPackageListHandlerResult = ApiSuccess<z.infer<typeof packageCollectionSchema>> | ApiFailure;
export type PortalPackageDetailHandlerResult = ApiSuccess<z.infer<typeof packageDetailSchema>> | ApiFailure;
export type PortalCreditListHandlerResult = ApiSuccess<z.infer<typeof creditCollectionSchema>> | ApiFailure;
export type PortalCreditDetailHandlerResult = ApiSuccess<z.infer<typeof creditDetailSchema>> | ApiFailure;
export type AdminClientListHandlerResult = ApiSuccess<z.infer<typeof clientCollectionSchema>> | ApiFailure;
export type AdminClientDetailHandlerResult = ApiSuccess<z.infer<typeof clientDetailSchema>> | ApiFailure;
export type AdminClientProfileHandlerResult = ApiSuccess<z.infer<typeof adminClientProfileDetailSchema>> | ApiFailure;
export type AdminClientContactListHandlerResult = ApiSuccess<z.infer<typeof clientContactCollectionSchema>> | ApiFailure;
export type AdminClientContactDetailHandlerResult = ApiSuccess<z.infer<typeof clientContactDetailSchema>> | ApiFailure;
export type AdminClientContactDeleteHandlerResult = ApiSuccess<z.infer<typeof deleteResponseSchema>> | ApiFailure;
export type AdminPetListHandlerResult = ApiSuccess<z.infer<typeof petCollectionSchema>> | ApiFailure;
export type AdminPetDetailHandlerResult = ApiSuccess<z.infer<typeof petDetailSchema>> | ApiFailure;
export type AdminPetFileListHandlerResult = ApiSuccess<z.infer<typeof petFileCollectionSchema>> | ApiFailure;
export type AdminPetFileDetailHandlerResult = ApiSuccess<z.infer<typeof petFileDetailSchema>> | ApiFailure;
export type AdminPetFileUploadHandlerResult = ApiSuccess<z.infer<typeof petFileDetailSchema>> | ApiFailure;
export type AdminPetFileContentHandlerResult = ApiSuccess<z.infer<typeof petFileContentSchema>> | ApiFailure;
export type AdminPetFileDeleteHandlerResult = ApiSuccess<z.infer<typeof deleteResponseSchema>> | ApiFailure;
export type AdminBookingListHandlerResult = ApiSuccess<z.infer<typeof bookingCollectionSchema>> | ApiFailure;
export type AdminBookingDetailHandlerResult = ApiSuccess<z.infer<typeof bookingDetailSchema>> | ApiFailure;
export type AdminBookingCalendarSyncHandlerResult = ApiSuccess<z.infer<typeof bookingCalendarSyncResponseSchema>> | ApiFailure;
export type AdminBookingCalendarSyncDetailHandlerResult = ApiSuccess<z.infer<typeof bookingCalendarSyncResponseSchema>> | ApiFailure;
export type AdminInvoiceListHandlerResult = ApiSuccess<z.infer<typeof invoiceCollectionSchema>> | ApiFailure;
export type AdminInvoiceDetailHandlerResult = ApiSuccess<z.infer<typeof invoiceDetailSchema>> | ApiFailure;
export type AdminQuoteListHandlerResult = ApiSuccess<z.infer<typeof quoteCollectionSchema>> | ApiFailure;
export type AdminQuoteDetailHandlerResult = ApiSuccess<z.infer<typeof quoteDetailSchema>> | ApiFailure;
export type AdminContractListHandlerResult = ApiSuccess<z.infer<typeof contractCollectionSchema>> | ApiFailure;
export type AdminContractDetailHandlerResult = ApiSuccess<z.infer<typeof contractDetailSchema>> | ApiFailure;
export type AdminFormListHandlerResult = ApiSuccess<z.infer<typeof formSubmissionCollectionSchema>> | ApiFailure;
export type AdminFormDetailHandlerResult = ApiSuccess<z.infer<typeof formSubmissionDetailSchema>> | ApiFailure;
export type AdminPackageListHandlerResult = ApiSuccess<z.infer<typeof packageCollectionSchema>> | ApiFailure;
export type AdminPackageDetailHandlerResult = ApiSuccess<z.infer<typeof packageDetailSchema>> | ApiFailure;
export type AdminCreditListHandlerResult = ApiSuccess<z.infer<typeof creditCollectionSchema>> | ApiFailure;
export type AdminCreditDetailHandlerResult = ApiSuccess<z.infer<typeof creditDetailSchema>> | ApiFailure;
export type PortalQuoteAcceptHandlerResult = ApiSuccess<z.infer<typeof quoteDetailSchema>> | ApiFailure;
export type PortalContractSignHandlerResult = ApiSuccess<z.infer<typeof contractDetailSchema>> | ApiFailure;
export type PortalFormSubmitHandlerResult = ApiSuccess<z.infer<typeof formSubmissionDetailSchema>> | ApiFailure;
export type PortalInvoicePaymentSessionHandlerResult = ApiSuccess<z.infer<typeof invoicePaymentSessionResponseSchema>> | ApiFailure;
export type IntegrationCallbackHandlerResult = ApiSuccess<z.infer<typeof integrationCallbackReceiptSchema>> | ApiFailure;
export type PublicBlogPostListHandlerResult = ApiSuccess<z.infer<typeof blogPostCollectionSchema>> | ApiFailure;
export type PublicBlogPostDetailHandlerResult = ApiSuccess<z.infer<typeof blogPostDetailSchema>> | ApiFailure;
export type PublicSitePageHandlerResult = ApiSuccess<z.infer<typeof sitePageDetailSchema>> | ApiFailure;
export type AdminBlogPostListHandlerResult = ApiSuccess<z.infer<typeof blogPostCollectionSchema>> | ApiFailure;
export type AdminBlogPostDetailHandlerResult = ApiSuccess<z.infer<typeof blogPostDetailSchema>> | ApiFailure;
export type AdminBlogPostDeleteHandlerResult = ApiSuccess<z.infer<typeof deleteResponseSchema>> | ApiFailure;
export type AdminSitePageListHandlerResult = ApiSuccess<z.infer<typeof sitePageCollectionSchema>> | ApiFailure;
export type AdminSitePageDetailHandlerResult = ApiSuccess<z.infer<typeof sitePageDetailSchema>> | ApiFailure;
export type AdminSitePageDeleteHandlerResult = ApiSuccess<z.infer<typeof deleteResponseSchema>> | ApiFailure;
export type AdminWorkflowListHandlerResult = ApiSuccess<z.infer<typeof adminWorkflowCollectionSchema>> | ApiFailure;
export type AdminWorkflowDetailHandlerResult = ApiSuccess<z.infer<typeof adminWorkflowDetailSchema>> | ApiFailure;
export type AdminWorkflowTriggerListHandlerResult = ApiSuccess<z.infer<typeof adminWorkflowTriggerCollectionSchema>> | ApiFailure;
export type AdminWorkflowEnrollmentListHandlerResult = ApiSuccess<z.infer<typeof adminWorkflowEnrollmentCollectionSchema>> | ApiFailure;
export type AdminWorkflowEnrollableClientListHandlerResult = ApiSuccess<z.infer<typeof workflowEnrollableClientCollectionSchema>> | ApiFailure;
export type AdminWorkflowStepListHandlerResult = ApiSuccess<z.infer<typeof adminWorkflowStepCollectionSchema>> | ApiFailure;
export type AdminWorkflowStepEditorHandlerResult = ApiSuccess<z.infer<typeof adminWorkflowStepEditorSchema>> | ApiFailure;
export type AdminWorkflowMutationHandlerResult = ApiSuccess<z.infer<typeof successResponseSchema>> | ApiFailure;
export type AdminSettingListHandlerResult = ApiSuccess<z.infer<typeof settingCollectionSchema>> | ApiFailure;
export type AdminSettingDetailHandlerResult = ApiSuccess<z.infer<typeof settingDetailSchema>> | ApiFailure;
export type AdminAppointmentTypeListHandlerResult = ApiSuccess<z.infer<typeof appointmentTypeCollectionSchema>> | ApiFailure;
export type AdminAppointmentTypeDetailHandlerResult = ApiSuccess<z.infer<typeof appointmentTypeDetailSchema>> | ApiFailure;
export type AdminAppointmentTypeDeleteHandlerResult = ApiSuccess<z.infer<typeof deleteResponseSchema>> | ApiFailure;
export type AdminFormTemplateListHandlerResult = ApiSuccess<z.infer<typeof formTemplateCollectionSchema>> | ApiFailure;
export type AdminFormTemplateDetailHandlerResult = ApiSuccess<z.infer<typeof formTemplateDetailSchema>> | ApiFailure;
export type AdminFormTemplateDeleteHandlerResult = ApiSuccess<z.infer<typeof deleteResponseSchema>> | ApiFailure;
export type AdminEmailTemplateListHandlerResult = ApiSuccess<z.infer<typeof emailTemplateCollectionSchema>> | ApiFailure;
export type AdminEmailTemplateDetailHandlerResult = ApiSuccess<z.infer<typeof emailTemplateDetailSchema>> | ApiFailure;
export type AdminScheduledTaskListHandlerResult = ApiSuccess<z.infer<typeof scheduledTaskCollectionSchema>> | ApiFailure;
export type AdminScheduledTaskDetailHandlerResult = ApiSuccess<z.infer<typeof scheduledTaskDetailSchema>> | ApiFailure;
export type PublicQuoteDetailHandlerResult = ApiSuccess<z.infer<typeof quoteDetailSchema>> | ApiFailure;
export type PublicContractDetailHandlerResult = ApiSuccess<z.infer<typeof contractDetailSchema>> | ApiFailure;
export type PublicFormSubmissionDetailHandlerResult = ApiSuccess<z.infer<typeof formSubmissionDetailSchema>> | ApiFailure;
export type PublicBookingIcalDetailHandlerResult = ApiSuccess<z.infer<typeof bookingIcalFeedSchema>> | ApiFailure;

function createError(status: number, code: string, message: string, details?: unknown): ApiFailure {
  return {
    status,
    body: apiErrorSchema.parse({
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details })
      }
    })
  };
}

function createValidationError(error: z.ZodError): ApiFailure {
  const issues = error.issues.map((issue) => ({
    path: issue.path.length === 0 ? "(root)" : issue.path.map(String).join("."),
    message: issue.message,
    code: issue.code
  }));

  const summary = issues
    .slice(0, 4)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join("; ");

  return createError(
    400,
    "invalid_request",
    summary === "" ? "Request validation failed." : `Request validation failed: ${summary}`,
    { issues }
  );
}

export function createApiHandlers(dependencies: ApiDependencies) {
  return {
    async handlePublicBooking(input: unknown): Promise<PublicBookingHandlerResult> {
      try {
        const { response } = await createPublicBooking(
          publicBookingRequestSchema.parse(input),
          dependencies.publicBooking
        );

        return {
          status: 201,
          body: response
        };
      } catch (error) {
        if (error instanceof PublicBookingError) {
          const status = error.code === "captcha_failed" ? 400 : 409;
          return createError(status, error.code, error.message);
        }

        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while creating public booking.");
      }
    },

    async handlePublicContact(input: unknown): Promise<PublicContactHandlerResult> {
      try {
        return {
          status: 200,
          body: await createPublicContact(input, dependencies.publicContact)
        };
      } catch (error) {
        if (error instanceof PublicContactError) {
          return createError(400, error.code, error.message);
        }

        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while creating public contact.");
      }
    },

    async handleIntegrationCallback(input: unknown): Promise<IntegrationCallbackHandlerResult> {
      try {
        return {
          status: 202,
          body: await acceptIntegrationCallback(input, dependencies.integrationCallbacks)
        };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while processing integration callback.");
      }
    },

    async handlePublicBlogPosts(): Promise<PublicBlogPostListHandlerResult> {
      try {
        return {
          status: 200,
          body: await listPublicBlogPosts(dependencies.content)
        };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading public blog posts.");
      }
    },

    async handlePublicBlogPostDetail(slug: string): Promise<PublicBlogPostDetailHandlerResult> {
      try {
        return {
          status: 200,
          body: await getPublicBlogPostDetail(slug, dependencies.content)
        };
      } catch (error) {
        if (error instanceof ContentError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading public blog post.");
      }
    },

    async handlePublicSitePage(slug: string | null): Promise<PublicSitePageHandlerResult> {
      try {
        return {
          status: 200,
          body: await getPublicSitePage(slug, dependencies.content)
        };
      } catch (error) {
        if (error instanceof ContentError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading public site page.");
      }
    },

    async handlePortalLogin(input: unknown): Promise<PortalLoginHandlerResult> {
      try {
        const result = await authenticatePortalLogin(input as PortalLoginInput, dependencies.portalLogin);
        return {
          status: 200,
          body: result
        };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        if (error instanceof Error && error.message === "Invalid email address or password.") {
          return createError(401, "invalid_credentials", error.message);
        }

        return createError(500, "internal_error", "Unexpected error during portal login.");
      }
    },

    async handleAdminLogin(input: unknown): Promise<AdminLoginHandlerResult> {
      try {
        const result = await authenticateAdminLogin(input as AdminLoginInput, dependencies.adminLogin);
        return {
          status: 200,
          body: result
        };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        if (error instanceof Error && error.message === "Invalid username or password.") {
          return createError(401, "invalid_credentials", error.message);
        }

        return createError(500, "internal_error", "Unexpected error during admin login.");
      }
    },

    async handlePortalActorProfile(session: unknown): Promise<PortalActorProfileHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        const actor = await resolvePortalActorProfile(session as z.infer<typeof authSessionSchema>, dependencies.portalActorProfile);
        return {
          status: 200,
          body: { actor }
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }

        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading portal actor profile.");
      }
    },

    async handlePortalProfile(session: unknown): Promise<PortalProfileHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return {
          status: 200,
          body: await getPortalProfile(session as z.infer<typeof authSessionSchema>, dependencies.clientProfiles)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ClientProfileError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading portal profile.");
      }
    },

    async handlePortalProfileUpdate(session: unknown, input: unknown): Promise<PortalProfileHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return {
          status: 200,
          body: await updatePortalProfile(session as z.infer<typeof authSessionSchema>, input, dependencies.clientProfiles)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ClientProfileError) {
          return createError(error.code === "not_found" ? 404 : 409, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while updating portal profile.");
      }
    },

    async handleAdminActorProfile(session: unknown): Promise<AdminActorProfileHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        const actor = await resolveAdminActorProfile(session as z.infer<typeof authSessionSchema>, dependencies.adminActorProfile);
        return {
          status: 200,
          body: { actor }
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }

        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin actor profile.");
      }
    },

    async handleAdminRouteAccess(input: unknown): Promise<AdminRouteAccessHandlerResult> {
      try {
        if (
          typeof input === "object"
          && input != null
          && "session" in input
          && (input as { session: unknown }).session == null
        ) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: resolveAdminRouteAccess(input as { session: z.infer<typeof authSessionSchema>; path: string })
        };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while authorizing admin route.");
      }
    },

    async handlePortalSummary(session: unknown): Promise<PortalSummaryHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return {
          status: 200,
          body: await buildPortalSummary(session as z.infer<typeof authSessionSchema>, dependencies.portalSummary)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }

        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading portal summary.");
      }
    },

    async handleAdminDashboard(session: unknown): Promise<AdminDashboardHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await buildAdminDashboard(session as z.infer<typeof authSessionSchema>, dependencies.adminDashboard)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }

        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin dashboard.");
      }
    },

    async handleAdminBlogPosts(session: unknown): Promise<AdminBlogPostListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await listAdminBlogPosts(session as z.infer<typeof authSessionSchema>, dependencies.content)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin blog posts.");
      }
    },

    async handleAdminBlogPostDetail(session: unknown, postId: string): Promise<AdminBlogPostDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminBlogPostDetail(session as z.infer<typeof authSessionSchema>, postId, dependencies.content)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ContentError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin blog post.");
      }
    },

    async handleAdminBlogPostCreate(session: unknown, input: unknown): Promise<AdminBlogPostDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 201,
          body: await createAdminBlogPost(session as z.infer<typeof authSessionSchema>, input, dependencies.content)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while creating admin blog post.");
      }
    },

    async handleAdminBlogPostUpdate(
      session: unknown,
      postId: string,
      input: unknown
    ): Promise<AdminBlogPostDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await updateAdminBlogPost(session as z.infer<typeof authSessionSchema>, postId, input, dependencies.content)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ContentError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while updating admin blog post.");
      }
    },

    async handleAdminBlogPostDelete(
      session: unknown,
      postId: string
    ): Promise<AdminBlogPostDeleteHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await deleteAdminBlogPost(session as z.infer<typeof authSessionSchema>, postId, dependencies.content)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ContentError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while deleting admin blog post.");
      }
    },

    async handleAdminSitePages(session: unknown): Promise<AdminSitePageListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await listAdminSitePages(session as z.infer<typeof authSessionSchema>, dependencies.content)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin site pages.");
      }
    },

    async handleAdminSitePageDetail(session: unknown, pageId: string): Promise<AdminSitePageDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminSitePageDetail(session as z.infer<typeof authSessionSchema>, pageId, dependencies.content)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ContentError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin site page.");
      }
    },

    async handleAdminSitePageCreate(session: unknown, input: unknown): Promise<AdminSitePageDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 201,
          body: await createAdminSitePage(session as z.infer<typeof authSessionSchema>, input, dependencies.content)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while creating admin site page.");
      }
    },

    async handleAdminSitePageUpdate(
      session: unknown,
      pageId: string,
      input: unknown
    ): Promise<AdminSitePageDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await updateAdminSitePage(session as z.infer<typeof authSessionSchema>, pageId, input, dependencies.content)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ContentError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while updating admin site page.");
      }
    },

    async handleAdminSitePageDelete(
      session: unknown,
      pageId: string
    ): Promise<AdminSitePageDeleteHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await deleteAdminSitePage(session as z.infer<typeof authSessionSchema>, pageId, dependencies.content)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ContentError) {
          return createError(error.code === "invalid_operation" ? 409 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while deleting admin site page.");
      }
    },

    async handleAdminWorkflows(session: unknown): Promise<AdminWorkflowListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await listAdminWorkflows(session as z.infer<typeof authSessionSchema>, dependencies.workflows)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin workflows.");
      }
    },

    async handleAdminWorkflowDetail(
      session: unknown,
      workflowId: string
    ): Promise<AdminWorkflowDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminWorkflowDetail(session as z.infer<typeof authSessionSchema>, workflowId, dependencies.workflows)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof WorkflowActionError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin workflow.");
      }
    },

    async handleAdminWorkflowTriggers(
      session: unknown,
      workflowId: string
    ): Promise<AdminWorkflowTriggerListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await listAdminWorkflowTriggers(
            session as z.infer<typeof authSessionSchema>,
            workflowId,
            dependencies.workflows
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof WorkflowActionError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading workflow triggers.");
      }
    },

    async handleAdminWorkflowCreate(
      session: unknown,
      input: unknown
    ): Promise<AdminWorkflowDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 201,
          body: await createAdminWorkflow(session as z.infer<typeof authSessionSchema>, input, dependencies.workflows)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while creating admin workflow.");
      }
    },

    async handleAdminWorkflowUpdate(
      session: unknown,
      workflowId: string,
      input: unknown
    ): Promise<AdminWorkflowDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await updateAdminWorkflow(session as z.infer<typeof authSessionSchema>, workflowId, input, dependencies.workflows)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof WorkflowActionError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while updating admin workflow.");
      }
    },

    async handleAdminWorkflowDelete(
      session: unknown,
      workflowId: string
    ): Promise<AdminWorkflowMutationHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await deleteWorkflow(session as z.infer<typeof authSessionSchema>, workflowId, dependencies.workflows)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof WorkflowActionError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while deleting admin workflow.");
      }
    },

    async handleAdminWorkflowTriggerCreate(
      session: unknown,
      workflowId: string,
      input: unknown
    ): Promise<AdminWorkflowTriggerListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 201,
          body: await createAdminWorkflowTrigger(
            session as z.infer<typeof authSessionSchema>,
            workflowId,
            input,
            dependencies.workflows
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof WorkflowActionError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while creating workflow trigger.");
      }
    },

    async handleAdminWorkflowTriggerDelete(
      session: unknown,
      workflowId: string,
      triggerId: string
    ): Promise<AdminWorkflowMutationHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await deleteAdminWorkflowTrigger(
            session as z.infer<typeof authSessionSchema>,
            workflowId,
            triggerId,
            dependencies.workflows
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof WorkflowActionError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while deleting workflow trigger.");
      }
    },

    async handleAdminWorkflowEnrollments(
      session: unknown,
      workflowId: string
    ): Promise<AdminWorkflowEnrollmentListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await listAdminWorkflowEnrollments(session as z.infer<typeof authSessionSchema>, workflowId, dependencies.workflows)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof WorkflowActionError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading workflow enrollments.");
      }
    },

    async handleAdminWorkflowEnrollableClients(
      session: unknown,
      workflowId: string
    ): Promise<AdminWorkflowEnrollableClientListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await listAdminWorkflowEnrollableClients(session as z.infer<typeof authSessionSchema>, workflowId, dependencies.workflows)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof WorkflowActionError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading enrollable workflow clients.");
      }
    },

    async handleAdminWorkflowEnroll(
      session: unknown,
      workflowId: string,
      input: unknown
    ): Promise<AdminWorkflowMutationHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await enrollAdminWorkflowClients(session as z.infer<typeof authSessionSchema>, workflowId, input, dependencies.workflows)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof WorkflowActionError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while enrolling workflow clients.");
      }
    },

    async handleAdminWorkflowEnrollmentCancel(
      session: unknown,
      workflowId: string,
      enrollmentId: string
    ): Promise<AdminWorkflowMutationHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await cancelAdminWorkflowEnrollment(
            session as z.infer<typeof authSessionSchema>,
            workflowId,
            enrollmentId,
            dependencies.workflows
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof WorkflowActionError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while cancelling workflow enrollment.");
      }
    },

    async handleAdminWorkflowSteps(
      session: unknown,
      workflowId: string
    ): Promise<AdminWorkflowStepListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await listAdminWorkflowSteps(session as z.infer<typeof authSessionSchema>, workflowId, dependencies.workflows)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof WorkflowActionError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading workflow steps.");
      }
    },

    async handleAdminWorkflowStepEditor(
      session: unknown,
      workflowId: string,
      stepId: string | null
    ): Promise<AdminWorkflowStepEditorHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminWorkflowStepEditor(
            session as z.infer<typeof authSessionSchema>,
            workflowId,
            stepId,
            dependencies.workflows
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof WorkflowActionError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading workflow step editor.");
      }
    },

    async handleAdminWorkflowStepCreate(
      session: unknown,
      workflowId: string,
      input: unknown
    ): Promise<AdminWorkflowStepEditorHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 201,
          body: await createAdminWorkflowStep(
            session as z.infer<typeof authSessionSchema>,
            workflowId,
            input,
            dependencies.workflows
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof WorkflowActionError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while creating workflow step.");
      }
    },

    async handleAdminWorkflowStepUpdate(
      session: unknown,
      workflowId: string,
      stepId: string,
      input: unknown
    ): Promise<AdminWorkflowStepEditorHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await updateAdminWorkflowStep(
            session as z.infer<typeof authSessionSchema>,
            workflowId,
            stepId,
            input,
            dependencies.workflows
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof WorkflowActionError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while updating workflow step.");
      }
    },

    async handleAdminWorkflowStepDelete(
      session: unknown,
      workflowId: string,
      stepId: string
    ): Promise<AdminWorkflowMutationHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await deleteAdminWorkflowStep(
            session as z.infer<typeof authSessionSchema>,
            workflowId,
            stepId,
            dependencies.workflows
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof WorkflowActionError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while deleting workflow step.");
      }
    },

    async handleAdminSettings(session: unknown): Promise<AdminSettingListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await listAdminSettings(session as z.infer<typeof authSessionSchema>, dependencies.content)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin settings.");
      }
    },

    async handleAdminSettingDetail(session: unknown, key: string): Promise<AdminSettingDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminSettingDetail(session as z.infer<typeof authSessionSchema>, key, dependencies.content)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ContentError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin setting.");
      }
    },

    async handleAdminSettingUpdate(
      session: unknown,
      key: string,
      input: unknown
    ): Promise<AdminSettingDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await updateAdminSetting(session as z.infer<typeof authSessionSchema>, key, input, dependencies.content)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ContentError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while updating admin setting.");
      }
    },

    async handleAdminAppointmentTypes(session: unknown): Promise<AdminAppointmentTypeListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await listAdminAppointmentTypes(session as z.infer<typeof authSessionSchema>, dependencies.adminConfiguration)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin appointment types.");
      }
    },

    async handleAdminAppointmentTypeDetail(
      session: unknown,
      appointmentTypeId: string
    ): Promise<AdminAppointmentTypeDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminAppointmentTypeDetail(
            session as z.infer<typeof authSessionSchema>,
            appointmentTypeId,
            dependencies.adminConfiguration
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof AdminConfigurationError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin appointment type.");
      }
    },

    async handleAdminAppointmentTypeCreate(
      session: unknown,
      input: unknown
    ): Promise<AdminAppointmentTypeDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 201,
          body: await createAdminAppointmentType(
            session as z.infer<typeof authSessionSchema>,
            input,
            dependencies.adminConfiguration
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while creating admin appointment type.");
      }
    },

    async handleAdminAppointmentTypeUpdate(
      session: unknown,
      appointmentTypeId: string,
      input: unknown
    ): Promise<AdminAppointmentTypeDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await updateAdminAppointmentType(
            session as z.infer<typeof authSessionSchema>,
            appointmentTypeId,
            input,
            dependencies.adminConfiguration
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof AdminConfigurationError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while updating admin appointment type.");
      }
    },

    async handleAdminAppointmentTypeDelete(
      session: unknown,
      appointmentTypeId: string
    ): Promise<AdminAppointmentTypeDeleteHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await deleteAdminAppointmentType(
            session as z.infer<typeof authSessionSchema>,
            appointmentTypeId,
            dependencies.adminConfiguration
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof AdminConfigurationError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while deleting admin appointment type.");
      }
    },

    async handleAdminFormTemplates(session: unknown): Promise<AdminFormTemplateListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await listAdminFormTemplates(session as z.infer<typeof authSessionSchema>, dependencies.adminConfiguration)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin form templates.");
      }
    },

    async handleAdminFormTemplateDetail(
      session: unknown,
      templateId: string
    ): Promise<AdminFormTemplateDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminFormTemplateDetail(
            session as z.infer<typeof authSessionSchema>,
            templateId,
            dependencies.adminConfiguration
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof AdminConfigurationError) {
          return createError(error.code === "in_use" ? 409 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin form template.");
      }
    },

    async handleAdminFormTemplateCreate(
      session: unknown,
      input: unknown
    ): Promise<AdminFormTemplateDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 201,
          body: await createAdminFormTemplate(
            session as z.infer<typeof authSessionSchema>,
            input,
            dependencies.adminConfiguration
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while creating admin form template.");
      }
    },

    async handleAdminFormTemplateUpdate(
      session: unknown,
      templateId: string,
      input: unknown
    ): Promise<AdminFormTemplateDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await updateAdminFormTemplate(
            session as z.infer<typeof authSessionSchema>,
            templateId,
            input,
            dependencies.adminConfiguration
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof AdminConfigurationError) {
          return createError(error.code === "in_use" ? 409 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while updating admin form template.");
      }
    },

    async handleAdminFormTemplateDelete(
      session: unknown,
      templateId: string
    ): Promise<AdminFormTemplateDeleteHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await deleteAdminFormTemplate(
            session as z.infer<typeof authSessionSchema>,
            templateId,
            dependencies.adminConfiguration
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof AdminConfigurationError) {
          return createError(error.code === "in_use" ? 409 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while deleting admin form template.");
      }
    },

    async handleAdminEmailTemplates(session: unknown): Promise<AdminEmailTemplateListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await listAdminEmailTemplates(session as z.infer<typeof authSessionSchema>, dependencies.adminConfiguration)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin email templates.");
      }
    },

    async handleAdminEmailTemplateDetail(
      session: unknown,
      templateId: string
    ): Promise<AdminEmailTemplateDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminEmailTemplateDetail(
            session as z.infer<typeof authSessionSchema>,
            templateId,
            dependencies.adminConfiguration
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof AdminConfigurationError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin email template.");
      }
    },

    async handleAdminEmailTemplateCreate(
      session: unknown,
      input: unknown
    ): Promise<AdminEmailTemplateDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 201,
          body: await createAdminEmailTemplate(
            session as z.infer<typeof authSessionSchema>,
            input,
            dependencies.adminConfiguration
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while creating admin email template.");
      }
    },

    async handleAdminEmailTemplateUpdate(
      session: unknown,
      templateId: string,
      input: unknown
    ): Promise<AdminEmailTemplateDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await updateAdminEmailTemplate(
            session as z.infer<typeof authSessionSchema>,
            templateId,
            input,
            dependencies.adminConfiguration
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof AdminConfigurationError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while updating admin email template.");
      }
    },

    async handleAdminScheduledTasks(session: unknown): Promise<AdminScheduledTaskListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await listAdminScheduledTasks(session as z.infer<typeof authSessionSchema>, dependencies.adminConfiguration)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin scheduled tasks.");
      }
    },

    async handleAdminScheduledTaskDetail(
      session: unknown,
      taskId: string
    ): Promise<AdminScheduledTaskDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminScheduledTaskDetail(
            session as z.infer<typeof authSessionSchema>,
            taskId,
            dependencies.adminConfiguration
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof AdminConfigurationError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while loading admin scheduled task.");
      }
    },

    async handleAdminScheduledTaskCreate(
      session: unknown,
      input: unknown
    ): Promise<AdminScheduledTaskDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 201,
          body: await createAdminScheduledTask(
            session as z.infer<typeof authSessionSchema>,
            input,
            dependencies.adminConfiguration
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while creating admin scheduled task.");
      }
    },

    async handleAdminScheduledTaskUpdate(
      session: unknown,
      taskId: string,
      input: unknown
    ): Promise<AdminScheduledTaskDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await updateAdminScheduledTask(
            session as z.infer<typeof authSessionSchema>,
            taskId,
            input,
            dependencies.adminConfiguration
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof AdminConfigurationError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }

        return createError(500, "internal_error", "Unexpected error while updating admin scheduled task.");
      }
    },

    async handleAdminJobLogs(session: unknown): Promise<AdminJobLogListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await listAdminJobLogs(session as z.infer<typeof authSessionSchema>, dependencies.adminOperations)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin job logs.");
      }
    },

    async handleAdminJobLogDetail(session: unknown, jobId: string): Promise<AdminJobLogDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminJobLogDetail(session as z.infer<typeof authSessionSchema>, jobId, dependencies.adminOperations)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof AdminOperationsError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin job log.");
      }
    },

    async handleAdminIntegrationCallbackLogs(session: unknown): Promise<AdminIntegrationCallbackLogListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await listAdminIntegrationCallbackLogs(session as z.infer<typeof authSessionSchema>, dependencies.adminOperations)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin integration callback logs.");
      }
    },

    async handleAdminIntegrationCallbackLogDetail(
      session: unknown,
      callbackId: string
    ): Promise<AdminIntegrationCallbackLogDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminIntegrationCallbackLogDetail(
            session as z.infer<typeof authSessionSchema>,
            callbackId,
            dependencies.adminOperations
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof AdminOperationsError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin integration callback log.");
      }
    },

    async handlePortalAchievements(session: unknown): Promise<PortalAchievementListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return {
          status: 200,
          body: await listPortalAchievements(session as z.infer<typeof authSessionSchema>, dependencies.achievements)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(401, error.code, error.message);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal achievements.");
      }
    },

    async handlePortalAchievementDetail(session: unknown, achievementId: string): Promise<PortalAchievementDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return {
          status: 200,
          body: await getPortalAchievementDetail(
            session as z.infer<typeof authSessionSchema>,
            achievementId,
            dependencies.achievements
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof AchievementError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal achievement.");
      }
    },

    async handlePortalAchievementCertificate(
      session: unknown,
      achievementId: string,
      download: boolean
    ): Promise<PortalAchievementCertificateHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return {
          status: 200,
          body: await getPortalAchievementCertificate(
            session as z.infer<typeof authSessionSchema>,
            achievementId,
            download,
            dependencies.achievements
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof AchievementError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while rendering portal achievement certificate.");
      }
    },

    async handlePortalBookings(session: unknown): Promise<PortalBookingListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await listPortalBookings(session as z.infer<typeof authSessionSchema>, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal bookings.");
      }
    },

    async handlePortalPets(session: unknown): Promise<PortalPetListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await listPortalPets(session as z.infer<typeof authSessionSchema>, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal pets.");
      }
    },

    async handlePortalPetDetail(session: unknown, petId: string): Promise<PortalPetDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await getPortalPetDetail(session as z.infer<typeof authSessionSchema>, petId, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal pet.");
      }
    },

    async handlePortalPetFiles(session: unknown, petId: string): Promise<PortalPetFileListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await listPortalPetFiles(session as z.infer<typeof authSessionSchema>, petId, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal pet files.");
      }
    },

    async handlePortalPetFileUpload(
      session: unknown,
      petId: string,
      input: unknown
    ): Promise<PortalPetFileUploadHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return {
          status: 201,
          body: await uploadPortalPetFile(
            session as z.infer<typeof authSessionSchema>,
            petId,
            input,
            dependencies.petFiles
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof PetFileUploadError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while uploading portal pet file.");
      }
    },

    async handlePortalPetFileDetail(
      session: unknown,
      petId: string,
      fileId: string
    ): Promise<PortalPetFileDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return {
          status: 200,
          body: await getPortalPetFileDetail(session as z.infer<typeof authSessionSchema>, petId, fileId, dependencies.portalResources)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal pet file.");
      }
    },

    async handlePortalPetFileContent(
      session: unknown,
      petId: string,
      fileId: string,
      download: boolean
    ): Promise<PortalPetFileContentHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return {
          status: 200,
          body: await getPortalPetFileContent(
            session as z.infer<typeof authSessionSchema>,
            petId,
            fileId,
            download,
            dependencies.portalResources
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal pet file content.");
      }
    },

    async handlePortalPetFileDelete(
      session: unknown,
      petId: string,
      fileId: string
    ): Promise<PortalPetFileDeleteHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return {
          status: 200,
          body: await deletePortalPetFile(session as z.infer<typeof authSessionSchema>, petId, fileId, dependencies.portalResources)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while deleting portal pet file.");
      }
    },

    async handlePortalBookingDetail(session: unknown, bookingId: string): Promise<PortalBookingDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await getPortalBookingDetail(session as z.infer<typeof authSessionSchema>, bookingId, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal booking.");
      }
    },

    async handlePortalContacts(session: unknown): Promise<PortalContactListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await listPortalContacts(session as z.infer<typeof authSessionSchema>, dependencies.contacts) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal contacts.");
      }
    },

    async handlePortalContactDetail(session: unknown, contactId: string): Promise<PortalContactDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await getPortalContactDetail(session as z.infer<typeof authSessionSchema>, contactId, dependencies.contacts) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ContactActionError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal contact.");
      }
    },

    async handlePortalContactCreate(session: unknown, input: unknown): Promise<PortalContactDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 201, body: await createPortalContact(session as z.infer<typeof authSessionSchema>, input, dependencies.contacts) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while creating portal contact.");
      }
    },

    async handlePortalContactUpdate(session: unknown, contactId: string, input: unknown): Promise<PortalContactDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await updatePortalContact(session as z.infer<typeof authSessionSchema>, contactId, input, dependencies.contacts) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ContactActionError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while updating portal contact.");
      }
    },

    async handlePortalContactDelete(session: unknown, contactId: string): Promise<PortalContactDeleteHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await deletePortalContact(session as z.infer<typeof authSessionSchema>, contactId, dependencies.contacts) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ContactActionError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while deleting portal contact.");
      }
    },

    async handlePortalInvoices(session: unknown): Promise<PortalInvoiceListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await listPortalInvoices(session as z.infer<typeof authSessionSchema>, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal invoices.");
      }
    },

    async handlePortalInvoiceDetail(session: unknown, invoiceId: string): Promise<PortalInvoiceDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await getPortalInvoiceDetail(session as z.infer<typeof authSessionSchema>, invoiceId, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal invoice.");
      }
    },

    async handlePortalQuotes(session: unknown): Promise<PortalQuoteListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await listPortalQuotes(session as z.infer<typeof authSessionSchema>, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal quotes.");
      }
    },

    async handlePortalQuoteDetail(session: unknown, quoteId: string): Promise<PortalQuoteDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await getPortalQuoteDetail(session as z.infer<typeof authSessionSchema>, quoteId, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal quote.");
      }
    },

    async handlePortalContracts(session: unknown): Promise<PortalContractListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await listPortalContracts(session as z.infer<typeof authSessionSchema>, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal contracts.");
      }
    },

    async handlePortalContractDetail(session: unknown, contractId: string): Promise<PortalContractDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await getPortalContractDetail(session as z.infer<typeof authSessionSchema>, contractId, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal contract.");
      }
    },

    async handlePortalForms(session: unknown): Promise<PortalFormListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await listPortalForms(session as z.infer<typeof authSessionSchema>, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal forms.");
      }
    },

    async handlePortalNotifications(session: unknown): Promise<PortalNotificationListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await listPortalNotifications(session as z.infer<typeof authSessionSchema>, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal notifications.");
      }
    },

    async handlePortalPackages(session: unknown): Promise<PortalPackageListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await listPortalPackages(session as z.infer<typeof authSessionSchema>, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal packages.");
      }
    },

    async handlePortalPackageDetail(session: unknown, packageId: string): Promise<PortalPackageDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await getPortalPackageDetail(session as z.infer<typeof authSessionSchema>, packageId, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal package.");
      }
    },

    async handlePortalCredits(session: unknown): Promise<PortalCreditListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await listPortalCredits(session as z.infer<typeof authSessionSchema>, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal credits.");
      }
    },

    async handlePortalCreditDetail(session: unknown, creditId: string): Promise<PortalCreditDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await getPortalCreditDetail(session as z.infer<typeof authSessionSchema>, creditId, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal credit.");
      }
    },

    async handlePortalFormDetail(session: unknown, formId: string): Promise<PortalFormDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await getPortalFormDetail(session as z.infer<typeof authSessionSchema>, formId, dependencies.portalResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading portal form.");
      }
    },

    async handleAdminClients(session: unknown): Promise<AdminClientListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await listAdminClients(session as z.infer<typeof authSessionSchema>, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin clients.");
      }
    },

    async handleAdminAchievementTypes(session: unknown): Promise<AdminAchievementTypeListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await listAdminAchievementTypes(session as z.infer<typeof authSessionSchema>, dependencies.achievements)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(401, error.code, error.message);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin achievement types.");
      }
    },

    async handleAdminAchievementTypeDetail(
      session: unknown,
      achievementTypeId: string
    ): Promise<AdminAchievementTypeDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminAchievementTypeDetail(
            session as z.infer<typeof authSessionSchema>,
            achievementTypeId,
            dependencies.achievements
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof AchievementError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin achievement type.");
      }
    },

    async handleAdminClientAchievements(
      session: unknown,
      clientId: string
    ): Promise<AdminClientAchievementListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await listAdminClientAchievements(
            session as z.infer<typeof authSessionSchema>,
            clientId,
            dependencies.achievements
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(401, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin client achievements.");
      }
    },

    async handleAdminClientAchievementDetail(
      session: unknown,
      clientId: string,
      achievementId: string
    ): Promise<AdminClientAchievementDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminClientAchievementDetail(
            session as z.infer<typeof authSessionSchema>,
            clientId,
            achievementId,
            dependencies.achievements
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof AchievementError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin client achievement.");
      }
    },

    async handleAdminClientAchievementCertificate(
      session: unknown,
      clientId: string,
      achievementId: string,
      download: boolean
    ): Promise<AdminClientAchievementCertificateHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminClientAchievementCertificate(
            session as z.infer<typeof authSessionSchema>,
            clientId,
            achievementId,
            download,
            dependencies.achievements
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof AchievementError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while rendering admin achievement certificate.");
      }
    },

    async handleAdminPets(session: unknown): Promise<AdminPetListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await listAdminPets(session as z.infer<typeof authSessionSchema>, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin pets.");
      }
    },

    async handleAdminPetDetail(session: unknown, petId: string): Promise<AdminPetDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await getAdminPetDetail(session as z.infer<typeof authSessionSchema>, petId, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin pet.");
      }
    },

    async handleAdminPetFiles(session: unknown, petId: string): Promise<AdminPetFileListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await listAdminPetFiles(session as z.infer<typeof authSessionSchema>, petId, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin pet files.");
      }
    },

    async handleAdminPetFileUpload(
      session: unknown,
      petId: string,
      input: unknown
    ): Promise<AdminPetFileUploadHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 201,
          body: await uploadAdminPetFile(
            session as z.infer<typeof authSessionSchema>,
            petId,
            input,
            dependencies.petFiles
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof PetFileUploadError) {
          return createError(error.code === "not_found" ? 404 : 400, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while uploading admin pet file.");
      }
    },

    async handleAdminPetFileDetail(
      session: unknown,
      petId: string,
      fileId: string
    ): Promise<AdminPetFileDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminPetFileDetail(session as z.infer<typeof authSessionSchema>, petId, fileId, dependencies.adminResources)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin pet file.");
      }
    },

    async handleAdminPetFileContent(
      session: unknown,
      petId: string,
      fileId: string,
      download: boolean
    ): Promise<AdminPetFileContentHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminPetFileContent(
            session as z.infer<typeof authSessionSchema>,
            petId,
            fileId,
            download,
            dependencies.adminResources
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin pet file content.");
      }
    },

    async handleAdminPetFileDelete(
      session: unknown,
      petId: string,
      fileId: string
    ): Promise<AdminPetFileDeleteHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await deleteAdminPetFile(session as z.infer<typeof authSessionSchema>, petId, fileId, dependencies.adminResources)
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while deleting admin pet file.");
      }
    },

    async handleAdminClientDetail(session: unknown, clientId: string): Promise<AdminClientDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await getAdminClientDetail(session as z.infer<typeof authSessionSchema>, clientId, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin client.");
      }
    },

    async handleAdminClientProfile(session: unknown, clientId: string): Promise<AdminClientProfileHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminClientProfile(
            session as z.infer<typeof authSessionSchema>,
            clientId,
            dependencies.clientProfiles
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ClientProfileError) {
          return createError(error.code === "not_found" ? 404 : 409, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin client profile.");
      }
    },

    async handleAdminClientCreate(session: unknown, input: unknown): Promise<AdminClientProfileHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 201,
          body: await createAdminClientProfile(
            session as z.infer<typeof authSessionSchema>,
            input,
            dependencies.clientProfiles
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ClientProfileError) {
          return createError(error.code === "not_found" ? 404 : 409, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while creating admin client.");
      }
    },

    async handleAdminClientUpdate(
      session: unknown,
      clientId: string,
      input: unknown
    ): Promise<AdminClientProfileHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await updateAdminClientProfile(
            session as z.infer<typeof authSessionSchema>,
            clientId,
            input,
            dependencies.clientProfiles
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ClientProfileError) {
          return createError(error.code === "not_found" ? 404 : 409, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while updating admin client.");
      }
    },

    async handleAdminClientContacts(session: unknown, clientId: string): Promise<AdminClientContactListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await listAdminClientContacts(session as z.infer<typeof authSessionSchema>, clientId, dependencies.contacts) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin client contacts.");
      }
    },

    async handleAdminClientContactDetail(
      session: unknown,
      clientId: string,
      contactId: string
    ): Promise<AdminClientContactDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminClientContactDetail(
            session as z.infer<typeof authSessionSchema>,
            clientId,
            contactId,
            dependencies.contacts
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ContactActionError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin client contact.");
      }
    },

    async handleAdminClientContactCreate(
      session: unknown,
      clientId: string,
      input: unknown
    ): Promise<AdminClientContactDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 201,
          body: await createAdminClientContact(
            session as z.infer<typeof authSessionSchema>,
            clientId,
            input,
            dependencies.contacts
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while creating admin client contact.");
      }
    },

    async handleAdminClientContactUpdate(
      session: unknown,
      clientId: string,
      contactId: string,
      input: unknown
    ): Promise<AdminClientContactDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await updateAdminClientContact(
            session as z.infer<typeof authSessionSchema>,
            clientId,
            contactId,
            input,
            dependencies.contacts
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ContactActionError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while updating admin client contact.");
      }
    },

    async handleAdminClientContactDelete(
      session: unknown,
      clientId: string,
      contactId: string
    ): Promise<AdminClientContactDeleteHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await deleteAdminClientContact(
            session as z.infer<typeof authSessionSchema>,
            clientId,
            contactId,
            dependencies.contacts
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof ContactActionError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while deleting admin client contact.");
      }
    },

    async handleAdminBookings(session: unknown): Promise<AdminBookingListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await listAdminBookings(session as z.infer<typeof authSessionSchema>, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin bookings.");
      }
    },

    async handleAdminBookingDetail(session: unknown, bookingId: string): Promise<AdminBookingDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await getAdminBookingDetail(session as z.infer<typeof authSessionSchema>, bookingId, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin booking.");
      }
    },

    async handleAdminBookingCalendarSync(
      session: unknown,
      bookingId: string,
      input: unknown
    ): Promise<AdminBookingCalendarSyncHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await syncAdminBookingCalendar(
            session as z.infer<typeof authSessionSchema>,
            bookingId,
            input,
            dependencies.adminCalendarSync
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof CalendarSyncError) {
          return createError(error.code === "not_found" ? 404 : 409, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while syncing admin booking calendar.");
      }
    },

    async handleAdminBookingCalendarSyncDetail(
      session: unknown,
      bookingId: string
    ): Promise<AdminBookingCalendarSyncDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return {
          status: 200,
          body: await getAdminBookingCalendarSync(
            session as z.infer<typeof authSessionSchema>,
            bookingId,
            dependencies.adminCalendarSync
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof CalendarSyncError) {
          return createError(error.code === "not_found" ? 404 : 409, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin booking calendar sync.");
      }
    },

    async handleAdminInvoices(session: unknown): Promise<AdminInvoiceListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await listAdminInvoices(session as z.infer<typeof authSessionSchema>, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin invoices.");
      }
    },

    async handleAdminInvoiceDetail(session: unknown, invoiceId: string): Promise<AdminInvoiceDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await getAdminInvoiceDetail(session as z.infer<typeof authSessionSchema>, invoiceId, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin invoice.");
      }
    },

    async handleAdminQuotes(session: unknown): Promise<AdminQuoteListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await listAdminQuotes(session as z.infer<typeof authSessionSchema>, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin quotes.");
      }
    },

    async handleAdminQuoteDetail(session: unknown, quoteId: string): Promise<AdminQuoteDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await getAdminQuoteDetail(session as z.infer<typeof authSessionSchema>, quoteId, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin quote.");
      }
    },

    async handleAdminContracts(session: unknown): Promise<AdminContractListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await listAdminContracts(session as z.infer<typeof authSessionSchema>, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin contracts.");
      }
    },

    async handleAdminContractDetail(session: unknown, contractId: string): Promise<AdminContractDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await getAdminContractDetail(session as z.infer<typeof authSessionSchema>, contractId, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin contract.");
      }
    },

    async handleAdminForms(session: unknown): Promise<AdminFormListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await listAdminForms(session as z.infer<typeof authSessionSchema>, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin forms.");
      }
    },

    async handleAdminPackages(session: unknown): Promise<AdminPackageListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await listAdminPackages(session as z.infer<typeof authSessionSchema>, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin packages.");
      }
    },

    async handleAdminPackageDetail(session: unknown, packageId: string): Promise<AdminPackageDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await getAdminPackageDetail(session as z.infer<typeof authSessionSchema>, packageId, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin package.");
      }
    },

    async handleAdminCredits(session: unknown): Promise<AdminCreditListHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await listAdminCredits(session as z.infer<typeof authSessionSchema>, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin credits.");
      }
    },

    async handleAdminCreditDetail(session: unknown, creditId: string): Promise<AdminCreditDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await getAdminCreditDetail(session as z.infer<typeof authSessionSchema>, creditId, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin credit.");
      }
    },

    async handleAdminFormDetail(session: unknown, formId: string): Promise<AdminFormDetailHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Admin session required.");
        }

        return { status: 200, body: await getAdminFormDetail(session as z.infer<typeof authSessionSchema>, formId, dependencies.adminResources) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading admin form.");
      }
    },

    async handlePortalQuoteAccept(session: unknown, quoteId: string): Promise<PortalQuoteAcceptHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await acceptPortalQuote(session as z.infer<typeof authSessionSchema>, quoteId, dependencies.portalCommerce) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof CommerceActionError) {
          return createError(error.code === "not_found" ? 404 : 409, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while accepting portal quote.");
      }
    },

    async handlePortalContractSign(session: unknown, contractId: string): Promise<PortalContractSignHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await signPortalContract(session as z.infer<typeof authSessionSchema>, contractId, dependencies.portalCommerce) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof CommerceActionError) {
          return createError(error.code === "not_found" ? 404 : 409, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while signing portal contract.");
      }
    },

    async handlePortalFormSubmit(session: unknown, formId: string): Promise<PortalFormSubmitHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return { status: 200, body: await submitPortalForm(session as z.infer<typeof authSessionSchema>, formId, dependencies.portalCommerce) };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof CommerceActionError) {
          return createError(error.code === "not_found" ? 404 : 409, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while submitting portal form.");
      }
    },

    async handlePortalInvoicePaymentSession(
      session: unknown,
      invoiceId: string,
      input: unknown
    ): Promise<PortalInvoicePaymentSessionHandlerResult> {
      try {
        if (session == null) {
          return createError(401, "unauthorized", "Portal session required.");
        }

        return {
          status: 200,
          body: await createPortalInvoicePaymentSession(
            session as z.infer<typeof authSessionSchema>,
            invoiceId,
            input,
            dependencies.portalCommerce
          )
        };
      } catch (error) {
        if (error instanceof SessionActorError) {
          return createError(error.code === "unauthorized" ? 401 : 404, error.code, error.message);
        }
        if (error instanceof CommerceActionError) {
          return createError(error.code === "not_found" ? 404 : 409, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while creating invoice payment session.");
      }
    },

    async handlePublicQuoteDetail(input: { quoteId: string | null; token: string | null; session: unknown }): Promise<PublicQuoteDetailHandlerResult> {
      try {
        return {
          status: 200,
          body: await getPublicQuoteDetail(input, dependencies.publicDocuments)
        };
      } catch (error) {
        if (error instanceof PublicDocumentAccessError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading public quote.");
      }
    },

    async handlePublicContractDetail(input: { contractId: string | null; token: string | null; session: unknown }): Promise<PublicContractDetailHandlerResult> {
      try {
        return {
          status: 200,
          body: await getPublicContractDetail(input, dependencies.publicDocuments)
        };
      } catch (error) {
        if (error instanceof PublicDocumentAccessError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading public contract.");
      }
    },

    async handlePublicFormSubmissionDetail(input: { submissionId: string | null; token: string | null; session: unknown }): Promise<PublicFormSubmissionDetailHandlerResult> {
      try {
        return {
          status: 200,
          body: await getPublicFormSubmissionDetail(input, dependencies.publicDocuments)
        };
      } catch (error) {
        if (error instanceof PublicDocumentAccessError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading public form submission.");
      }
    },

    async handlePublicBookingIcalDetail(input: { bookingId: string | null; token: string | null; session: unknown }): Promise<PublicBookingIcalDetailHandlerResult> {
      try {
        return {
          status: 200,
          body: await getPublicBookingIcalDetail(input, dependencies.publicDocuments)
        };
      } catch (error) {
        if (error instanceof PublicDocumentAccessError) {
          return createError(404, error.code, error.message);
        }
        if (error instanceof z.ZodError) {
          return createValidationError(error);
        }
        return createError(500, "internal_error", "Unexpected error while loading public booking iCal.");
      }
    }
  };
}
