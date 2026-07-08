import { z } from "zod";

import { formTemplateSchema, type FormTemplate, type Package } from "@bdta/domain";

export class PublicPackagePurchaseError extends Error {
  constructor(
    public readonly code: "invalid_input" | "not_found" | "unavailable",
    message: string
  ) {
    super(message);
    this.name = "PublicPackagePurchaseError";
  }
}

const publicPackagePurchaseRequestSchema = z.object({
  token: z.string().trim().min(1),
  buyerName: z.string().trim().min(1),
  buyerEmail: z.string().trim().email(),
  buyerPhone: z.string().optional().default("").transform((value) => value.trim()),
  notes: z.string().optional().default("").transform((value) => value.trim()),
  formResponses: z.record(
    z.string(),
    z.record(z.string(), z.union([z.string(), z.array(z.string())]))
  ).optional().default({})
});

const publicPackageCheckoutStartRequestSchema = publicPackagePurchaseRequestSchema.extend({
  successUrl: z.string().trim().url(),
  cancelUrl: z.string().trim().url()
});

const publicPackageCheckoutResumeRequestSchema = z.object({
  token: z.string().trim().min(1),
  sessionId: z.string().trim().min(1)
});

export type PendingPublicPackagePurchase = {
  packageId: string;
  packageToken: string;
  stripeCheckoutSessionId: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  notes: string;
  formSubmission?: {
    templateId: string;
    responses: Array<string | string[]>;
  };
};

export type PublicPackagePaymentSession = {
  sessionId: string;
  checkoutUrl: string;
};

export type PublicPackagePaymentSessionState = {
  sessionId: string;
  paymentStatus: string;
  amountTotal: number;
  packageId: string | null;
  packageToken: string | null;
  paymentIntentId: string | null;
};

