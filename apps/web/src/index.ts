import { appSurfaces } from "@bdta/platform";

export const webRuntimeManifest = {
  name: "bdta-web",
  surfaces: appSurfaces,
  routeGroups: {
    publicSite: ["/", "/services", "/blog", "/book"],
    adminCrm: ["/client", "/client/bookings", "/client/settings", "/admin/quotes", "/admin/contracts", "/admin/appointment-types", "/admin/email-templates", "/admin/scheduled-tasks"],
    customerPortal: ["/portal", "/portal/appointments", "/portal/invoices", "/portal/quotes", "/portal/contracts"]
  }
} as const;
