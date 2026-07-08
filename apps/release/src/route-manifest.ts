import { releaseValidationIds } from "./fixtures.js";

export type ReleaseValidationRole = "public" | "portal" | "admin";

export type ReleaseValidationPageRoute = {
  name: string;
  role: ReleaseValidationRole;
  path: string;
};

export type ReleaseValidationApiSmokeRoute = {
  name: string;
  role: ReleaseValidationRole;
  path: string;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  expectedStatus: number;
  expectedContentTypePrefix: string;
};

export const releaseValidationPageRoutes: ReleaseValidationPageRoute[] = [
  { name: "public-home", role: "public", path: "/" },
  { name: "public-services", role: "public", path: "/services" },
  { name: "public-directory", role: "public", path: "/directory" },
  { name: "public-blog-index", role: "public", path: "/blog" },
  { name: "public-blog-post", role: "public", path: `/blog/${releaseValidationIds.blogSlug}` },
  { name: "public-book", role: "public", path: "/book" },
  {
    name: "public-book-legacy",
    role: "public",
    path: `/backend/public/book.php?type=${encodeURIComponent(releaseValidationIds.workflowAppointmentTypeId)}`
  },
  {
    name: "public-package-detail-legacy",
    role: "public",
    path: "/client/package_detail.php?token=starter-package-token"
  },
  { name: "public-book-confirmation", role: "public", path: `/book/confirmation?bookingId=${encodeURIComponent(releaseValidationIds.bookingId)}` },
  { name: "portal-login", role: "public", path: "/portal/login" },
  { name: "portal-home", role: "portal", path: "/portal" },
  { name: "portal-appointments", role: "portal", path: "/portal/appointments" },
  { name: "portal-booking-detail", role: "portal", path: `/portal/bookings/${releaseValidationIds.bookingId}` },
  { name: "portal-invoices", role: "portal", path: "/portal/invoices" },
  { name: "portal-invoice-detail", role: "portal", path: `/portal/invoices/${releaseValidationIds.invoiceId}` },
  { name: "portal-quotes", role: "portal", path: "/portal/quotes" },
  { name: "portal-quote-detail", role: "portal", path: `/portal/quotes/${releaseValidationIds.quoteId}` },
  { name: "portal-contracts", role: "portal", path: "/portal/contracts" },
  { name: "portal-contract-detail", role: "portal", path: `/portal/contracts/${releaseValidationIds.contractId}` },
  { name: "portal-forms", role: "portal", path: "/portal/forms" },
  { name: "portal-form-detail", role: "portal", path: `/portal/forms/${releaseValidationIds.formId}` },
  { name: "portal-notifications", role: "portal", path: "/portal/notifications" },
  { name: "portal-profile", role: "portal", path: "/portal/profile" },
  { name: "portal-contacts", role: "portal", path: "/portal/contacts" },
  { name: "portal-contact-detail", role: "portal", path: `/portal/contacts/${releaseValidationIds.contactId}` },
  { name: "portal-pets", role: "portal", path: "/portal/pets" },
  { name: "portal-pet-detail", role: "portal", path: `/portal/pets/${releaseValidationIds.petId}` },
  { name: "portal-pet-files", role: "portal", path: `/portal/pets/${releaseValidationIds.petId}/files` },
  { name: "portal-packages", role: "portal", path: "/portal/packages" },
  { name: "portal-package-detail", role: "portal", path: `/portal/packages/${releaseValidationIds.packageId}` },
  { name: "portal-credits", role: "portal", path: "/portal/credits" },
  { name: "portal-credit-detail", role: "portal", path: `/portal/credits/${releaseValidationIds.creditId}` },
  { name: "portal-achievements", role: "portal", path: "/portal/achievements" },
  { name: "portal-achievement-detail", role: "portal", path: `/portal/achievements/${releaseValidationIds.achievementId}` },
  { name: "portal-achievement-certificate", role: "portal", path: `/portal/achievements/${releaseValidationIds.achievementId}/certificate` },
  { name: "admin-login", role: "public", path: "/admin/login" },
  { name: "admin-dashboard", role: "admin", path: "/admin" },
  { name: "admin-dashboard-legacy", role: "admin", path: "/client/index.php" },
  { name: "admin-clients", role: "admin", path: "/admin/clients" },
  { name: "admin-client-profile", role: "admin", path: `/admin/clients/${releaseValidationIds.portalClientId}/profile` },
  { name: "admin-client-contacts", role: "admin", path: `/admin/clients/${releaseValidationIds.portalClientId}/contacts` },
  { name: "admin-client-contact-detail", role: "admin", path: `/admin/clients/${releaseValidationIds.portalClientId}/contacts/${releaseValidationIds.contactId}` },
  { name: "admin-client-achievements", role: "admin", path: `/admin/clients/${releaseValidationIds.portalClientId}/achievements` },
  { name: "admin-client-achievement-detail", role: "admin", path: `/admin/clients/${releaseValidationIds.portalClientId}/achievements/${releaseValidationIds.achievementId}` },
  { name: "admin-client-achievement-certificate", role: "admin", path: `/admin/clients/${releaseValidationIds.portalClientId}/achievements/${releaseValidationIds.achievementId}/certificate` },
  { name: "admin-bookings", role: "admin", path: "/admin/bookings" },
  { name: "admin-booking-detail", role: "admin", path: `/admin/bookings/${releaseValidationIds.bookingId}` },
  { name: "admin-invoices", role: "admin", path: "/admin/invoices" },
  { name: "admin-invoice-detail", role: "admin", path: `/admin/invoices/${releaseValidationIds.invoiceId}` },
  { name: "admin-invoices-legacy", role: "admin", path: "/client/invoices_list.php" },
  { name: "admin-quotes", role: "admin", path: "/admin/quotes" },
  { name: "admin-quote-detail", role: "admin", path: `/admin/quotes/${releaseValidationIds.quoteId}` },
  { name: "admin-contracts", role: "admin", path: "/admin/contracts" },
  { name: "admin-contract-detail", role: "admin", path: `/admin/contracts/${releaseValidationIds.contractId}` },
  { name: "admin-forms", role: "admin", path: "/admin/forms" },
  { name: "admin-form-detail", role: "admin", path: `/admin/forms/${releaseValidationIds.formId}` },
  { name: "admin-form-submissions-legacy", role: "admin", path: "/client/form_submissions_list.php" },
  { name: "admin-form-submission-legacy-detail", role: "admin", path: `/client/form_submissions_view.php?id=${releaseValidationIds.formId}` },
  {
    name: "admin-form-request-create-legacy",
    role: "admin",
    path: `/client/form_requests_create.php?form_type=survey_form&client_id=${releaseValidationIds.portalClientId}&template_id=${releaseValidationIds.surveyFormTemplateId}`
  },
  { name: "admin-pets", role: "admin", path: "/admin/pets" },
  { name: "admin-pet-detail", role: "admin", path: `/admin/pets/${releaseValidationIds.petId}` },
  { name: "admin-pet-files", role: "admin", path: `/admin/pets/${releaseValidationIds.petId}/files` },
  { name: "admin-packages", role: "admin", path: "/admin/packages" },
  { name: "admin-package-detail", role: "admin", path: `/admin/packages/${releaseValidationIds.packageId}` },
  { name: "admin-credits", role: "admin", path: "/admin/credits" },
  { name: "admin-credit-detail", role: "admin", path: `/admin/credits/${releaseValidationIds.creditId}` },
  { name: "admin-workflows", role: "admin", path: "/admin/workflows" },
  { name: "admin-workflow-detail", role: "admin", path: `/admin/workflows/${releaseValidationIds.workflowId}` },
  { name: "admin-workflow-enrollments", role: "admin", path: `/admin/workflows/${releaseValidationIds.workflowId}/enrollments` },
  { name: "admin-workflow-enroll", role: "admin", path: `/admin/workflows/${releaseValidationIds.workflowId}/enroll` },
  { name: "admin-workflow-steps", role: "admin", path: `/admin/workflows/${releaseValidationIds.workflowId}/steps` },
  { name: "admin-workflow-step-new", role: "admin", path: `/admin/workflows/${releaseValidationIds.workflowId}/steps/new` },
  { name: "admin-workflow-step-detail", role: "admin", path: `/admin/workflows/${releaseValidationIds.workflowId}/steps/${releaseValidationIds.workflowStepId}` },
  { name: "admin-achievement-types", role: "admin", path: "/admin/achievement-types" },
  { name: "admin-achievement-type-detail", role: "admin", path: `/admin/achievement-types/${releaseValidationIds.achievementTypeId}` },
  { name: "admin-blog-posts", role: "admin", path: "/admin/blog-posts" },
  { name: "admin-blog-post-detail", role: "admin", path: `/admin/blog-posts/${releaseValidationIds.blogPostId}` },
  { name: "admin-site-pages", role: "admin", path: "/admin/site-pages" },
  { name: "admin-site-page-detail", role: "admin", path: `/admin/site-pages/${releaseValidationIds.servicesPageId}` },
  { name: "admin-site-page-editor", role: "admin", path: `/admin/site-pages/${releaseValidationIds.servicesPageId}/editor` },
  { name: "admin-settings", role: "admin", path: "/admin/settings" },
  { name: "admin-setting-detail", role: "admin", path: `/admin/settings/${releaseValidationIds.settingsKey}` },
  { name: "admin-appointment-types", role: "admin", path: "/admin/appointment-types" },
  { name: "admin-appointment-type-detail", role: "admin", path: `/admin/appointment-types/${releaseValidationIds.workflowAppointmentTypeId}` },
  { name: "admin-form-templates", role: "admin", path: "/admin/form-templates" },
  { name: "admin-form-template-detail", role: "admin", path: `/admin/form-templates/${releaseValidationIds.checkoutFormTemplateId}` },
  { name: "admin-form-template-survey-results", role: "admin", path: `/admin/form-templates/${releaseValidationIds.surveyFormTemplateId}/survey-results` },
  { name: "admin-form-template-survey-results-legacy", role: "admin", path: `/client/form_survey_results.php?template_id=${releaseValidationIds.surveyFormTemplateId}` },
  { name: "admin-email-templates", role: "admin", path: "/admin/email-templates" },
  { name: "admin-email-template-detail", role: "admin", path: `/admin/email-templates/${releaseValidationIds.workflowEmailTemplateId}` },
  { name: "admin-scheduled-tasks", role: "admin", path: "/admin/scheduled-tasks" },
  { name: "admin-scheduled-task-detail", role: "admin", path: `/admin/scheduled-tasks/${releaseValidationIds.scheduledTaskId}` },
  { name: "admin-job-logs", role: "admin", path: "/admin/operations/jobs" },
  { name: "admin-job-log-detail", role: "admin", path: `/admin/operations/jobs/${releaseValidationIds.jobId}` },
  { name: "admin-callback-logs", role: "admin", path: "/admin/operations/callbacks" },
  { name: "admin-callback-log-detail", role: "admin", path: `/admin/operations/callbacks/${releaseValidationIds.callbackId}` }
];

