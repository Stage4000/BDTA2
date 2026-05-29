import { z } from "zod";

export const runtimeEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  IMAP_HOST: z.string().min(1),
  SMTP_HOST: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1)
});

export const appSurfaces = {
  publicSite: {
    routes: ["/", "/services", "/blog", "/book"],
    parityCritical: true
  },
  adminCrm: {
    routes: ["/client", "/client/bookings", "/client/settings"],
    parityCritical: true
  },
  customerPortal: {
    routes: ["/portal", "/portal/appointments", "/portal/invoices"],
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

export type RuntimeEnvironment = z.infer<typeof runtimeEnvironmentSchema>;

export function parseRuntimeEnvironment(env: Record<string, string | undefined>): RuntimeEnvironment {
  return runtimeEnvironmentSchema.parse(env);
}
