import {
  bookingSchema,
  contractSchema,
  invoiceSchema,
  quoteSchema,
  timestampSchema
} from "@bdta/domain";

describe("domain entities", () => {
  it("normalizes Date timestamps to ISO strings", () => {
    const value = new Date("2026-07-10T20:52:44.000Z");

    expect(timestampSchema.parse(value)).toBe("2026-07-10T20:52:44.000Z");
  });

  it("models a booking with tokenized iCal access", () => {
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

  it("models document and payment entities needed for parity", () => {
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
