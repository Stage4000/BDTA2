import { z } from "zod";

import {
  contractDetailSchema,
  formSubmissionDetailSchema,
  invoicePaymentSessionRequestSchema,
  invoicePaymentSessionResponseSchema,
  quoteDetailSchema
} from "@bdta/contracts";
import type { Contract, FormSubmission, Invoice, Quote } from "@bdta/domain";
import { contractSchema, formSubmissionSchema, invoiceSchema, quoteSchema } from "@bdta/domain";
import { normalizeFormSubmissionPortalMetadata } from "./form-portal-visibility.js";
import { SessionActorError, type SessionSnapshot } from "./session-actors.js";

export class CommerceActionError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_state",
    message: string
  ) {
    super(message);
    this.name = "CommerceActionError";
  }
}

export type PortalCommerceDependencies = {
  acceptPortalQuote(clientId: string, quoteId: string): Promise<Quote | null>;
  signPortalContract(clientId: string, contractId: string): Promise<Contract | null>;
  submitPortalForm(clientId: string, formId: string): Promise<FormSubmission | null>;
  createInvoicePaymentSession(
    clientId: string,
    invoiceId: string,
    input: z.infer<typeof invoicePaymentSessionRequestSchema>
  ): Promise<{
    invoice: Invoice;
    paymentSession: {
      provider: "stripe";
      checkoutUrl: string;
      expiresAt: string | null;
    };
  } | null>;
};

function requirePortalSession(session: SessionSnapshot): string {
  if (session.actorType !== "portal_user") {
    throw new SessionActorError("unauthorized", "Portal session required.");
  }

  return session.actorId;
}

export async function acceptPortalQuote(
  session: SessionSnapshot,
  quoteId: string,
  dependencies: PortalCommerceDependencies
) {
  const clientId = requirePortalSession(session);
  const quote = await dependencies.acceptPortalQuote(clientId, quoteId);
  if (quote == null) {
    throw new CommerceActionError("not_found", "Portal quote not found.");
  }

  if (quote.status !== "accepted") {
    throw new CommerceActionError("invalid_state", "Quote could not be accepted.");
  }

  return quoteDetailSchema.parse({
    item: quoteSchema.parse(quote)
  });
}

export async function signPortalContract(
  session: SessionSnapshot,
  contractId: string,
  dependencies: PortalCommerceDependencies
) {
  const clientId = requirePortalSession(session);
  const contract = await dependencies.signPortalContract(clientId, contractId);
  if (contract == null) {
    throw new CommerceActionError("not_found", "Portal contract not found.");
  }

  if (contract.status !== "signed") {
    throw new CommerceActionError("invalid_state", "Contract could not be signed.");
  }

  return contractDetailSchema.parse({
    item: contractSchema.parse(contract)
  });
}

export async function submitPortalForm(
  session: SessionSnapshot,
  formId: string,
  dependencies: PortalCommerceDependencies
) {
  const clientId = requirePortalSession(session);
  const submission = await dependencies.submitPortalForm(clientId, formId);
  if (submission == null) {
    throw new CommerceActionError("not_found", "Portal form not found.");
  }

  if (submission.submittedAt == null) {
    throw new CommerceActionError("invalid_state", "Form could not be submitted.");
  }

  return formSubmissionDetailSchema.parse({
    item: normalizeFormSubmissionPortalMetadata(formSubmissionSchema.parse(submission))
  });
}

export async function createPortalInvoicePaymentSession(
  session: SessionSnapshot,
  invoiceId: string,
  input: unknown,
  dependencies: PortalCommerceDependencies
) {
  const clientId = requirePortalSession(session);
  const parsedInput = invoicePaymentSessionRequestSchema.parse(input);
  const result = await dependencies.createInvoicePaymentSession(clientId, invoiceId, parsedInput);
  if (result == null) {
    throw new CommerceActionError("not_found", "Portal invoice not found.");
  }

  if (result.invoice.outstandingAmount <= 0 || result.invoice.status === "paid" || result.invoice.status === "void") {
    throw new CommerceActionError("invalid_state", "Invoice is not payable.");
  }

  return invoicePaymentSessionResponseSchema.parse({
    invoice: invoiceSchema.parse(result.invoice),
    paymentSession: result.paymentSession
  });
}
