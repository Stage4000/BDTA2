import { z } from "zod";

import {
  contractDetailSchema,
  formSubmissionDetailSchema,
  quoteDetailSchema
} from "@bdta/contracts";
import type { Booking, Contract, FormSubmission, Quote } from "@bdta/domain";
import {
  contractSchema,
  formSubmissionSchema,
  quoteSchema
} from "@bdta/domain";
import {
  authorizeTokenizedPublicAccess,
  type TokenizedPublicAccessInput
} from "./public-access.js";

const optionalSessionSchema = z.object({
  actorId: z.string().min(1),
  actorType: z.enum(["admin_user", "portal_user"]),
  role: z.enum(["owner", "admin", "accountant", "staff"]).nullable().optional(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  roleRefreshedAt: z.string().datetime().optional()
}).nullable();

export type PublicDocumentAccessDependencies = {
  now(): string;
  findPublicQuoteById(quoteId: string): Promise<Quote | null>;
  findPublicContractById(contractId: string): Promise<Contract | null>;
  findPublicFormSubmissionById(submissionId: string): Promise<FormSubmission | null>;
  findPublicBookingIcalById(bookingId: string): Promise<Booking | null>;
};

export class PublicDocumentAccessError extends Error {
  constructor(
    public readonly code: "not_found" | "forbidden",
    message: string
  ) {
    super(message);
    this.name = "PublicDocumentAccessError";
  }
}

function resolveActorType(session: z.infer<typeof optionalSessionSchema>, resourceClientId: string): TokenizedPublicAccessInput["actorType"] {
  if (session == null) {
    return "public";
  }

  if (session.actorType === "admin_user") {
    return "admin_user";
  }

  return session.actorId === resourceClientId ? "portal_owner" : "public";
}

function assertAllowed(
  session: z.infer<typeof optionalSessionSchema>,
  resourceKind: TokenizedPublicAccessInput["resourceKind"],
  resourceClientId: string,
  access: Quote["publicAccess"] | Contract["publicAccess"] | FormSubmission["publicAccess"] | Booking["icalAccess"],
  token: string | null,
  now: string
): void {
  const result = authorizeTokenizedPublicAccess({
    actorType: resolveActorType(session, resourceClientId),
    resourceKind,
    providedToken: token,
    access,
    now
  });

  if (!result.allowed) {
    throw new PublicDocumentAccessError("forbidden", "Public access denied.");
  }
}

function toIcalTimestamp(timestamp: string): string {
  return timestamp.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildBookingIcalFeed(booking: Booking, generatedAt: string): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BDTA//Booking Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${booking.id}@bdta.local`,
    `DTSTAMP:${toIcalTimestamp(generatedAt)}`,
    `DTSTART:${toIcalTimestamp(booking.startsAt)}`,
    `DTEND:${toIcalTimestamp(booking.endsAt)}`,
    `SUMMARY:BDTA Booking - ${booking.serviceId}`,
    "DESCRIPTION:Brook's Dog Training Academy booking",
    "END:VEVENT",
    "END:VCALENDAR",
    ""
  ].join("\r\n");
}

export async function getPublicQuoteDetail(
  input: { quoteId: string; token: string | null; session: unknown },
  dependencies: PublicDocumentAccessDependencies
) {
  const quote = await dependencies.findPublicQuoteById(input.quoteId);
  if (quote == null) {
    throw new PublicDocumentAccessError("not_found", "Quote not found.");
  }

  const session = optionalSessionSchema.parse(input.session ?? null);
  assertAllowed(session, "quote", quote.clientId, quote.publicAccess, input.token, dependencies.now());
  return quoteDetailSchema.parse({ item: quoteSchema.parse(quote) });
}

export async function getPublicContractDetail(
  input: { contractId: string; token: string | null; session: unknown },
  dependencies: PublicDocumentAccessDependencies
) {
  const contract = await dependencies.findPublicContractById(input.contractId);
  if (contract == null) {
    throw new PublicDocumentAccessError("not_found", "Contract not found.");
  }

  const session = optionalSessionSchema.parse(input.session ?? null);
  assertAllowed(session, "contract", contract.clientId, contract.publicAccess, input.token, dependencies.now());
  return contractDetailSchema.parse({ item: contractSchema.parse(contract) });
}

export async function getPublicFormSubmissionDetail(
  input: { submissionId: string; token: string | null; session: unknown },
  dependencies: PublicDocumentAccessDependencies
) {
  const submission = await dependencies.findPublicFormSubmissionById(input.submissionId);
  if (submission == null) {
    throw new PublicDocumentAccessError("not_found", "Form submission not found.");
  }

  const session = optionalSessionSchema.parse(input.session ?? null);
  assertAllowed(session, "form_submission", submission.clientId, submission.publicAccess, input.token, dependencies.now());
  return formSubmissionDetailSchema.parse({ item: formSubmissionSchema.parse(submission) });
}

export async function getPublicBookingIcalDetail(
  input: { bookingId: string; token: string | null; session: unknown },
  dependencies: PublicDocumentAccessDependencies
) {
  const booking = await dependencies.findPublicBookingIcalById(input.bookingId);
  if (booking == null) {
    throw new PublicDocumentAccessError("not_found", "Booking iCal not found.");
  }

  const session = optionalSessionSchema.parse(input.session ?? null);
  assertAllowed(session, "booking_ical", booking.clientId, booking.icalAccess, input.token, dependencies.now());
  return buildBookingIcalFeed(booking, dependencies.now());
}
