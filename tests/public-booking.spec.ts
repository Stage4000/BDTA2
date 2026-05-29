import { createPublicBooking, PublicBookingError, type PublicBookingDependencies } from "@bdta/application";

function createDependencies(overrides: Partial<PublicBookingDependencies> = {}): PublicBookingDependencies {
  const savedBookings: unknown[] = [];
  const queuedEmails: unknown[] = [];
  const queuedJobs: unknown[] = [];
  let sequence = 0;

  const base: PublicBookingDependencies = {
    now: () => "2026-05-26T18:00:00.000Z",
    generateId: (prefix) => `${prefix}-${++sequence}`,
    verifyCaptcha: async () => true,
    isTimeSlotAvailable: async () => true,
    ensureClientForBooking: async () => ({ clientId: "client-1", portalUserId: "portal-1", displayName: "Client One" }),
    issueIcalToken: async ({ bookingId, issuedAt }) => ({
      token: `ical-${bookingId}-token`,
      issuedAt,
      expiresAt: null,
      legacySourceId: null
    }),
    saveBooking: async ({ booking }) => {
      savedBookings.push(booking);
    },
    queueConfirmationEmail: async (message) => {
      queuedEmails.push(message);
    },
    queueJob: async (job) => {
      queuedJobs.push(job);
    },
    buildPortalReturnUrl: (clientId) => `https://portal.example.test/portal?client=${clientId}`
  };

  return {
    ...base,
    ...overrides
  };
}

describe("public booking service", () => {
  it("creates a confirmed booking and queues follow-up work", async () => {
    const savedBookings: unknown[] = [];
    const queuedEmails: unknown[] = [];
    const queuedJobs: unknown[] = [];

    const dependencies = createDependencies({
      saveBooking: async ({ booking }) => {
        savedBookings.push(booking);
      },
      queueConfirmationEmail: async (message) => {
        queuedEmails.push(message);
      },
      queueJob: async (job) => {
        queuedJobs.push(job);
      }
    });

    const result = await createPublicBooking(
      {
        serviceId: "svc-private-lesson",
        clientEmail: "client@example.com",
        petIds: ["pet-1"],
        requestedStart: "2026-06-01T16:00:00.000Z",
        requestedEnd: "2026-06-01T17:00:00.000Z",
        turnstileToken: "turnstile-ok"
      },
      dependencies
    );

    expect(result.booking.status).toBe("confirmed");
    expect(result.booking.icalAccess?.token).toContain("booking-");
    expect(result.response.confirmationEmailQueued).toBe(true);
    expect(result.response.portalReturnUrl).toContain("client-1");
    expect(savedBookings).toHaveLength(1);
    expect(queuedEmails).toHaveLength(1);
    expect(queuedJobs).toHaveLength(1);
  });

  it("rejects captcha failures before creating a booking", async () => {
    const dependencies = createDependencies({
      verifyCaptcha: async () => false
    });

    await expect(
      createPublicBooking(
        {
          serviceId: "svc-private-lesson",
          clientEmail: "client@example.com",
          petIds: ["pet-1"],
          requestedStart: "2026-06-01T16:00:00.000Z",
          requestedEnd: "2026-06-01T17:00:00.000Z",
          turnstileToken: "turnstile-fail"
        },
        dependencies
      )
    ).rejects.toMatchObject({ code: "captcha_failed" } satisfies Pick<PublicBookingError, "code">);
  });

  it("rejects unavailable slots", async () => {
    const dependencies = createDependencies({
      isTimeSlotAvailable: async () => false
    });

    await expect(
      createPublicBooking(
        {
          serviceId: "svc-private-lesson",
          clientEmail: "client@example.com",
          petIds: ["pet-1"],
          requestedStart: "2026-06-01T16:00:00.000Z",
          requestedEnd: "2026-06-01T17:00:00.000Z",
          turnstileToken: "turnstile-ok"
        },
        dependencies
      )
    ).rejects.toMatchObject({ code: "slot_unavailable" } satisfies Pick<PublicBookingError, "code">);
  });

  it("does not queue reminder jobs for pending booking policies", async () => {
    const queuedJobs: unknown[] = [];
    const dependencies = createDependencies({
      queueJob: async (job) => {
        queuedJobs.push(job);
      }
    });

    const result = await createPublicBooking(
      {
        serviceId: "svc-private-lesson",
        clientEmail: "client@example.com",
        petIds: ["pet-1"],
        requestedStart: "2026-06-01T16:00:00.000Z",
        requestedEnd: "2026-06-01T17:00:00.000Z",
        turnstileToken: "turnstile-ok"
      },
      dependencies,
      {
        initialStatus: "pending"
      }
    );

    expect(result.booking.status).toBe("pending");
    expect(queuedJobs).toHaveLength(0);
  });
});
