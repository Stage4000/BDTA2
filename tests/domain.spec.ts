import {
  bookingSchema,
  contractSchema,
  dateSchema,
  formTemplateSchema,
  invoiceSchema,
  quoteSchema,
  timestampSchema
} from "@bdta/domain";

describe("domain entities", () => {
  it("normalizes Date timestamps to ISO strings", () => {
    const value = new Date("2026-07-10T20:52:44.000Z");

    expect(timestampSchema.parse(value)).toBe("2026-07-10T20:52:44.000Z");
  });

  it("normalizes Date-only values to YYYY-MM-DD strings", () => {
    const value = new Date(2026, 6, 10);

    expect(dateSchema.parse(value)).toBe("2026-07-10");
  });

  it("normalizes legacy SQL date and timestamp strings", () => {
    expect(timestampSchema.parse("2026-07-10")).toBe("2026-07-10T00:00:00.000Z");
    expect(timestampSchema.parse("2026-07-10 20:52:44")).toBe("2026-07-10T20:52:44.000Z");
    expect(dateSchema.parse("2026-07-10 20:52:44")).toBe("2026-07-10");
  });

  it("treats blank legacy form-template frequency values as null", () => {
    const result = formTemplateSchema.parse({
      id: "form-template-1",
      name: "Boarding Intake",
      active: true,
      description: "Collect intake details before boarding.",
      fields: [],
      formType: "client_form",
      requiredFrequency: "",
      appointmentTypeId: null,
      templateIsInternal: false,
      templateShowInClientPortal: true
    });

    expect(result.requiredFrequency).toBeNull();
  });

  it("normalizes legacy quote and contract date fields", () => {
    const quote = quoteSchema.parse({
      id: "quote-1",
      clientId: "client-1",
      status: "sent",
      totalAmount: 500,
      expiresAt: new Date("2026-07-10T20:52:44.000Z"),
      acceptedAt: "",
      declinedAt: null,
      publicAccess: null
    });
    const contract = contractSchema.parse({
      id: "contract-1",
      clientId: "client-1",
      status: "sent",
      effectiveDate: new Date(2026, 6, 10),
      signedAt: "",
      publicAccess: null
    });

    expect(quote.expiresAt).toBe("2026-07-10T20:52:44.000Z");
    expect(quote.acceptedAt).toBeNull();
    expect(contract.effectiveDate).toBe("2026-07-10");
    expect(contract.signedAt).toBeNull();
  });

  it("models booking tokenized iCal access", () => {
    const result = bookingSchema.parse({
      id: "booking-1",
      clientId: "client-1",
      petIds: ["pet-1"],
      serviceId: "service-1",
      startsAt: "2026-06-01T16:00:00.000Z",
      endsAt: "2026-06-01T17:00:00.000Z",
      status: "confirmed",
      icalAccess: {
        token: "abcdefghijklmnop",
        issuedAt: "2026-05-26T00:00:00.000Z",
        expiresAt: null,
        legacySourceId: "123"
      }
    });

    expect(result.status).toBe("confirmed");
  });

  it("models document payment entities needed for parity", () => {
    const quote = quoteSchema.parse({
      id: "quote-1",
      clientId: "client-1",
      status: "sent",
      totalAmount: 500,
      publicAccess: null
    });
    const contract = contractSchema.parse({
      id: "contract-1",
      clientId: "client-1",
      status: "sent",
      publicAccess: null
    });
    const invoice = invoiceSchema.parse({
      id: "invoice-1",
      clientId: "client-1",
      status: "overdue",
      totalAmount: 500,
      outstandingAmount: 200,
      dueAt: "2026-06-05T00:00:00.000Z"
    });

    expect(quote.status).toBe("sent");
    expect(contract.status).toBe("sent");
    expect(invoice.outstandingAmount).toBe(200);
  });
});
