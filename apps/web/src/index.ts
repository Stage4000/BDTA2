import { appSurfaces } from "@bdta/platform";

export const webRuntimeManifest = {
  name: "bdta-web",
  surfaces: appSurfaces,
  routeGroups: {
    publicSite: ["/", "/services", "/blog", "/book"],
    adminCrm: ["/client", "/client/bookings", "/client/settings"],
    customerPortal: ["/portal", "/portal/appointments", "/portal/invoices"]
  }
} as const;
