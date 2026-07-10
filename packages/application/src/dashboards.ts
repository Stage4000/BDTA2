import { z } from "zod";

import { adminDashboardSchema, authSessionSchema, portalSummarySchema } from "@bdta/contracts";
import type { Booking, Invoice, Quote } from "@bdta/domain";
import { adminRoleSchema, bookingSchema, invoiceSchema, quoteSchema, timestampSchema } from "@bdta/domain";
import { SessionActorError } from "./session-actors.js";

const sessionSnapshotSchema = authSessionSchema.extend({
  role: adminRoleSchema.nullable().optional(),
  roleRefreshedAt: timestampSchema.optional()
});

function collectValidItems<T>(
  items: readonly unknown[],
  schema: z.ZodType<T>
): T[] {
  return items.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export type PortalSummaryDependencies = {
  listBookingsForPortalActor(clientId: string): Promise<Booking[]>;
  listInvoicesForPortalActor(clientId: string): Promise<Invoice[]>;
  listQuotesForPortalActor(clientId: string): Promise<Quote[]>;
};

export type AdminDashboardDependencies = {
  countPendingBookings(): Promise<number>;
  countTodaysBookings(): Promise<number>;
  countOverdueInvoices(): Promise<number>;
  countActiveClients(): Promise<number>;
  listRecentBookings(): Promise<Booking[]>;
};

export async function buildPortalSummary(
  session: z.infer<typeof sessionSnapshotSchema>,
  dependencies: PortalSummaryDependencies
): Promise<z.infer<typeof portalSummarySchema>> {
  const parsedSession = sessionSnapshotSchema.parse(session);
  if (parsedSession.actorType !== "portal_user") {
    throw new SessionActorError("unauthorized", "Portal session required.");
  }

  const [upcomingBookings, openInvoices, activeQuotes] = await Promise.all([
    dependencies.listBookingsForPortalActor(parsedSession.actorId),
    dependencies.listInvoicesForPortalActor(parsedSession.actorId),
    dependencies.listQuotesForPortalActor(parsedSession.actorId)
  ]);

  return portalSummarySchema.parse({
    upcomingBookings: upcomingBookings.map((booking) => bookingSchema.parse(booking)),
    openInvoices: openInvoices.map((invoice) => invoiceSchema.parse(invoice)),
    activeQuotes: activeQuotes.map((quote) => quoteSchema.parse(quote))
  });
}

export async function buildAdminDashboard(
  session: z.infer<typeof sessionSnapshotSchema>,
  dependencies: AdminDashboardDependencies
): Promise<z.infer<typeof adminDashboardSchema>> {
  const parsedSession = sessionSnapshotSchema.parse(session);
  if (parsedSession.actorType !== "admin_user") {
    throw new SessionActorError("unauthorized", "Admin session required.");
  }

  const [pendingBookings, todaysBookings, overdueInvoices, activeClients, recentBookings] = await Promise.all([
    dependencies.countPendingBookings(),
    dependencies.countTodaysBookings(),
    dependencies.countOverdueInvoices(),
    dependencies.countActiveClients(),
    dependencies.listRecentBookings()
  ]);

  return adminDashboardSchema.parse({
    metrics: {
      pendingBookings,
      todaysBookings,
      overdueInvoices,
      activeClients
    },
    recentBookings: recentBookings.map((booking) => bookingSchema.parse(booking))
  });
}
