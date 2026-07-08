import { releaseValidationIds } from "../apps/release/src/fixtures.js";
import { releaseValidationApiSmokeRoutes, releaseValidationPageRoutes } from "../apps/release/src/route-manifest.js";

describe("release route manifest", () => {
  it("covers portal commerce detail pages for screenshot parity validation", () => {
    const routesByName = new Map(releaseValidationPageRoutes.map((route) => [route.name, route]));

    expect(routesByName.get("portal-booking-detail")).toEqual({
      name: "portal-booking-detail",
      role: "portal",
      path: `/portal/bookings/${releaseValidationIds.bookingId}`
    });
    expect(routesByName.get("portal-invoice-detail")).toEqual({
      name: "portal-invoice-detail",
      role: "portal",
      path: `/portal/invoices/${releaseValidationIds.invoiceId}`
    });
    expect(routesByName.get("portal-quote-detail")).toEqual({
      name: "portal-quote-detail",
      role: "portal",
      path: `/portal/quotes/${releaseValidationIds.quoteId}`
    });
    expect(routesByName.get("portal-contract-detail")).toEqual({
      name: "portal-contract-detail",
      role: "portal",
      path: `/portal/contracts/${releaseValidationIds.contractId}`
    });
    expect(routesByName.get("portal-pet-detail")).toEqual({
      name: "portal-pet-detail",
      role: "portal",
      path: `/portal/pets/${releaseValidationIds.petId}`
    });
    expect(routesByName.get("portal-package-detail")).toEqual({
      name: "portal-package-detail",
      role: "portal",
      path: `/portal/packages/${releaseValidationIds.packageId}`
    });
    expect(routesByName.get("portal-credit-detail")).toEqual({
      name: "portal-credit-detail",
      role: "portal",
      path: `/portal/credits/${releaseValidationIds.creditId}`
    });
  });

  it("covers admin workflow management pages for screenshot parity validation", () => {
    const routesByName = new Map(releaseValidationPageRoutes.map((route) => [route.name, route]));

    expect(routesByName.get("admin-booking-detail")).toEqual({
      name: "admin-booking-detail",
      role: "admin",
      path: `/admin/bookings/${releaseValidationIds.bookingId}`
    });
    expect(routesByName.get("admin-invoice-detail")).toEqual({
      name: "admin-invoice-detail",
      role: "admin",
      path: `/admin/invoices/${releaseValidationIds.invoiceId}`
    });
    expect(routesByName.get("admin-quote-detail")).toEqual({
      name: "admin-quote-detail",
      role: "admin",
      path: `/admin/quotes/${releaseValidationIds.quoteId}`
    });
    expect(routesByName.get("admin-contract-detail")).toEqual({
      name: "admin-contract-detail",
      role: "admin",
      path: `/admin/contracts/${releaseValidationIds.contractId}`
    });
    expect(routesByName.get("admin-form-detail")).toEqual({
      name: "admin-form-detail",
      role: "admin",
      path: `/admin/forms/${releaseValidationIds.formId}`
    });
    expect(routesByName.get("admin-pet-detail")).toEqual({
      name: "admin-pet-detail",
      role: "admin",
      path: `/admin/pets/${releaseValidationIds.petId}`
    });
    expect(routesByName.get("admin-package-detail")).toEqual({
      name: "admin-package-detail",
      role: "admin",
      path: `/admin/packages/${releaseValidationIds.packageId}`
    });
    expect(routesByName.get("admin-credit-detail")).toEqual({
      name: "admin-credit-detail",
      role: "admin",
      path: `/admin/credits/${releaseValidationIds.creditId}`
    });
    expect(routesByName.get("admin-workflows")).toEqual({
      name: "admin-workflows",
      role: "admin",
      path: "/admin/workflows"
    });
    expect(routesByName.get("admin-workflow-detail")).toEqual({
      name: "admin-workflow-detail",
      role: "admin",
      path: `/admin/workflows/${releaseValidationIds.workflowId}`
    });
    expect(routesByName.get("admin-workflow-enrollments")).toEqual({
      name: "admin-workflow-enrollments",
      role: "admin",
      path: `/admin/workflows/${releaseValidationIds.workflowId}/enrollments`
    });
    expect(routesByName.get("admin-workflow-enroll")).toEqual({
      name: "admin-workflow-enroll",
      role: "admin",
      path: `/admin/workflows/${releaseValidationIds.workflowId}/enroll`
    });
    expect(routesByName.get("admin-workflow-steps")).toEqual({
      name: "admin-workflow-steps",
      role: "admin",
      path: `/admin/workflows/${releaseValidationIds.workflowId}/steps`
    });
    expect(routesByName.get("admin-workflow-step-new")).toEqual({
      name: "admin-workflow-step-new",
      role: "admin",
      path: `/admin/workflows/${releaseValidationIds.workflowId}/steps/new`
    });
    expect(routesByName.get("admin-workflow-step-detail")).toEqual({
      name: "admin-workflow-step-detail",
      role: "admin",
      path: `/admin/workflows/${releaseValidationIds.workflowId}/steps/${releaseValidationIds.workflowStepId}`
    });
  });

  it("covers the site page visual editor for screenshot parity validation", () => {
    const routesByName = new Map(releaseValidationPageRoutes.map((route) => [route.name, route]));

    expect(routesByName.get("admin-site-page-editor")).toEqual({
      name: "admin-site-page-editor",
      role: "admin",
      path: `/admin/site-pages/${releaseValidationIds.servicesPageId}/editor`
    });
  });

  it("covers legacy public booking entry routes for parity validation", () => {
    const pageRoutesByName = new Map(releaseValidationPageRoutes.map((route) => [route.name, route]));
    const apiRoutesByName = new Map(releaseValidationApiSmokeRoutes.map((route) => [route.name, route]));

    expect(pageRoutesByName.get("public-book-legacy")).toEqual({
      name: "public-book-legacy",
      role: "public",
      path: `/backend/public/book.php?type=${encodeURIComponent(releaseValidationIds.workflowAppointmentTypeId)}`
    });
    expect(pageRoutesByName.get("public-package-detail-legacy")).toEqual({
      name: "public-package-detail-legacy",
      role: "public",
      path: "/client/package_detail.php?token=starter-package-token"
    });
    expect(apiRoutesByName.get("public-services-feed")).toEqual({
      name: "public-services-feed",
      role: "public",
      path: "/backend/public/api_services.php",
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(apiRoutesByName.get("public-events-feed")).toEqual({
      name: "public-events-feed",
      role: "public",
      path: "/backend/public/api_events.php",
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(apiRoutesByName.get("public-packages-feed")).toEqual({
      name: "public-packages-feed",
      role: "public",
      path: "/backend/public/api_packages.php",
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
  });

  it("covers admin communication and automation configuration pages for screenshot parity validation", () => {
    const routesByName = new Map(releaseValidationPageRoutes.map((route) => [route.name, route]));

    expect(routesByName.get("admin-appointment-types")).toEqual({
      name: "admin-appointment-types",
      role: "admin",
      path: "/admin/appointment-types"
    });
    expect(routesByName.get("admin-appointment-type-detail")).toEqual({
      name: "admin-appointment-type-detail",
      role: "admin",
      path: `/admin/appointment-types/${releaseValidationIds.workflowAppointmentTypeId}`
    });
    expect(routesByName.get("admin-email-templates")).toEqual({
      name: "admin-email-templates",
      role: "admin",
      path: "/admin/email-templates"
    });
    expect(routesByName.get("admin-email-template-detail")).toEqual({
      name: "admin-email-template-detail",
      role: "admin",
      path: `/admin/email-templates/${releaseValidationIds.workflowEmailTemplateId}`
    });
    expect(routesByName.get("admin-scheduled-tasks")).toEqual({
      name: "admin-scheduled-tasks",
      role: "admin",
      path: "/admin/scheduled-tasks"
    });
    expect(routesByName.get("admin-scheduled-task-detail")).toEqual({
      name: "admin-scheduled-task-detail",
      role: "admin",
      path: `/admin/scheduled-tasks/${releaseValidationIds.scheduledTaskId}`
    });
  });

  it("covers authenticated portal and admin JSON endpoints in API smoke validation", () => {
    const routesByName = new Map(releaseValidationApiSmokeRoutes.map((route) => [route.name, route]));

    expect(routesByName.get("public-contact")).toEqual({
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
    });
    expect(routesByName.get("portal-summary")).toEqual({
      name: "portal-summary",
      role: "portal",
      path: "/api/portal/summary",
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("portal-booking-detail")).toEqual({
      name: "portal-booking-detail",
      role: "portal",
      path: `/api/portal/bookings/${releaseValidationIds.bookingId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("portal-form-detail")).toEqual({
      name: "portal-form-detail",
      role: "portal",
      path: `/api/portal/forms/${releaseValidationIds.formId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("portal-invoice-detail")).toEqual({
      name: "portal-invoice-detail",
      role: "portal",
      path: `/api/portal/invoices/${releaseValidationIds.invoiceId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("portal-quote-detail")).toEqual({
      name: "portal-quote-detail",
      role: "portal",
      path: `/api/portal/quotes/${releaseValidationIds.quoteId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("portal-contract-detail")).toEqual({
      name: "portal-contract-detail",
      role: "portal",
      path: `/api/portal/contracts/${releaseValidationIds.contractId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("portal-pet-detail")).toEqual({
      name: "portal-pet-detail",
      role: "portal",
      path: `/api/portal/pets/${releaseValidationIds.petId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("portal-package-detail")).toEqual({
      name: "portal-package-detail",
      role: "portal",
      path: `/api/portal/packages/${releaseValidationIds.packageId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("portal-credit-detail")).toEqual({
      name: "portal-credit-detail",
      role: "portal",
      path: `/api/portal/credits/${releaseValidationIds.creditId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("admin-dashboard")).toEqual({
      name: "admin-dashboard",
      role: "admin",
      path: "/api/admin/dashboard",
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("admin-appointment-type-detail")).toEqual({
      name: "admin-appointment-type-detail",
      role: "admin",
      path: `/api/admin/appointment-types/${releaseValidationIds.workflowAppointmentTypeId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("admin-email-template-detail")).toEqual({
      name: "admin-email-template-detail",
      role: "admin",
      path: `/api/admin/email-templates/${releaseValidationIds.workflowEmailTemplateId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("admin-scheduled-task-detail")).toEqual({
      name: "admin-scheduled-task-detail",
      role: "admin",
      path: `/api/admin/scheduled-tasks/${releaseValidationIds.scheduledTaskId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("admin-booking-detail")).toEqual({
      name: "admin-booking-detail",
      role: "admin",
      path: `/api/admin/bookings/${releaseValidationIds.bookingId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("admin-invoice-detail")).toEqual({
      name: "admin-invoice-detail",
      role: "admin",
      path: `/api/admin/invoices/${releaseValidationIds.invoiceId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("admin-quote-detail")).toEqual({
      name: "admin-quote-detail",
      role: "admin",
      path: `/api/admin/quotes/${releaseValidationIds.quoteId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("admin-contract-detail")).toEqual({
      name: "admin-contract-detail",
      role: "admin",
      path: `/api/admin/contracts/${releaseValidationIds.contractId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("admin-form-detail")).toEqual({
      name: "admin-form-detail",
      role: "admin",
      path: `/api/admin/forms/${releaseValidationIds.formId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("admin-pet-detail")).toEqual({
      name: "admin-pet-detail",
      role: "admin",
      path: `/api/admin/pets/${releaseValidationIds.petId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("admin-package-detail")).toEqual({
      name: "admin-package-detail",
      role: "admin",
      path: `/api/admin/packages/${releaseValidationIds.packageId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("admin-credit-detail")).toEqual({
      name: "admin-credit-detail",
      role: "admin",
      path: `/api/admin/credits/${releaseValidationIds.creditId}`,
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("admin-workflows")).toEqual({
      name: "admin-workflows",
      role: "admin",
      path: "/api/admin/workflows",
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
    expect(routesByName.get("admin-settings")).toEqual({
      name: "admin-settings",
      role: "admin",
      path: "/api/admin/settings",
      expectedStatus: 200,
      expectedContentTypePrefix: "application/json"
    });
  });
});
