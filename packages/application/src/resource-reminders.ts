import { z } from "zod";

import type {
  Booking,
  Contract,
  FormSubmission,
  OutboundEmailMessage,
  Quote
} from "@bdta/domain";
import type { JobEnvelope } from "@bdta/contracts";

const bookingReminderPayloadSchema = z.object({
  bookingId: z.string().min(1)
});

const quoteReminderPayloadSchema = z.object({
  quoteId: z.string().min(1)
});

const contractReminderPayloadSchema = z.object({
  contractId: z.string().min(1)
});

const formReminderPayloadSchema = z.object({
  formId: z.string().min(1)
});

type EmailQueueDependencies = {
  queueReminderEmail(message: OutboundEmailMessage): Promise<void>;
};

export type BookingReminderTarget = {
  booking: Booking;
  recipientEmail: string;
};

export type QuoteReminderTarget = {
  quote: Quote;
  recipientEmail: string;
};

export type ContractReminderTarget = {
  contract: Contract;
  recipientEmail: string;
};

export type FormReminderTarget = {
  submission: FormSubmission;
  recipientEmail: string;
};

export type BookingReminderDependencies = EmailQueueDependencies & {
  findBookingReminderTarget(bookingId: string): Promise<BookingReminderTarget | null>;
  buildPortalBookingUrl(bookingId: string): string;
};

export type QuoteReminderDependencies = EmailQueueDependencies & {
  findQuoteReminderTarget(quoteId: string): Promise<QuoteReminderTarget | null>;
  buildQuoteAccessUrl(quoteId: string, token: string | null): string;
};

export type ContractReminderDependencies = EmailQueueDependencies & {
  findContractReminderTarget(contractId: string): Promise<ContractReminderTarget | null>;
  buildContractAccessUrl(contractId: string, token: string | null): string;
};

export type FormReminderDependencies = EmailQueueDependencies & {
  findFormReminderTarget(formId: string): Promise<FormReminderTarget | null>;
  buildFormAccessUrl(formId: string, token: string | null): string;
};

function toDateLabel(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function toTimeLabel(timestamp: string): string {
  return timestamp.slice(11, 16);
}

function assertBookingEligible(booking: Booking): void {
  if (booking.status !== "pending" && booking.status !== "confirmed") {
    throw new Error(`Booking ${booking.id} is not eligible for reminder delivery.`);
  }
}

function assertQuoteEligible(quote: Quote): void {
  if (quote.status !== "draft" && quote.status !== "sent") {
    throw new Error(`Quote ${quote.id} is not eligible for reminder delivery.`);
  }
}

function assertContractEligible(contract: Contract): void {
  if (contract.status !== "sent") {
    throw new Error(`Contract ${contract.id} is not eligible for reminder delivery.`);
  }
}

function assertFormEligible(submission: FormSubmission): void {
  if (submission.submittedAt != null) {
    throw new Error(`Form ${submission.id} has already been submitted.`);
  }
}

export async function processBookingReminderJob(
  job: JobEnvelope,
  dependencies: BookingReminderDependencies
): Promise<string> {
  const payload = bookingReminderPayloadSchema.parse(job.payload);
  const target = await dependencies.findBookingReminderTarget(payload.bookingId);

  if (target == null) {
    throw new Error(`Booking ${payload.bookingId} not found for reminder processing.`);
  }

  assertBookingEligible(target.booking);
  const bookingUrl = dependencies.buildPortalBookingUrl(target.booking.id);

  await dependencies.queueReminderEmail({
    to: [target.recipientEmail],
    subject: "Booking reminder",
    html: [
      `<p>This is a reminder for booking ${target.booking.id}.</p>`,
      `<p>Service: ${target.booking.serviceId}</p>`,
      `<p>Appointment date: ${toDateLabel(target.booking.startsAt)}</p>`,
      `<p>Appointment time: ${toTimeLabel(target.booking.startsAt)}</p>`,
      `<p><a href="${bookingUrl}">View booking</a></p>`
    ].join(""),
    templateKey: "booking_reminder"
  });

  return `Queued booking reminder for ${payload.bookingId}.`;
}

export async function processQuoteReminderJob(
  job: JobEnvelope,
  dependencies: QuoteReminderDependencies
): Promise<string> {
  const payload = quoteReminderPayloadSchema.parse(job.payload);
  const target = await dependencies.findQuoteReminderTarget(payload.quoteId);

  if (target == null) {
    throw new Error(`Quote ${payload.quoteId} not found for reminder processing.`);
  }

  assertQuoteEligible(target.quote);
  const quoteUrl = dependencies.buildQuoteAccessUrl(target.quote.id, target.quote.publicAccess?.token ?? null);

  await dependencies.queueReminderEmail({
    to: [target.recipientEmail],
    subject: "Quote reminder",
    html: [
      `<p>This is a reminder for quote ${target.quote.id}.</p>`,
      `<p>Total amount: ${target.quote.totalAmount}</p>`,
      `<p><a href="${quoteUrl}">Review quote</a></p>`
    ].join(""),
    templateKey: "quote_reminder"
  });

  return `Queued quote reminder for ${payload.quoteId}.`;
}

export async function processContractReminderJob(
  job: JobEnvelope,
  dependencies: ContractReminderDependencies
): Promise<string> {
  const payload = contractReminderPayloadSchema.parse(job.payload);
  const target = await dependencies.findContractReminderTarget(payload.contractId);

  if (target == null) {
    throw new Error(`Contract ${payload.contractId} not found for reminder processing.`);
  }

  assertContractEligible(target.contract);
  const contractUrl = dependencies.buildContractAccessUrl(target.contract.id, target.contract.publicAccess?.token ?? null);

  await dependencies.queueReminderEmail({
    to: [target.recipientEmail],
    subject: "Contract reminder",
    html: [
      `<p>This is a reminder for contract ${target.contract.id}.</p>`,
      `<p><a href="${contractUrl}">Review contract</a></p>`
    ].join(""),
    templateKey: "contract_reminder"
  });

  return `Queued contract reminder for ${payload.contractId}.`;
}

export async function processFormReminderJob(
  job: JobEnvelope,
  dependencies: FormReminderDependencies
): Promise<string> {
  const payload = formReminderPayloadSchema.parse(job.payload);
  const target = await dependencies.findFormReminderTarget(payload.formId);

  if (target == null) {
    throw new Error(`Form ${payload.formId} not found for reminder processing.`);
  }

  assertFormEligible(target.submission);
  const formUrl = dependencies.buildFormAccessUrl(target.submission.id, target.submission.publicAccess?.token ?? null);

  await dependencies.queueReminderEmail({
    to: [target.recipientEmail],
    subject: "Form reminder",
    html: [
      `<p>This is a reminder for form ${target.submission.id}.</p>`,
      `<p><a href="${formUrl}">Complete form</a></p>`
    ].join(""),
    templateKey: "form_reminder"
  });

  return `Queued form reminder for ${payload.formId}.`;
}
