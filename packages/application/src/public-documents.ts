import { z } from "zod";

import {
  contractDetailSchema,
  formSubmissionDetailSchema,
  quoteDetailSchema
} from "@bdta/contracts";
import type { Booking, Contract, FormField, FormSubmission, Quote } from "@bdta/domain";
import {
  contractSchema,
  formSubmissionSchema,
  getFormFieldLabel,
  getFormFieldOptions,
  isDisplayOnlyFormFieldType,
  isFileUploadFormFieldType,
  isOptionListFormFieldType,
  isPetInfoFormFieldType,
  normalizeFormFieldType,
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

export type PublicFormClientProfilePatch = Partial<{
  name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}>;

export type PublicFormPetProfilePatch = Partial<{
  name: string;
  dateOfBirth: string;
  species: string;
  breed: string;
  weight: string;
  gender: string;
  spayNeuterStatus: string;
  vaccineStatus: string;
  source: string;
  acquiredAgo: string;
  age: string;
  behaviorNotes: string;
  trainingNotes: string;
  medicalNotes: string;
  petSittingNotes: string;
}>;

export type PublicFormUploadedFileValue = {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
};

type PublicFormPetInfoValue = {
  petId: string;
  name: string;
  dateOfBirth: string;
  species: string;
  breed: string;
  weight: string;
  gender: string;
  spayNeuterStatus: string;
  vaccineStatus: string;
  source: string;
  acquiredAgo: string;
};

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
  clientProfilePatch?: PublicFormClientProfilePatch;
  petProfile?: {
    petId: string | null;
    input: PublicFormPetProfilePatch;
  } | null;
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
  responses: z.record(z.string(), z.unknown()).default({})
});

type PublicFormField = {
  label: string;
  type: string;
  required: boolean;
  options: string[];
  profileMapping?: FormField["profileMapping"];
  newsletterCheckboxLabel: string;
};

function isUploadedFormFileValue(value: unknown): value is PublicFormUploadedFileValue {
  return typeof value === "object"
    && value != null
    && typeof (value as { originalName?: unknown }).originalName === "string"
    && typeof (value as { mimeType?: unknown }).mimeType === "string"
    && typeof (value as { sizeBytes?: unknown }).sizeBytes === "number"
    && typeof (value as { contentBase64?: unknown }).contentBase64 === "string";
}

function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function normalizePublicFormField(rawField: FormField, index: number): PublicFormField {
  return {
    label: getFormFieldLabel(rawField, index),
    type: normalizeFormFieldType(rawField.type),
    required: rawField.required === true,
    options: getFormFieldOptions(rawField),
    profileMapping: rawField.profileMapping,
    newsletterCheckboxLabel: "Yes, I'd like to receive newsletters and updates."
  };
}

function normalizePetInfoValue(value: unknown): PublicFormPetInfoValue {
  const source = typeof value === "object" && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const readValue = (key: keyof PublicFormPetInfoValue): string => {
    const raw = source[key];
    return typeof raw === "string" ? raw.trim() : "";
  };

  return {
    petId: readValue("petId"),
    name: readValue("name"),
    dateOfBirth: readValue("dateOfBirth"),
    species: readValue("species"),
    breed: readValue("breed"),
    weight: readValue("weight"),
    gender: readValue("gender"),
    spayNeuterStatus: readValue("spayNeuterStatus"),
    vaccineStatus: readValue("vaccineStatus"),
    source: readValue("source"),
    acquiredAgo: readValue("acquiredAgo")
  };
}

function isEmptyPetInfoValue(value: PublicFormPetInfoValue): boolean {
  return [
    value.petId,
    value.name,
    value.dateOfBirth,
    value.species,
    value.breed,
    value.weight,
    value.gender,
    value.spayNeuterStatus,
    value.vaccineStatus,
    value.source,
    value.acquiredAgo
  ].every((item) => item === "");
}

function getMissingPetInfoLabels(value: PublicFormPetInfoValue): string[] {
  const labels: Array<[keyof PublicFormPetInfoValue, string]> = [
    ["name", "Name"],
    ["dateOfBirth", "DOB"],
    ["species", "Species"],
    ["breed", "Breed"],
    ["weight", "Weight"],
    ["gender", "Gender"],
    ["spayNeuterStatus", "Neuter / Spay Status"],
    ["vaccineStatus", "Vaccine Status"],
    ["source", "Source"],
    ["acquiredAgo", "How Long Ago Acquired"]
  ];

  return labels
    .filter(([key]) => value[key] === "")
    .map(([, label]) => label);
}

