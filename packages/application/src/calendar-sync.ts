import {
  bookingCalendarSyncRequestSchema,
  bookingCalendarSyncResponseSchema
} from "@bdta/contracts";
import type { Booking } from "@bdta/domain";
import { bookingSchema } from "@bdta/domain";
import { SessionActorError, type SessionSnapshot } from "./session-actors.js";

export class CalendarSyncError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_state",
    message: string
  ) {
    super(message);
    this.name = "CalendarSyncError";
  }
}

export type AdminCalendarSyncDependencies = {
  syncAdminBookingCalendar(
    bookingId: string,
    provider: "google_calendar"
  ): Promise<{
    booking: Booking;
    provider: "google_calendar";
    externalEventId: string;
    externalEventUrl: string | null;
    syncedAt: string;
  } | null>;
  getAdminBookingCalendarSync(
    bookingId: string,
    provider: "google_calendar"
  ): Promise<{
    booking: Booking;
    provider: "google_calendar";
    externalEventId: string;
    externalEventUrl: string | null;
    syncedAt: string;
  } | null>;
};

function requireAdminSession(session: SessionSnapshot): void {
  if (session.actorType !== "admin_user") {
    throw new SessionActorError("unauthorized", "Admin session required.");
  }
}

export async function syncAdminBookingCalendar(
  session: SessionSnapshot,
  bookingId: string,
  input: unknown,
  dependencies: AdminCalendarSyncDependencies
) {
  requireAdminSession(session);
  const request = bookingCalendarSyncRequestSchema.parse(input);
  const result = await dependencies.syncAdminBookingCalendar(bookingId, request.provider);

  if (result == null) {
    throw new CalendarSyncError("not_found", "Admin booking not found.");
  }

  if (result.booking.status === "cancelled") {
    throw new CalendarSyncError("invalid_state", "Cancelled bookings cannot be synced to calendar.");
  }

  return bookingCalendarSyncResponseSchema.parse({
    booking: bookingSchema.parse(result.booking),
    provider: result.provider,
    externalEventId: result.externalEventId,
    externalEventUrl: result.externalEventUrl,
    syncedAt: result.syncedAt
  });
}

export async function getAdminBookingCalendarSync(
  session: SessionSnapshot,
  bookingId: string,
  dependencies: AdminCalendarSyncDependencies
) {
  requireAdminSession(session);
  const result = await dependencies.getAdminBookingCalendarSync(bookingId, "google_calendar");

  if (result == null) {
    throw new CalendarSyncError("not_found", "Admin booking calendar sync not found.");
  }

  return bookingCalendarSyncResponseSchema.parse({
    booking: bookingSchema.parse(result.booking),
    provider: result.provider,
    externalEventId: result.externalEventId,
    externalEventUrl: result.externalEventUrl,
    syncedAt: result.syncedAt
  });
}
