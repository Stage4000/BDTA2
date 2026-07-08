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
import { normalizeFormSubmissionPortalMetadata } from "./form-portal-visibility.js";
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
  findPublicQuoteByToken(token: string): Promise<Quote | null>;
  respondPublicQuote(quoteId: string, action: "accept" | "decline"): Promise<Quote | null>;
  findPublicContractById(contractId: string): Promise<Contract | null>;
  findPublicContractByToken(token: string): Promise<Contract | null>;
  signPublicContract(input: {
    contractId: string;
    typedName: string;
    signatureFont: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<Contract | null>;
  findPublicFormSubmissionById(submissionId: string): Promise<FormSubmission | null>;
  findPublicFormSubmissionByToken(token: string): Promise<FormSubmission | null>;
  submitPublicForm(input: {
    submissionId: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
    responses: Array<unknown>;
  }): Promise<FormSubmission | null>;
  findPublicBookingIcalById(bookingId: string): Promise<Booking | null>;
  findPublicBookingIcalByToken(token: string): Promise<Booking | null>;
  verifyCaptcha(turnstileToken: string): Promise<boolean>;
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

export class PublicDocumentMutationError extends Error {
  constructor(
    public readonly code: "invalid_captcha" | "invalid_request" | "invalid_state" | "not_found",
    message: string
  ) {
    super(message);
    this.name = "PublicDocumentMutationError";
  }
}

const publicQuoteActionSchema = z.enum(["accept", "decline"]);

const publicContractSignatureSchema = z.object({
  typedName: z.string().trim().min(1),
  signatureFont: z.enum(["font-dancing", "font-pacifico", "font-satisfy", "font-great-vibes", "font-allura"]),
  ipAddress: z.string().trim().min(1).nullable(),
  userAgent: z.string().trim().min(1).nullable()
});

const publicFormSubmissionRequestSchema = z.object({
  contactName: z.string().trim().min(1),
  contactEmail: z.string().trim().email(),
  contactPhone: z.string().optional().default("").transform((value) => value.trim()),
  responses: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({})
});

type PublicFormField = {
  label: string;
  type: string;
  required: boolean;
  newsletterCheckboxLabel: string;
};

function isDisplayOnlyFormField(type: string): boolean {
  return ["text_block", "heading", "paragraph", "html", "divider"].includes(type);
}

function normalizePublicFormField(rawField: Record<string, unknown>, index: number): PublicFormField {
  const rawType = typeof rawField.type === "string" ? rawField.type.trim().toLowerCase() : "";
  const label = typeof rawField.label === "string" && rawField.label.trim() !== ""
    ? rawField.label.trim()
    : rawType === "newsletter_opt_in"
      ? "Newsletter Opt-In"
      : `Field ${index + 1}`;

  return {
    label,
    type: rawType === "" ? "text" : rawType,
    required: rawField.required === true,
    newsletterCheckboxLabel: "Yes, I'd like to receive newsletters and updates."
  };
}

function validatePublicFormResponses(
  templateFields: ReadonlyArray<Record<string, unknown>> | undefined,
  postedValues: Record<string, string | string[]>
): { responses: Array<unknown>; errors: string[] } {
  const responses: Array<unknown> = [];
  const errors: string[] = [];

  for (const [index, rawField] of (templateFields ?? []).entries()) {
    const field = normalizePublicFormField(rawField, index);
    if (isDisplayOnlyFormField(field.type)) {
      continue;
    }

    const rawValue = postedValues[String(index)];
    if (field.type === "checkbox") {
      const normalized = Array.isArray(rawValue)
        ? rawValue.map((item) => item.trim()).filter((item) => item !== "")
        : typeof rawValue === "string" && rawValue.trim() !== ""
          ? [rawValue.trim()]
          : [];
      if (field.required && normalized.length === 0) {
        errors.push(`${field.label} is required.`);
      }
      responses[index] = normalized;
      continue;
    }

    if (field.type === "newsletter_opt_in") {
      const normalized = Array.isArray(rawValue)
        ? rawValue.find((item) => item.trim() !== "")?.trim() ?? ""
        : typeof rawValue === "string" && rawValue.trim() !== ""
          ? field.newsletterCheckboxLabel
          : "";
      responses[index] = normalized === "" ? "" : field.newsletterCheckboxLabel;
      continue;
    }

    const normalized = typeof rawValue === "string" ? rawValue.trim() : "";
    if (field.required && normalized === "") {
      errors.push(`${field.label} is required.`);
    }
    responses[index] = normalized;
  }

  return { responses, errors };
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

function normalizeLookupValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

async function resolvePublicQuote(
  input: { quoteId: string | null; token: string | null },
  dependencies: PublicDocumentAccessDependencies
): Promise<Quote | null> {
  const quoteId = normalizeLookupValue(input.quoteId);
  if (quoteId != null) {
    return dependencies.findPublicQuoteById(quoteId);
  }

  const token = normalizeLookupValue(input.token);
  return token == null ? null : dependencies.findPublicQuoteByToken(token);
}

async function resolvePublicContract(
  input: { contractId: string | null; token: string | null },
  dependencies: PublicDocumentAccessDependencies
): Promise<Contract | null> {
  const contractId = normalizeLookupValue(input.contractId);
  if (contractId != null) {
    return dependencies.findPublicContractById(contractId);
  }

  const token = normalizeLookupValue(input.token);
  return token == null ? null : dependencies.findPublicContractByToken(token);
}

async function resolvePublicFormSubmission(
  input: { submissionId: string | null; token: string | null },
  dependencies: PublicDocumentAccessDependencies
): Promise<FormSubmission | null> {
  const submissionId = normalizeLookupValue(input.submissionId);
  if (submissionId != null) {
    return dependencies.findPublicFormSubmissionById(submissionId);
  }

  const token = normalizeLookupValue(input.token);
  return token == null ? null : dependencies.findPublicFormSubmissionByToken(token);
}

async function resolvePublicBookingIcal(
  input: { bookingId: string | null; token: string | null },
  dependencies: PublicDocumentAccessDependencies
): Promise<Booking | null> {
  const bookingId = normalizeLookupValue(input.bookingId);
  if (bookingId != null) {
    return dependencies.findPublicBookingIcalById(bookingId);
  }

  const token = normalizeLookupValue(input.token);
  return token == null ? null : dependencies.findPublicBookingIcalByToken(token);
}

async function assertCaptcha(
  turnstileToken: string | null | undefined,
  dependencies: Pick<PublicDocumentAccessDependencies, "verifyCaptcha">
): Promise<void> {
  const normalizedToken = normalizeLookupValue(turnstileToken);
  if (normalizedToken == null) {
    throw new PublicDocumentMutationError("invalid_request", "Captcha verification is required.");
  }

  const captchaValid = await dependencies.verifyCaptcha(normalizedToken);
  if (!captchaValid) {
    throw new PublicDocumentMutationError("invalid_captcha", "Captcha verification failed.");
  }
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
  input: { quoteId: string | null; token: string | null; session: unknown },
  dependencies: PublicDocumentAccessDependencies
) {
  const quote = await resolvePublicQuote(input, dependencies);
  if (quote == null) {
    throw new PublicDocumentAccessError("not_found", "Quote not found.");
  }

  const token = normalizeLookupValue(input.token);
  const session = optionalSessionSchema.parse(input.session ?? null);
  assertAllowed(session, "quote", quote.clientId, quote.publicAccess, token, dependencies.now());
  return quoteDetailSchema.parse({ item: quoteSchema.parse(quote) });
}

export async function getPublicContractDetail(
  input: { contractId: string | null; token: string | null; session: unknown },
  dependencies: PublicDocumentAccessDependencies
) {
  const contract = await resolvePublicContract(input, dependencies);
  if (contract == null) {
    throw new PublicDocumentAccessError("not_found", "Contract not found.");
  }

  const token = normalizeLookupValue(input.token);
  const session = optionalSessionSchema.parse(input.session ?? null);
  assertAllowed(session, "contract", contract.clientId, contract.publicAccess, token, dependencies.now());
  return contractDetailSchema.parse({ item: contractSchema.parse(contract) });
}

export async function getPublicFormSubmissionDetail(
  input: { submissionId: string | null; token: string | null; session: unknown },
  dependencies: PublicDocumentAccessDependencies
) {
  const submission = await resolvePublicFormSubmission(input, dependencies);
  if (submission == null) {
    throw new PublicDocumentAccessError("not_found", "Form submission not found.");
  }

  const token = normalizeLookupValue(input.token);
  const session = optionalSessionSchema.parse(input.session ?? null);
  assertAllowed(session, "form_submission", submission.clientId, submission.publicAccess, token, dependencies.now());
  return formSubmissionDetailSchema.parse({ item: normalizeFormSubmissionPortalMetadata(formSubmissionSchema.parse(submission)) });
}

export async function getPublicBookingIcalDetail(
  input: { bookingId: string | null; token: string | null; session: unknown },
  dependencies: PublicDocumentAccessDependencies
) {
  const booking = await resolvePublicBookingIcal(input, dependencies);
  if (booking == null) {
    throw new PublicDocumentAccessError("not_found", "Booking iCal not found.");
  }

  const token = normalizeLookupValue(input.token);
  const session = optionalSessionSchema.parse(input.session ?? null);
  assertAllowed(session, "booking_ical", booking.clientId, booking.icalAccess, token, dependencies.now());
  return buildBookingIcalFeed(booking, dependencies.now());
}

export async function respondPublicQuote(
  input: {
    quoteId: string | null;
    token: string | null;
    session: unknown;
    action: "accept" | "decline";
    turnstileToken: string | null;
  },
  dependencies: PublicDocumentAccessDependencies
) {
  const quote = await resolvePublicQuote(input, dependencies);
  if (quote == null) {
    throw new PublicDocumentMutationError("not_found", "Quote not found.");
  }

  const token = normalizeLookupValue(input.token);
  const session = optionalSessionSchema.parse(input.session ?? null);
  assertAllowed(session, "quote", quote.clientId, quote.publicAccess, token, dependencies.now());
  await assertCaptcha(input.turnstileToken, dependencies);

  if (quote.status !== "draft" && quote.status !== "sent") {
    throw new PublicDocumentMutationError("invalid_state", "Quote could not be updated.");
  }

  const action = publicQuoteActionSchema.parse(input.action);
  const updatedQuote = await dependencies.respondPublicQuote(quote.id, action);
  if (updatedQuote == null) {
    throw new PublicDocumentMutationError("not_found", "Quote not found.");
  }

  const expectedStatus = action === "accept" ? "accepted" : "declined";
  if (updatedQuote.status !== expectedStatus) {
    throw new PublicDocumentMutationError("invalid_state", "Quote could not be updated.");
  }

  return quoteDetailSchema.parse({
    item: quoteSchema.parse(updatedQuote)
  });
}

export async function signPublicContract(
  input: {
    contractId: string | null;
    token: string | null;
    session: unknown;
    typedName: string | null;
    signatureFont: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    turnstileToken: string | null;
  },
  dependencies: PublicDocumentAccessDependencies
) {
  const contract = await resolvePublicContract(input, dependencies);
  if (contract == null) {
    throw new PublicDocumentMutationError("not_found", "Contract not found.");
  }

  const token = normalizeLookupValue(input.token);
  const session = optionalSessionSchema.parse(input.session ?? null);
  assertAllowed(session, "contract", contract.clientId, contract.publicAccess, token, dependencies.now());
  await assertCaptcha(input.turnstileToken, dependencies);

  if (contract.status !== "sent") {
    throw new PublicDocumentMutationError("invalid_state", "Contract could not be signed.");
  }

  const signature = publicContractSignatureSchema.parse({
    typedName: input.typedName,
    signatureFont: input.signatureFont ?? "font-dancing",
    ipAddress: normalizeLookupValue(input.ipAddress),
    userAgent: normalizeLookupValue(input.userAgent)
  });

  const signedContract = await dependencies.signPublicContract({
    contractId: contract.id,
    ...signature
  });
  if (signedContract == null) {
    throw new PublicDocumentMutationError("not_found", "Contract not found.");
  }

  if (signedContract.status !== "signed") {
    throw new PublicDocumentMutationError("invalid_state", "Contract could not be signed.");
  }

  return contractDetailSchema.parse({
    item: contractSchema.parse(signedContract)
  });
}

export async function submitPublicForm(
  input: {
    submissionId: string | null;
    token: string | null;
    session: unknown;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    responses: Record<string, string | string[]>;
    turnstileToken: string | null;
  },
  dependencies: PublicDocumentAccessDependencies
) {
  const submission = await resolvePublicFormSubmission(input, dependencies);
  if (submission == null) {
    throw new PublicDocumentMutationError("not_found", "Form submission not found.");
  }

  const token = normalizeLookupValue(input.token);
  const session = optionalSessionSchema.parse(input.session ?? null);
  assertAllowed(session, "form_submission", submission.clientId, submission.publicAccess, token, dependencies.now());
  await assertCaptcha(input.turnstileToken, dependencies);

  if (submission.submittedAt != null) {
    throw new PublicDocumentMutationError("invalid_state", "Form has already been submitted.");
  }

  const request = publicFormSubmissionRequestSchema.parse({
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    responses: input.responses
  });
  const validation = validatePublicFormResponses(submission.templateFields, request.responses);
  if (validation.errors.length > 0) {
    throw new PublicDocumentMutationError("invalid_request", validation.errors.join(" "));
  }

  const updatedSubmission = await dependencies.submitPublicForm({
    submissionId: submission.id,
    contactName: request.contactName,
    contactEmail: request.contactEmail,
    contactPhone: request.contactPhone,
    responses: validation.responses
  });
  if (updatedSubmission == null) {
    throw new PublicDocumentMutationError("not_found", "Form submission not found.");
  }

  if (updatedSubmission.submittedAt == null) {
    throw new PublicDocumentMutationError("invalid_state", "Form could not be submitted.");
  }

  return formSubmissionDetailSchema.parse({
    item: normalizeFormSubmissionPortalMetadata(formSubmissionSchema.parse(updatedSubmission))
  });
}
