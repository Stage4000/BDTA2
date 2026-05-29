import { z } from "zod";

import {
  type Booking,
  bookingSchema,
  type OutboundEmailMessage,
  outboundEmailSchema,
  publicAccessTokenSchema,
  timestampSchema
} from "@bdta/domain";
import {
  type JobEnvelope,
  jobEnvelopeSchema,
  publicBookingRequestSchema,
  publicBookingResponseSchema,
  type PublicBookingRequest,
  type PublicBookingResponse
} from "@bdta/contracts";
import { PublicBookingError } from "./errors.js";

const publicBookingPolicySchema = z.object({
  initialStatus: z.enum(["pending", "confirmed"]),
  issuePortalReturnUrl: z.boolean(),
  queueReminderWhenConfirmed: z.boolean()
});

export type PublicBookingPolicy = z.infer<typeof publicBookingPolicySchema>;

export type PublicBookingDependencies = {
  now(): string;
  generateId(prefix: "booking" | "job"): string;
  verifyCaptcha(turnstileToken: string): Promise<boolean>;
  isTimeSlotAvailable(input: Pick<PublicBookingRequest, "serviceId" | "requestedStart" | "requestedEnd">): Promise<boolean>;
  ensureClientForBooking(email: string): Promise<{ clientId: string; portalUserId: string | null; displayName: string }>;
  issueIcalToken(input: { bookingId: string; issuedAt: string }): Promise<z.infer<typeof publicAccessTokenSchema>>;
  saveBooking(input: {
    booking: Booking;
    request: PublicBookingRequest;
    client: { clientId: string; portalUserId: string | null; displayName: string };
  }): Promise<void>;
  queueConfirmationEmail(message: OutboundEmailMessage): Promise<void>;
  queueJob(job: JobEnvelope): Promise<void>;
  buildPortalReturnUrl(clientId: string): string | null;
};

const defaultPolicy: PublicBookingPolicy = {
  initialStatus: "confirmed",
  issuePortalReturnUrl: true,
  queueReminderWhenConfirmed: true
};

function validateTimeRange(request: PublicBookingRequest): void {
  const start = Date.parse(request.requestedStart);
  const end = Date.parse(request.requestedEnd);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new PublicBookingError("invalid_time_range", "Public booking requests must have an end time after the start time.");
  }
}

function buildConfirmationEmail(input: {
  request: PublicBookingRequest;
  booking: Booking;
  portalReturnUrl: string | null;
}): OutboundEmailMessage {
  return outboundEmailSchema.parse({
    to: [input.request.clientEmail],
    subject: "Booking confirmation",
    templateKey: "booking_confirmation",
    html: [
      `<p>Your booking request for service ${input.request.serviceId} is ${input.booking.status}.</p>`,
      `<p>Booking ID: ${input.booking.id}</p>`,
      input.portalReturnUrl ? `<p>Portal: <a href="${input.portalReturnUrl}">${input.portalReturnUrl}</a></p>` : ""
    ].join("")
  });
}

function buildReminderJob(input: { booking: Booking; requestedStart: string; now: string; generateId: PublicBookingDependencies["generateId"] }): JobEnvelope {
  return jobEnvelopeSchema.parse({
    jobId: input.generateId("job"),
    kind: "booking_reminder",
    scheduledFor: input.requestedStart,
    payload: {
      bookingId: input.booking.id,
      queuedAt: input.now
    }
  });
}

export async function createPublicBooking(
  requestInput: PublicBookingRequest,
  dependencies: PublicBookingDependencies,
  policyInput?: Partial<PublicBookingPolicy>
): Promise<{ booking: Booking; response: PublicBookingResponse }> {
  const request = publicBookingRequestSchema.parse(requestInput);
  const policy = publicBookingPolicySchema.parse({ ...defaultPolicy, ...policyInput });

  validateTimeRange(request);

  const captchaValid = await dependencies.verifyCaptcha(request.turnstileToken);
  if (!captchaValid) {
    throw new PublicBookingError("captcha_failed", "Captcha verification failed.");
  }

  const available = await dependencies.isTimeSlotAvailable({
    serviceId: request.serviceId,
    requestedStart: request.requestedStart,
    requestedEnd: request.requestedEnd
  });

  if (!available) {
    throw new PublicBookingError("slot_unavailable", "The requested booking slot is no longer available.");
  }

  const now = timestampSchema.parse(dependencies.now());
  const client = await dependencies.ensureClientForBooking(request.clientEmail);
  const bookingId = dependencies.generateId("booking");
  const icalAccess = await dependencies.issueIcalToken({
    bookingId,
    issuedAt: now
  });

  const booking = bookingSchema.parse({
    id: bookingId,
    clientId: client.clientId,
    petIds: request.petIds,
    serviceId: request.serviceId,
    startsAt: request.requestedStart,
    endsAt: request.requestedEnd,
    status: policy.initialStatus,
    icalAccess
  });

  await dependencies.saveBooking({
    booking,
    request,
    client
  });

  const portalReturnUrl = policy.issuePortalReturnUrl ? dependencies.buildPortalReturnUrl(client.clientId) : null;

  await dependencies.queueConfirmationEmail(
    buildConfirmationEmail({
      request,
      booking,
      portalReturnUrl
    })
  );

  if (booking.status === "confirmed" && policy.queueReminderWhenConfirmed) {
    await dependencies.queueJob(
      buildReminderJob({
        booking,
        requestedStart: request.requestedStart,
        now,
        generateId: dependencies.generateId
      })
    );
  }

  const response = publicBookingResponseSchema.parse({
    bookingId: booking.id,
    status: booking.status,
    confirmationEmailQueued: true,
    portalReturnUrl
  });

  return { booking, response };
}
