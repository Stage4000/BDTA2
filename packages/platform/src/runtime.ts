import { z } from "zod";

import { resolveDatabaseUrl, resolveSessionTtlSeconds } from "./environment.js";

const nodeEnvironmentSchema = z.enum(["development", "test", "production"]).default("development");

export const appSurfaces = {
  publicSite: {
    routes: ["/", "/services", "/blog", "/book"],
    parityCritical: true
  },
  adminCrm: {
    routes: ["/client", "/client/bookings", "/client/settings", "/admin/quotes", "/admin/contracts"],
    parityCritical: true
  },
  customerPortal: {
    routes: ["/portal", "/portal/appointments", "/portal/invoices", "/portal/quotes", "/portal/contracts"],
    parityCritical: true
  }
} as const;

export const providerCapabilities = {
  payments: ["stripe"],
  calendar: ["google_calendar", "ical"],
  outboundEmail: ["smtp"],
  inboundEmail: ["imap", "mail_provider"],
  captcha: ["turnstile"]
} as const;

export type RuntimeEnvironment = {
  NODE_ENV: z.infer<typeof nodeEnvironmentSchema>;
  databaseUrl: string;
  sessionTtlSeconds: number;
};

export function parseRuntimeEnvironment(env: Record<string, string | undefined>): RuntimeEnvironment {
  return {
    NODE_ENV: nodeEnvironmentSchema.parse(env.NODE_ENV),
    databaseUrl: resolveDatabaseUrl(env),
    sessionTtlSeconds: resolveSessionTtlSeconds(env)
  };
}
