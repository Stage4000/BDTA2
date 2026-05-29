import {
  jobEnvelopeSchema,
  publicBookingRequestSchema,
  tokenizedPublicLinkMigrationSchema
} from "@bdta/contracts";

describe("contracts", () => {
  it("accepts a parity-aligned public booking request", () => {
    const result = publicBookingRequestSchema.parse({
      serviceId: "svc-private-lesson",
      clientEmail: "client@example.com",
      petIds: ["pet-1"],
      requestedStart: "2026-06-01T16:00:00.000Z",
      requestedEnd: "2026-06-01T17:00:00.000Z",
      turnstileToken: "turnstile-token"
    });

    expect(result.serviceId).toBe("svc-private-lesson");
  });

  it("captures tokenized public-link migration requirements", () => {
    const result = tokenizedPublicLinkMigrationSchema.parse({
      resourceKind: "quote",
      legacyIdentifierField: "quote_id",
      tokenField: "access_token",
      required: true
    });

    expect(result.required).toBe(true);
  });

  it("supports the scheduled jobs called out by the scope", () => {
    const result = jobEnvelopeSchema.parse({
      jobId: "job-1",
      kind: "workflow_processor",
      scheduledFor: "2026-06-01T09:00:00.000Z",
      payload: { workflowId: "wf-1" }
    });

    expect(result.kind).toBe("workflow_processor");
  });
});