export const releaseValidationApiSmokeRoutes: ReleaseValidationApiSmokeRoute[] = [
  {
    name: "public-services-feed",
    role: "public",
    path: "/backend/public/api_services.php",
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "public-events-feed",
    role: "public",
    path: "/backend/public/api_events.php",
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "public-packages-feed",
    role: "public",
    path: "/backend/public/api_packages.php",
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "public-contact",
    role: "public",
    path: "/api/public/contact",
    method: "POST",
    body: {
      name: "Release Validation Contact",
      email: "release-validation-contact@example.com",
      phone: "555-0199",
      service: "private-lesson",
      message: "Release validation contact submission.",
      turnstile_token: "turnstile-ok"
    },
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "public-quote-access",
    role: "public",
    path: `/api/public/quotes/${releaseValidationIds.quoteId}?token=quote-public-token`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "public-contract-access",
    role: "public",
    path: `/api/public/contracts/${releaseValidationIds.contractId}?token=contract-public-token`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "public-form-access",
    role: "public",
    path: `/api/public/forms/${releaseValidationIds.formId}?token=form-public-token`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "public-booking-ical",
    role: "public",
    path: `/api/public/bookings/${releaseValidationIds.bookingId}/ical?token=booking-ical-token`,
    expectedStatus: 200,
    expectedContentTypePrefix: "text/calendar"
  },
  {
    name: "portal-session",
    role: "portal",
    path: "/api/session",
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "portal-summary",
    role: "portal",
    path: "/api/portal/summary",
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "portal-pet-detail",
    role: "portal",
    path: `/api/portal/pets/${releaseValidationIds.petId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "portal-package-detail",
    role: "portal",
    path: `/api/portal/packages/${releaseValidationIds.packageId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "portal-credit-detail",
    role: "portal",
    path: `/api/portal/credits/${releaseValidationIds.creditId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "portal-booking-detail",
    role: "portal",
    path: `/api/portal/bookings/${releaseValidationIds.bookingId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "portal-invoice-detail",
    role: "portal",
    path: `/api/portal/invoices/${releaseValidationIds.invoiceId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "portal-quote-detail",
    role: "portal",
    path: `/api/portal/quotes/${releaseValidationIds.quoteId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "portal-contract-detail",
    role: "portal",
    path: `/api/portal/contracts/${releaseValidationIds.contractId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "portal-form-detail",
    role: "portal",
    path: `/api/portal/forms/${releaseValidationIds.formId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "admin-session",
    role: "admin",
    path: "/api/session",
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "admin-dashboard",
    role: "admin",
    path: "/api/admin/dashboard",
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "admin-appointment-type-detail",
    role: "admin",
    path: `/api/admin/appointment-types/${releaseValidationIds.workflowAppointmentTypeId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "admin-form-template-detail",
    role: "admin",
    path: `/api/admin/form-templates/${releaseValidationIds.checkoutFormTemplateId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "admin-email-template-detail",
    role: "admin",
    path: `/api/admin/email-templates/${releaseValidationIds.workflowEmailTemplateId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "admin-scheduled-task-detail",
    role: "admin",
    path: `/api/admin/scheduled-tasks/${releaseValidationIds.scheduledTaskId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "admin-booking-detail",
    role: "admin",
    path: `/api/admin/bookings/${releaseValidationIds.bookingId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "admin-invoice-detail",
    role: "admin",
    path: `/api/admin/invoices/${releaseValidationIds.invoiceId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "admin-quote-detail",
    role: "admin",
    path: `/api/admin/quotes/${releaseValidationIds.quoteId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "admin-contract-detail",
    role: "admin",
    path: `/api/admin/contracts/${releaseValidationIds.contractId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "admin-form-detail",
    role: "admin",
    path: `/api/admin/forms/${releaseValidationIds.formId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "admin-pet-detail",
    role: "admin",
    path: `/api/admin/pets/${releaseValidationIds.petId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "admin-package-detail",
    role: "admin",
    path: `/api/admin/packages/${releaseValidationIds.packageId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "admin-credit-detail",
    role: "admin",
    path: `/api/admin/credits/${releaseValidationIds.creditId}`,
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "admin-workflows",
    role: "admin",
    path: "/api/admin/workflows",
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "admin-site-pages",
    role: "admin",
    path: "/api/admin/site-pages",
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  },
  {
    name: "admin-settings",
    role: "admin",
    path: "/api/admin/settings",
    expectedStatus: 200,
    expectedContentTypePrefix: "application/json"
  }
];