function validatePublicFormResponses(
  templateFields: ReadonlyArray<FormField> | undefined,
  postedValues: Record<string, unknown>
): { responses: Array<unknown>; errors: string[] } {
  const responses: Array<unknown> = [];
  const errors: string[] = [];

  for (const [index, rawField] of (templateFields ?? []).entries()) {
    const field = normalizePublicFormField(rawField, index);
    if (isDisplayOnlyFormFieldType(field.type)) {
      continue;
    }

    const rawValue = postedValues[String(index)];
    if (field.type === "checkbox") {
      const normalized = Array.isArray(rawValue)
        ? rawValue.map((item) => String(item).trim()).filter((item) => item !== "")
        : typeof rawValue === "string" && rawValue.trim() !== ""
          ? [rawValue.trim()]
          : [];
      const filtered = field.options.length === 0
        ? normalized
        : normalized.filter((item) => field.options.includes(item));
      if (field.required && filtered.length === 0) {
        errors.push(`${field.label} is required.`);
      }
      responses[index] = filtered;
      continue;
    }

    if (field.type === "newsletter_opt_in") {
      const normalized = Array.isArray(rawValue)
        ? rawValue.find((item) => String(item).trim() !== "")?.toString().trim() ?? ""
        : typeof rawValue === "string" && rawValue.trim() !== ""
          ? field.newsletterCheckboxLabel
          : "";
      responses[index] = normalized === "" ? "" : field.newsletterCheckboxLabel;
      continue;
    }

    if (isPetInfoFormFieldType(field.type)) {
      const normalized = normalizePetInfoValue(rawValue);
      if (field.required && isEmptyPetInfoValue(normalized)) {
        errors.push(`${field.label} is required.`);
      } else if (field.required && !isEmptyPetInfoValue(normalized)) {
        const missingLabels = getMissingPetInfoLabels(normalized);
        if (missingLabels.length > 0) {
          errors.push(`${field.label} is missing: ${missingLabels.join(", ")}.`);
        }
      }
      responses[index] = normalized;
      continue;
    }

    if (isFileUploadFormFieldType(field.type)) {
      if (field.required && !isUploadedFormFileValue(rawValue)) {
        errors.push(`${field.label} is required.`);
      }
      responses[index] = isUploadedFormFileValue(rawValue) ? rawValue : null;
      continue;
    }

    const normalized = typeof rawValue === "string" ? rawValue.trim() : "";
    if (field.required && normalized === "") {
      errors.push(`${field.label} is required.`);
    } else if (field.type === "email" && normalized !== "" && !isEmailAddress(normalized)) {
      errors.push(`${field.label} must be a valid email address.`);
    } else if (field.type === "date" && normalized !== "" && !isIsoDate(normalized)) {
      errors.push(`${field.label} must be a valid date.`);
    } else if (
      isOptionListFormFieldType(field.type)
      && normalized !== ""
      && field.options.length > 0
      && !field.options.includes(normalized)
    ) {
      errors.push(`${field.label} contains an invalid option.`);
    }
    responses[index] = normalized;
  }

  return { responses, errors };
}

function normalizeProfileMappingValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter((item) => item !== "").join(", ");
  }

  if (isUploadedFormFileValue(value)) {
    return value.originalName.trim();
  }

  return "";
}

function resolvePublicFormProfileUpdates(input: {
  submission: FormSubmission;
  responses: ReadonlyArray<unknown>;
}): {
  clientProfilePatch: PublicFormClientProfilePatch;
  petProfile: {
    petId: string | null;
    input: PublicFormPetProfilePatch;
  } | null;
} {
  const clientProfilePatch: PublicFormClientProfilePatch = {};
  const petProfilePatch: PublicFormPetProfilePatch = {};
  let resolvedPetId = input.submission.petId ?? null;
  let hasPetProfileSelection = false;
  let hasPetProfileValues = false;

  for (const [index, rawField] of (input.submission.templateFields ?? []).entries()) {
    const response = input.responses[index];
    const fieldType = normalizeFormFieldType(rawField.type);

    if (isPetInfoFormFieldType(fieldType)) {
      const petInfo = normalizePetInfoValue(response);
      if (!isEmptyPetInfoValue(petInfo)) {
        if (petInfo.petId !== "") {
          resolvedPetId = petInfo.petId;
          hasPetProfileSelection = true;
        }

        const petInfoPatch: PublicFormPetProfilePatch = {
          name: petInfo.name,
          dateOfBirth: petInfo.dateOfBirth,
          species: petInfo.species,
          breed: petInfo.breed,
          weight: petInfo.weight,
          gender: petInfo.gender,
          spayNeuterStatus: petInfo.spayNeuterStatus,
          vaccineStatus: petInfo.vaccineStatus,
          source: petInfo.source,
          acquiredAgo: petInfo.acquiredAgo
        };

        for (const [key, value] of Object.entries(petInfoPatch)) {
          if ((value ?? "").trim() !== "") {
            petProfilePatch[key as keyof PublicFormPetProfilePatch] = value;
            hasPetProfileValues = true;
          }
        }
      }
    }

    const mapping = rawField.profileMapping;
    if (mapping == null) {
      continue;
    }

    const normalizedValue = normalizeProfileMappingValue(response);
    if (normalizedValue === "") {
      continue;
    }

    if (mapping.target === "client") {
      clientProfilePatch[mapping.field] = normalizedValue;
      continue;
    }

    petProfilePatch[mapping.field] = normalizedValue;
    hasPetProfileValues = true;
  }

  if (!hasPetProfileSelection && !hasPetProfileValues) {
    return { clientProfilePatch, petProfile: null };
  }

  return {
    clientProfilePatch,
    petProfile: {
      petId: resolvedPetId,
      input: petProfilePatch
    }
  };
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
    responses: Record<string, unknown>;
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

  const profileUpdates = resolvePublicFormProfileUpdates({
    submission,
    responses: validation.responses
  });

  const updatedSubmission = await dependencies.submitPublicForm({
    submissionId: submission.id,
    contactName: request.contactName,
    contactEmail: request.contactEmail,
    contactPhone: request.contactPhone,
    responses: validation.responses,
    clientProfilePatch: profileUpdates.clientProfilePatch,
    petProfile: profileUpdates.petProfile
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