export type PublicPackagePurchaseDependencies = {
  now?(): string;
  findPublicPackageByToken(token: string): Promise<Package | null>;
  findPublicCheckoutForm(formTemplateId: string): Promise<FormTemplate | null>;
  findClientIdByEmail(email: string): Promise<string | null>;
  hasSubmittedCheckoutForm(input: {
    clientId: string;
    templateId: string;
    appointmentTypeId: string | null;
    submittedAfter: string | null;
  }): Promise<boolean>;
  finalizePublicPackagePurchase(input: {
    packageItem: Package;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
    notes: string;
    paymentMethod?: "offline" | "credit_card";
    stripeCheckoutSessionId?: string | null;
    stripePaymentIntentId?: string | null;
    formSubmission?: {
      templateId: string;
      responses: Array<string | string[]>;
    };
  }): Promise<{
    clientId: string;
    clientPackageId: string;
  }>;
  createPublicPackagePaymentSession?(input: {
    packageItem: Package;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
    notes: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<PublicPackagePaymentSession>;
  storePendingPublicPackagePurchase?(input: PendingPublicPackagePurchase): Promise<void>;
  findPendingPublicPackagePurchase?(packageId: string, stripeCheckoutSessionId: string): Promise<PendingPublicPackagePurchase | null>;
  deletePendingPublicPackagePurchase?(packageId: string, stripeCheckoutSessionId: string): Promise<void>;
  findExistingPublicPackagePurchase?(packageId: string, stripeCheckoutSessionId: string): Promise<{
    clientId: string;
    clientPackageId: string;
  } | null>;
  fetchPublicPackagePaymentSession?(stripeCheckoutSessionId: string): Promise<PublicPackagePaymentSessionState | null>;
};

type PackageCheckoutField = {
  label: string;
  type: string;
  required: boolean;
};

export type PublicPackageCheckoutForm = FormTemplate & {
  fields: Array<Record<string, unknown>>;
};

type ResolvedPublicPackagePurchaseRequest = z.infer<typeof publicPackagePurchaseRequestSchema> & {
  packageItem: Package;
  attachedForm: PublicPackageCheckoutForm | null;
  formSubmission?: {
    templateId: string;
    responses: Array<string | string[]>;
  };
};

function isPublicPackageCheckoutFormEligible(form: FormTemplate | null): form is PublicPackageCheckoutForm {
  if (form == null || !form.active) {
    return false;
  }

  if (form.templateIsInternal === true) {
    return false;
  }

  if (form.formType === "follow_up_note") {
    return false;
  }

  return Array.isArray(form.fields);
}

function normalizePackageCheckoutField(field: Record<string, unknown>, index: number): PackageCheckoutField {
  const rawLabel = typeof field.label === "string" ? field.label.trim() : "";
  const rawType = typeof field.type === "string" ? field.type.trim().toLowerCase() : "";

  return {
    label: rawLabel === "" ? `Field ${index + 1}` : rawLabel,
    type: rawType === "" ? "text" : rawType,
    required: field.required === true
  };
}

function isDisplayOnlyPackageCheckoutField(type: string): boolean {
  return ["text_block", "heading", "paragraph", "html", "divider"].includes(type);
}

function validatePublicPackageFormSubmission(
  form: PublicPackageCheckoutForm,
  postedValues: Record<string, string | string[]>
): { responses: Array<string | string[]>; errors: string[] } {
  const responses: Array<string | string[]> = [];
  const errors: string[] = [];

  for (const [index, rawField] of form.fields.entries()) {
    const field = normalizePackageCheckoutField(rawField, index);
    if (isDisplayOnlyPackageCheckoutField(field.type)) {
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

    const normalized = typeof rawValue === "string" ? rawValue.trim() : "";
    if (field.required && normalized === "") {
      errors.push(`${field.label} is required.`);
    }
    responses[index] = normalized;
  }

  return { responses, errors };
}

function normalizeRequiredFrequency(value: string | null | undefined): "" | "once" | "yearly" | "semi_annual" | "monthly" | "per_appointment" | "per_booking" | "once_per_pet" {
  const normalized = (value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "annual":
      return "yearly";
    case "once":
    case "yearly":
    case "semi_annual":
    case "monthly":
    case "per_appointment":
    case "per_booking":
    case "once_per_pet":
      return normalized;
    default:
      return "";
  }
}

function buildSubmittedAfterIso(nowValue: string, months: number): string {
  const cutoff = new Date(nowValue);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff.toISOString();
}

async function packageCheckoutFormIsDue(
  form: PublicPackageCheckoutForm,
  buyerEmail: string,
  dependencies: Pick<PublicPackagePurchaseDependencies, "findClientIdByEmail" | "hasSubmittedCheckoutForm" | "now">
): Promise<boolean> {
  const normalizedEmail = buyerEmail.trim().toLowerCase();
  if (normalizedEmail === "") {
    return true;
  }

  const clientId = await dependencies.findClientIdByEmail(normalizedEmail);
  if (clientId == null) {
    return true;
  }

  const frequency = normalizeRequiredFrequency(form.requiredFrequency);
  if (frequency === "" || frequency === "per_booking" || frequency === "once_per_pet") {
    return true;
  }

  let appointmentTypeId: string | null = null;
  let submittedAfter: string | null = null;
  const nowValue = dependencies.now?.() ?? new Date().toISOString();

  switch (frequency) {
    case "per_appointment":
      appointmentTypeId = form.appointmentTypeId ?? null;
      break;
    case "once":
      break;
    case "yearly":
      submittedAfter = buildSubmittedAfterIso(nowValue, 12);
      break;
    case "semi_annual":
      submittedAfter = buildSubmittedAfterIso(nowValue, 6);
      break;
    case "monthly":
      submittedAfter = buildSubmittedAfterIso(nowValue, 1);
      break;
  }

  return !(await dependencies.hasSubmittedCheckoutForm({
    clientId,
    templateId: form.id,
    appointmentTypeId,
    submittedAfter
  }));
}

function requirePaidPublicPackageDependencies(
  dependencies: PublicPackagePurchaseDependencies
): Required<Pick<
  PublicPackagePurchaseDependencies,
  | "createPublicPackagePaymentSession"
  | "storePendingPublicPackagePurchase"
  | "findPendingPublicPackagePurchase"
  | "deletePendingPublicPackagePurchase"
  | "findExistingPublicPackagePurchase"
  | "fetchPublicPackagePaymentSession"
>> {
  if (
    dependencies.createPublicPackagePaymentSession == null
    || dependencies.storePendingPublicPackagePurchase == null
    || dependencies.findPendingPublicPackagePurchase == null
    || dependencies.deletePendingPublicPackagePurchase == null
    || dependencies.findExistingPublicPackagePurchase == null
    || dependencies.fetchPublicPackagePaymentSession == null
  ) {
    throw new PublicPackagePurchaseError(
      "unavailable",
      "Online payments are not currently available for this package."
    );
  }

  return {
    createPublicPackagePaymentSession: dependencies.createPublicPackagePaymentSession,
    storePendingPublicPackagePurchase: dependencies.storePendingPublicPackagePurchase,
    findPendingPublicPackagePurchase: dependencies.findPendingPublicPackagePurchase,
    deletePendingPublicPackagePurchase: dependencies.deletePendingPublicPackagePurchase,
    findExistingPublicPackagePurchase: dependencies.findExistingPublicPackagePurchase,
    fetchPublicPackagePaymentSession: dependencies.fetchPublicPackagePaymentSession
  };
}

async function resolveRequestedPublicPackagePurchase(
  input: unknown,
  dependencies: PublicPackagePurchaseDependencies
): Promise<ResolvedPublicPackagePurchaseRequest> {
  const request = publicPackagePurchaseRequestSchema.parse(input);
  const packageItem = await dependencies.findPublicPackageByToken(request.token);
  if (packageItem == null || !packageItem.active) {
    throw new PublicPackagePurchaseError("not_found", "Public package not found.");
  }

  const attachedForm = await loadPublicPackageCheckoutForm(packageItem, dependencies);
  let formSubmission: { templateId: string; responses: Array<string | string[]> } | undefined;
  if (attachedForm != null) {
    const formIsDue = await packageCheckoutFormIsDue(attachedForm, request.buyerEmail, dependencies);
    if (formIsDue) {
      const validation = validatePublicPackageFormSubmission(
        attachedForm,
        request.formResponses[attachedForm.id] ?? {}
      );
      if (validation.errors.length > 0) {
        throw new PublicPackagePurchaseError("invalid_input", validation.errors.join(" "));
      }

      formSubmission = {
        templateId: attachedForm.id,
        responses: validation.responses
      };
    }
  }

  return {
    ...request,
    packageItem,
    attachedForm,
    formSubmission
  };
}

export async function loadPublicPackageCheckoutForm(
  packageItem: Package,
  dependencies: Pick<PublicPackagePurchaseDependencies, "findPublicCheckoutForm">
): Promise<PublicPackageCheckoutForm | null> {
  if (packageItem.formTemplateId == null || packageItem.formTemplateId.trim() === "") {
    return null;
  }

  const rawForm = await dependencies.findPublicCheckoutForm(packageItem.formTemplateId);
  if (rawForm == null) {
    return null;
  }

  const form = formTemplateSchema.parse(rawForm);
  return isPublicPackageCheckoutFormEligible(form) ? form : null;
}

export async function purchasePublicPackage(
  input: unknown,
  dependencies: PublicPackagePurchaseDependencies
) {
  const request = await resolveRequestedPublicPackagePurchase(input, dependencies);
  if (request.packageItem.price > 0) {
    throw new PublicPackagePurchaseError(
      "unavailable",
      "This package requires secure online checkout."
    );
  }

  const purchase = await dependencies.finalizePublicPackagePurchase({
    packageItem: request.packageItem,
    buyerName: request.buyerName,
    buyerEmail: request.buyerEmail,
    buyerPhone: request.buyerPhone,
    notes: request.notes,
    paymentMethod: "offline",
    formSubmission: request.formSubmission
  });

  return {
    status: "completed" as const,
    packageItem: request.packageItem,
    purchase,
    attachedForm: request.attachedForm
  };
}

export async function beginPublicPackagePurchase(
  input: unknown,
  dependencies: PublicPackagePurchaseDependencies
) {
  const request = publicPackageCheckoutStartRequestSchema.parse(input);
  const resolved = await resolveRequestedPublicPackagePurchase(request, dependencies);

  if (resolved.packageItem.price <= 0) {
    const purchase = await dependencies.finalizePublicPackagePurchase({
      packageItem: resolved.packageItem,
      buyerName: resolved.buyerName,
      buyerEmail: resolved.buyerEmail,
      buyerPhone: resolved.buyerPhone,
      notes: resolved.notes,
      paymentMethod: "offline",
      formSubmission: resolved.formSubmission
    });

    return {
      status: "completed" as const,
      packageItem: resolved.packageItem,
      attachedForm: resolved.attachedForm,
      purchase
    };
  }

  const paidDependencies = requirePaidPublicPackageDependencies(dependencies);
  const paymentSession = await paidDependencies.createPublicPackagePaymentSession({
    packageItem: resolved.packageItem,
    buyerName: resolved.buyerName,
    buyerEmail: resolved.buyerEmail,
    buyerPhone: resolved.buyerPhone,
    notes: resolved.notes,
    successUrl: request.successUrl,
    cancelUrl: request.cancelUrl
  });

  await paidDependencies.storePendingPublicPackagePurchase({
    packageId: resolved.packageItem.id,
    packageToken: resolved.token,
    stripeCheckoutSessionId: paymentSession.sessionId,
    buyerName: resolved.buyerName,
    buyerEmail: resolved.buyerEmail,
    buyerPhone: resolved.buyerPhone,
    notes: resolved.notes,
    formSubmission: resolved.formSubmission
  });

  return {
    status: "requires_payment" as const,
    packageItem: resolved.packageItem,
    attachedForm: resolved.attachedForm,
    paymentSession
  };
}

export async function resumePublicPackagePurchase(
  input: unknown,
  dependencies: PublicPackagePurchaseDependencies
) {
  const request = publicPackageCheckoutResumeRequestSchema.parse(input);
  const packageItem = await dependencies.findPublicPackageByToken(request.token);
  if (packageItem == null || !packageItem.active) {
    throw new PublicPackagePurchaseError("not_found", "Public package not found.");
  }

  const paidDependencies = requirePaidPublicPackageDependencies(dependencies);
  const existingPurchase = await paidDependencies.findExistingPublicPackagePurchase(
    packageItem.id,
    request.sessionId
  );
  if (existingPurchase != null) {
    await paidDependencies.deletePendingPublicPackagePurchase(packageItem.id, request.sessionId);
    return {
      status: "completed" as const,
      packageItem,
      purchase: existingPurchase
    };
  }

  const pendingPurchase = await paidDependencies.findPendingPublicPackagePurchase(
    packageItem.id,
    request.sessionId
  );
  if (pendingPurchase == null || pendingPurchase.packageId !== packageItem.id) {
    throw new PublicPackagePurchaseError(
      "invalid_input",
      "We could not recover your checkout details to finish this purchase. Please try again or contact the team if your card was charged."
    );
  }

  const checkoutSession = await paidDependencies.fetchPublicPackagePaymentSession(request.sessionId);
  if (checkoutSession == null || checkoutSession.sessionId.trim() === "") {
    throw new PublicPackagePurchaseError(
      "unavailable",
      "Could not verify your payment. If you were charged, please contact the team."
    );
  }

  if (checkoutSession.paymentStatus !== "paid") {
    return {
      status: "awaiting_payment" as const,
      packageItem,
      infoMessage: "Payment was not completed. You can review the package details and try again below."
    };
  }

  if (checkoutSession.amountTotal !== Math.round(packageItem.price * 100)) {
    throw new PublicPackagePurchaseError(
      "invalid_input",
      "The payment amount did not match this package. Please contact the team if you were charged."
    );
  }

  if (checkoutSession.packageId != null && checkoutSession.packageId !== packageItem.id) {
    throw new PublicPackagePurchaseError(
      "invalid_input",
      "The payment confirmation did not match this package. Please contact the team if you were charged."
    );
  }

  if (checkoutSession.packageToken != null && checkoutSession.packageToken !== request.token) {
    throw new PublicPackagePurchaseError(
      "invalid_input",
      "The payment confirmation did not match this package. Please contact the team if you were charged."
    );
  }

  const purchase = await dependencies.finalizePublicPackagePurchase({
    packageItem,
    buyerName: pendingPurchase.buyerName,
    buyerEmail: pendingPurchase.buyerEmail,
    buyerPhone: pendingPurchase.buyerPhone,
    notes: pendingPurchase.notes,
    paymentMethod: "credit_card",
    stripeCheckoutSessionId: request.sessionId,
    stripePaymentIntentId: checkoutSession.paymentIntentId,
    formSubmission: pendingPurchase.formSubmission
  });

  await paidDependencies.deletePendingPublicPackagePurchase(packageItem.id, request.sessionId);

  return {
    status: "completed" as const,
    packageItem,
    purchase
  };
}
