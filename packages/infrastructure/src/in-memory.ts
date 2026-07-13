import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  AdminConfigurationDependencies,
  AdminCalendarSyncDependencies,
  AdminActorProfileDependencies,
  AdminDashboardDependencies,
  AdminIdentity,
  AdminOperationsDependencies,
  AchievementDependencies,
  ClientProfileDependencies,
  ContentManagementDependencies,
  ContactManagementDependencies,
  IntegrationCallbackDependencies,
  AdminLoginDependencies,
  PetFileManagementDependencies,
  AdminResourceReadDependencies,
  ApiDependencies,
  BackgroundProcessorDependencies,
  InboundEmailProcessingDependencies,
  PortalCommerceDependencies,
  PublicDocumentAccessDependencies,
  PortalResourceReadDependencies,
  PortalSummaryDependencies,
  PortalActorProfileDependencies,
  PortalLoginDependencies,
  PublicContactDependencies,
  PendingPublicPackagePurchase,
  PublicPackagePurchaseDependencies,
  PublicPackagePaymentSessionState,
  PublicBookingDependencies,
  WorkflowManagementDependencies
} from "@bdta/application";
import type {
  AchievementType,
  AppointmentType,
  BlogPost,
  Booking,
  ClientAchievement,
  ClientContact,
  ClientProfile,
  Contract,
  Credit,
  Expense,
  FormTemplate,
  FormSubmission,
  InboundEmail,
  Invoice,
  Notification,
  OutboundEmailMessage,
  Package,
  Pet,
  PetFile,
  PublicAccessToken,
  Quote,
  ScheduledTask,
  Setting,
  SitePage,
  UnmatchedEmail,
  Workflow,
  WorkflowAutoEnrollmentTrigger,
  WorkflowEnrollment,
  WorkflowStep,
  WorkflowStepExecution,
  EmailTemplate
} from "@bdta/domain";
import type { JobEnvelope, JobResult, SupportedJobKind } from "@bdta/contracts";

export type InMemoryPortalUser = {
  clientId: string;
  email: string;
  displayName: string;
  passwordHash: string;
  phone?: string;
  address?: string;
  notes?: string;
  isAdmin?: boolean;
  archived: boolean;
};

export type InMemoryAdminUser = {
  actorId: string;
  username: string;
  displayName: string;
  email?: string;
  passwordHash: string;
  role: "owner" | "admin" | "accountant" | "staff";
  accountType?: "main" | "standard" | "accountant";
  canManageAdminUsers?: boolean;
  canManageApiKeys?: boolean;
  isMainAccount?: boolean;
  active: boolean;
};

export type InMemoryWorkflowEmailTemplate = {
  id: string;
  name: string;
  templateType?: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  active: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type InMemoryWorkflowOption = {
  id: string;
  name: string;
  active?: boolean;
};

export type InMemoryAppointmentType = Partial<AppointmentType> & Pick<AppointmentType, "id" | "name"> & {
  active?: boolean;
};

export type InMemoryScheduledTask = {
  id: string;
  name?: string;
  taskType: string;
  active: boolean;
  scheduleType?: string;
  scheduleValue?: string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
};

export type InMemoryPublicPackagePurchase = {
  packageId: string;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  paymentMethod: "offline" | "credit_card";
  clientId: string;
  clientPackageId: string;
};

export type InMemoryPublicPackagePaymentSession = PublicPackagePaymentSessionState & {
  checkoutUrl: string;
  successUrl: string;
  cancelUrl: string;
};

export type InMemoryPlatformState = {
  now: () => string;
  blogPosts: BlogPost[];
  sitePages: SitePage[];
  settings: Setting[];
  bookings: Booking[];
  contacts: ClientContact[];
  pets: Pet[];
  petFiles: PetFile[];
  petFileContents: Record<string, string | Uint8Array>;
  achievementTypes: AchievementType[];
  clientAchievements: ClientAchievement[];
  expenses: Expense[];
  invoices: Invoice[];
  quotes: Quote[];
  contracts: Contract[];
  packages: Package[];
  credits: Credit[];
  publicPackagePurchases: InMemoryPublicPackagePurchase[];
  pendingPublicPackagePurchases: PendingPublicPackagePurchase[];
  publicPackagePaymentSessions: InMemoryPublicPackagePaymentSession[];
  formTemplates: FormTemplate[];
  formSubmissions: FormSubmission[];
  notifications: Notification[];
  workflows: Workflow[];
  workflowTriggers: WorkflowAutoEnrollmentTrigger[];
  workflowEnrollments: WorkflowEnrollment[];
  workflowSteps: WorkflowStep[];
  workflowStepExecutions: WorkflowStepExecution[];
  contractTemplates: InMemoryWorkflowOption[];
  appointmentTypes: InMemoryAppointmentType[];
  emailTemplates: InMemoryWorkflowEmailTemplate[];
  scheduledTasks: InMemoryScheduledTask[];
  portalUsers: InMemoryPortalUser[];
  adminUsers: InMemoryAdminUser[];
  sessions: Map<string, string>;
  queuedEmails: OutboundEmailMessage[];
  queuedJobs: JobEnvelope[];
  integrationCallbacks: Array<{
    callbackId: string;
    provider: "stripe" | "google_calendar" | "mail_provider" | "imap";
    receivedAt: string;
    payload: Record<string, unknown>;
    queuedJobId: string | null;
  }>;
  inboundEmails: InboundEmail[];
  unmatchedEmails: UnmatchedEmail[];
  calendarSyncs: Array<{
    bookingId: string;
    provider: "google_calendar";
    externalEventId: string;
    externalEventUrl: string | null;
    syncedAt: string;
  }>;
  jobHistory: Array<{
    job: JobEnvelope;
    status: "processed" | "failed";
    processedAt: string;
    summary: string;
  }>;
  processedJobResults: JobResult[];
  failedJobResults: JobResult[];
  sentEmails: OutboundEmailMessage[];
  failedEmailAttempts: Array<{ message: OutboundEmailMessage; reason: string }>;
  loginEvents: string[];
  captchaVerifier: (token: string) => Promise<boolean>;
  availabilityChecker: PublicBookingDependencies["isTimeSlotAvailable"];
  passwordVerifier: (password: string, hash: string) => Promise<boolean>;
};

type InMemoryPlatformStateInput = Partial<Pick<InMemoryPlatformState, "portalUsers" | "adminUsers" | "blogPosts" | "sitePages" | "settings" | "expenses" | "invoices" | "quotes" | "bookings" | "contacts" | "pets" | "petFiles" | "petFileContents" | "achievementTypes" | "clientAchievements" | "contracts" | "packages" | "credits" | "publicPackagePurchases" | "pendingPublicPackagePurchases" | "publicPackagePaymentSessions" | "formTemplates" | "formSubmissions" | "notifications" | "workflows" | "workflowTriggers" | "workflowEnrollments" | "workflowSteps" | "workflowStepExecutions" | "contractTemplates" | "appointmentTypes" | "emailTemplates" | "scheduledTasks" | "queuedEmails" | "queuedJobs">> & {
  now?: () => string;
  captchaVerifier?: (token: string) => Promise<boolean>;
  availabilityChecker?: PublicBookingDependencies["isTimeSlotAvailable"];
  passwordVerifier?: (password: string, hash: string) => Promise<boolean>;
};

export function createInMemoryPlatformState(input: InMemoryPlatformStateInput = {}): InMemoryPlatformState {
  return {
    now: input.now ?? (() => "2026-05-27T18:00:00.000Z"),
    blogPosts: input.blogPosts ?? [],
    sitePages: input.sitePages ?? [],
    settings: input.settings ?? [],
    bookings: input.bookings ?? [],
    contacts: input.contacts ?? [],
    pets: input.pets ?? [],
  petFiles: input.petFiles ?? [],
  petFileContents: input.petFileContents ?? {},
  achievementTypes: input.achievementTypes ?? [],
  clientAchievements: input.clientAchievements ?? [],
  expenses: input.expenses ?? [],
  invoices: input.invoices ?? [],
  quotes: input.quotes ?? [],
  contracts: input.contracts ?? [],
    packages: input.packages ?? [],
    credits: input.credits ?? [],
    publicPackagePurchases: input.publicPackagePurchases ?? [],
    pendingPublicPackagePurchases: input.pendingPublicPackagePurchases ?? [],
    publicPackagePaymentSessions: input.publicPackagePaymentSessions ?? [],
    formTemplates: input.formTemplates ?? [],
    formSubmissions: input.formSubmissions ?? [],
    notifications: input.notifications ?? [],
    workflows: input.workflows ?? [],
    workflowTriggers: input.workflowTriggers ?? [],
    workflowEnrollments: input.workflowEnrollments ?? [],
    workflowSteps: input.workflowSteps ?? [],
    workflowStepExecutions: input.workflowStepExecutions ?? [],
    contractTemplates: input.contractTemplates ?? [],
    appointmentTypes: input.appointmentTypes ?? [],
    emailTemplates: input.emailTemplates ?? [],
    scheduledTasks: input.scheduledTasks ?? [],
    portalUsers: input.portalUsers ?? [],
    adminUsers: input.adminUsers ?? [],
    sessions: new Map<string, string>(),
    queuedEmails: input.queuedEmails ?? [],
    queuedJobs: input.queuedJobs ?? [],
    integrationCallbacks: [],
    inboundEmails: [],
    unmatchedEmails: [],
    calendarSyncs: [],
    jobHistory: [],
    processedJobResults: [],
    failedJobResults: [],
    sentEmails: [],
    failedEmailAttempts: [],
    loginEvents: [],
    captchaVerifier: input.captchaVerifier ?? (async () => true),
    availabilityChecker: input.availabilityChecker ?? (async () => true),
    passwordVerifier: input.passwordVerifier ?? (async (password, hash) => password === hash)
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderAchievementCertificateHtml(
  achievement: ClientAchievement,
  options: { audience: "portal" | "admin"; download: boolean; backPath: string }
): string {
  const awardedOn = new Date(`${achievement.awardedOn}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  });
  const dogName = escapeHtml(achievement.dogName ?? "Achievement Recipient");
  const title = escapeHtml(achievement.title);
  const programName = escapeHtml(achievement.programName ?? "");
  const notes = escapeHtml(achievement.notes ?? "");
  const backPath = escapeHtml(options.backPath);
  const certificateBodyHtml = achievement.certificateBodyHtml ?? `<p>${dogName} completed ${programName || "training"}.</p>`;

  return [
    "<!doctype html>",
    `<html lang="en" data-audience="${options.audience}" data-download="${options.download ? "1" : "0"}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${title} Certificate</title>`,
    "<style>",
    "body { font-family: Georgia, serif; background: #f7f2e8; color: #1f2933; margin: 0; }",
    ".sheet { max-width: 860px; margin: 24px auto; background: white; padding: 48px; border: 8px solid #d8c08c; }",
    ".eyebrow { text-transform: uppercase; letter-spacing: 0.18em; font-size: 12px; color: #6b7280; }",
    "h1 { font-size: 42px; margin: 12px 0 8px; }",
    ".dog { font-size: 28px; margin: 12px 0; }",
    ".meta { margin-top: 24px; color: #4b5563; }",
    ".actions { margin-top: 32px; font-family: Arial, sans-serif; }",
    ".actions a { color: #1d4ed8; text-decoration: none; }",
    "</style>",
    "</head>",
    "<body>",
    '<main class="sheet">',
    '<div class="eyebrow">Brook&apos;s Dog Training Academy</div>',
    `<h1>${title}</h1>`,
    `<p class="dog">${dogName}</p>`,
    certificateBodyHtml,
    `<p class="meta">Awarded ${escapeHtml(awardedOn)}${programName ? ` for ${programName}` : ""}.</p>`,
    notes ? `<p class="meta">${notes}</p>` : "",
    `<div class="actions"><a href="${backPath}">Back</a></div>`,
    "</main>",
    "</body>",
    "</html>"
  ].filter(Boolean).join("");
}

function createIntegrationCallbackDependencies(state: InMemoryPlatformState): IntegrationCallbackDependencies {
  let sequence = 0;

  function readSettingValue(key: string): string {
    return state.settings.find((setting) => setting.key === key)?.value?.trim() ?? "";
  }

  function parseStripeSignatureHeader(signatureHeader: string): {
    timestamp: string;
    signatures: string[];
  } | null {
    const signatures: string[] = [];
    let parsedTimestamp = "";

    for (const part of signatureHeader.split(",")) {
      const [key, ...valueParts] = part.split("=");
      const normalizedKey = key?.trim() ?? "";
      const normalizedValue = valueParts.join("=").trim();
      if (normalizedKey === "t" && normalizedValue !== "") {
        parsedTimestamp = normalizedValue;
      }
      if (normalizedKey === "v1" && normalizedValue !== "") {
        signatures.push(normalizedValue);
      }
    }

    return parsedTimestamp !== "" && signatures.length > 0
      ? {
        timestamp: parsedTimestamp,
        signatures
      }
      : null;
  }

  function secureCompare(expected: string, candidate: string): boolean {
    const expectedBuffer = Buffer.from(expected, "utf8");
    const candidateBuffer = Buffer.from(candidate, "utf8");
    return expectedBuffer.length === candidateBuffer.length
      && timingSafeEqual(expectedBuffer, candidateBuffer);
  }

  function verifyStripeWebhookSignature(rawBody: string, signature: string, secret: string): void {
    const parsedSignature = parseStripeSignatureHeader(signature);
    if (parsedSignature == null) {
      throw new Error("Invalid Stripe webhook signature header.");
    }

    const timestampSeconds = Number(parsedSignature.timestamp);
    if (!Number.isFinite(timestampSeconds)) {
      throw new Error("Invalid Stripe webhook signature timestamp.");
    }

    const currentSeconds = Math.floor(Date.parse(state.now()) / 1000);
    if (Math.abs(currentSeconds - timestampSeconds) > 300) {
      throw new Error("Stripe webhook signature timestamp is outside the allowed tolerance.");
    }

    const expectedSignature = createHmac("sha256", secret)
      .update(`${parsedSignature.timestamp}.${rawBody}`, "utf8")
      .digest("hex");

    if (!parsedSignature.signatures.some((candidate) => secureCompare(expectedSignature, candidate))) {
      throw new Error("Stripe webhook signature verification failed.");
    }
  }

  return {
    now: state.now,
    generateId: (prefix) => `${prefix}-${++sequence}`,
    recordIntegrationCallback: async (record) => {
      state.integrationCallbacks.push(record);
    },
    queueJob: async (job) => {
      state.queuedJobs.push(job);
    },
    applyStripeInvoiceUpdate: async ({ invoiceId, paymentStatus, outstandingAmount }) => {
      const index = state.invoices.findIndex((invoice) => invoice.id === invoiceId);
      if (index < 0) {
        return;
      }

      state.invoices[index] = {
        ...state.invoices[index],
        status: paymentStatus,
        outstandingAmount
      };
    },
    normalizeStripeCallbackPayload: async ({ payload, rawBody, signature }) => {
      const eventType = typeof payload.type === "string" ? payload.type.trim() : "";
      const eventObject = typeof payload.object === "string" ? payload.object.trim() : "";
      if (eventType === "" || eventObject !== "event") {
        return null;
      }

      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || readSettingValue("stripe_webhook_secret");
      if (webhookSecret === "") {
        throw new Error("Stripe webhook secret is not configured.");
      }
      if (rawBody == null || rawBody.trim() === "") {
        throw new Error("Raw Stripe webhook payload is required.");
      }
      if (signature == null || signature.trim() === "") {
        throw new Error("Stripe webhook signature is required.");
      }

      verifyStripeWebhookSignature(rawBody, signature, webhookSecret);

      const data = typeof payload.data === "object" && payload.data != null && !Array.isArray(payload.data)
        ? payload.data as Record<string, unknown>
        : {};
      const eventPayload = typeof data.object === "object" && data.object != null && !Array.isArray(data.object)
        ? data.object as Record<string, unknown>
        : {};
      const metadata = typeof eventPayload.metadata === "object" && eventPayload.metadata != null && !Array.isArray(eventPayload.metadata)
        ? eventPayload.metadata as Record<string, unknown>
        : {};
      const invoiceId = typeof metadata.invoice_id === "string" ? metadata.invoice_id.trim() : "";
      const paymentStatus = typeof eventPayload.payment_status === "string" ? eventPayload.payment_status.trim() : "";

      if (
        (eventType === "checkout.session.completed" || eventType === "checkout.session.async_payment_succeeded")
        && invoiceId !== ""
        && paymentStatus === "paid"
      ) {
        return {
          kind: "invoice_update" as const,
          invoiceId,
          paymentStatus: "paid" as const,
          outstandingAmount: 0
        };
      }

      return {
        kind: "ignored" as const,
        reason: `Unhandled Stripe event: ${eventType || "unknown"}`
      };
    },
    applyGoogleCalendarSyncUpdate: async ({ bookingId, externalEventId, externalEventUrl, syncedAt }) => {
      const record = {
        bookingId,
        provider: "google_calendar" as const,
        externalEventId,
        externalEventUrl,
        syncedAt
      };
      const index = state.calendarSyncs.findIndex((candidate) => (
        candidate.bookingId === bookingId
        && candidate.provider === "google_calendar"
      ));

      if (index >= 0) {
        state.calendarSyncs[index] = record;
        return;
      }

      state.calendarSyncs.push(record);
    }
  };
}

type InMemoryJobProcessorOptions = {
  handlers?: Partial<Record<SupportedJobKind, (job: JobEnvelope) => Promise<string>>>;
  sendEmail?: (message: OutboundEmailMessage) => Promise<void>;
};

type InMemoryWorkflowRuntime = {
  enrollWorkflowClients(workflowId: string, clientIds: string[], adminUserId: string | null): void;
  applyAppointmentBookingTriggers(booking: Booking): void;
  applyFormSubmissionTriggers(submission: FormSubmission): void;
  getWorkflowProcessorIntervalMinutes(): number;
  nextWorkflowId(): string;
  nextWorkflowTriggerId(): string;
  nextWorkflowStepId(): string;
};

function nextSequentialIdentifier(prefix: string, ids: Iterable<string>): string {
  const existing = new Set(ids);
  let sequence = existing.size + 1;
  while (existing.has(`${prefix}-${sequence}`)) {
    sequence += 1;
  }
  return `${prefix}-${sequence}`;
}

function createInMemoryWorkflowRuntime(state: InMemoryPlatformState): InMemoryWorkflowRuntime {
  function nextWorkflowId(): string {
    return nextSequentialIdentifier("workflow", state.workflows.map((workflow) => workflow.id));
  }

  function nextWorkflowTriggerId(): string {
    return nextSequentialIdentifier("workflow-trigger", state.workflowTriggers.map((trigger) => trigger.id));
  }

  function nextWorkflowEnrollmentId(): string {
    return nextSequentialIdentifier("workflow-enrollment", state.workflowEnrollments.map((enrollment) => enrollment.id));
  }

  function nextWorkflowStepId(): string {
    return nextSequentialIdentifier("workflow-step", state.workflowSteps.map((step) => step.id));
  }

  function nextWorkflowStepExecutionId(): string {
    return nextSequentialIdentifier(
      "workflow-step-execution",
      state.workflowStepExecutions.map((execution) => execution.id)
    );
  }

  function getWorkflowStatus(enrollment: WorkflowEnrollment): "active" | "completed" | "cancelled" {
    if (enrollment.status != null) {
      return enrollment.status;
    }
    return enrollment.completedAt == null ? "active" : "completed";
  }

  function getWorkflowProcessorIntervalMinutes(): number {
    const tasks = state.scheduledTasks.filter((task) => (
      task.active
      && (task.taskType === "workflow_processor" || task.taskType === "workflow")
    ));
    if (tasks.length === 0) {
      return 60;
    }

    const intervals = tasks.map((task) => {
      switch (task.scheduleType) {
        case "interval":
          return Math.max(1, Number.parseInt(task.scheduleValue ?? "60", 10) || 60);
        case "hourly":
          return 60;
        case "daily":
          return 60 * 24;
        case "weekly":
          return 60 * 24 * 7;
        case "monthly":
          return 60 * 24 * 30;
        case "custom": {
          const value = (task.scheduleValue ?? "").trim();
          const minuteMatch = /^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/.exec(value);
          if (minuteMatch != null) {
            return Math.max(1, Number.parseInt(minuteMatch[1] ?? "60", 10));
          }
          const hourMatch = /^\d+\s+\*\/(\d+)\s+\*\s+\*\s+\*$/.exec(value);
          if (hourMatch != null) {
            return Math.max(1, Number.parseInt(hourMatch[1] ?? "1", 10)) * 60;
          }
          return 60;
        }
        default:
          return 60;
      }
    });

    return Math.min(...intervals);
  }

  function parseWorkflowDelayToMinutes(delayValue: string | null | undefined): number {
    if (delayValue == null || delayValue.trim() === "") {
      return 0;
    }

    const normalizedDelayValue = delayValue.trim();
    const matched = /^(\d+)\s*(minute|hour|day|week)s?$/i.exec(normalizedDelayValue);
    if (matched != null) {
      const amount = Number.parseInt(matched[1] ?? "0", 10);
      const unit = (matched[2] ?? "").toLowerCase();

      switch (unit) {
        case "minute":
          return amount;
        case "hour":
          return amount * 60;
        case "day":
          return amount * 60 * 24;
        case "week":
          return amount * 60 * 24 * 7;
        default:
          return 0;
      }
    }

    if (/^\d+$/.test(normalizedDelayValue)) {
      return Number.parseInt(normalizedDelayValue, 10);
    }

    return 0;
  }

  function calculateWorkflowStepScheduledFor(
    step: WorkflowStep,
    enrolledAt: string,
    previousScheduledFor: string | null
  ): string {
    switch (step.delayType) {
      case "immediate":
        return enrolledAt;
      case "after_enrollment":
        return new Date(Date.parse(enrolledAt) + parseWorkflowDelayToMinutes(step.delayValue ?? null) * 60_000).toISOString();
      case "after_previous": {
        const baseTimestamp = previousScheduledFor ?? enrolledAt;
        return new Date(Date.parse(baseTimestamp) + parseWorkflowDelayToMinutes(step.delayValue ?? null) * 60_000).toISOString();
      }
      case "specific_date":
        return step.scheduledDate ?? enrolledAt;
      default:
        return enrolledAt;
    }
  }

  function scheduleWorkflowStepExecutions(enrollment: WorkflowEnrollment): void {
    const steps = [...state.workflowSteps]
      .filter((step) => step.workflowId === enrollment.workflowId)
      .sort((left, right) => left.stepOrder - right.stepOrder);

    let previousScheduledFor: string | null = null;
    for (const step of steps) {
      const scheduledFor = calculateWorkflowStepScheduledFor(step, enrollment.enrolledAt, previousScheduledFor);
      state.workflowStepExecutions.push({
        id: nextWorkflowStepExecutionId(),
        enrollmentId: enrollment.id,
        stepId: step.id,
        scheduledFor,
        executedAt: null,
        status: "pending",
        errorMessage: null
      });
      previousScheduledFor = scheduledFor;
    }

    const nextPendingExecution = state.workflowStepExecutions
      .filter((execution) => execution.enrollmentId === enrollment.id && execution.status === "pending")
      .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor))[0];
    const enrollmentIndex = state.workflowEnrollments.findIndex((candidate) => candidate.id === enrollment.id);
    if (enrollmentIndex >= 0) {
      state.workflowEnrollments[enrollmentIndex] = {
        ...state.workflowEnrollments[enrollmentIndex],
        nextRunAt: nextPendingExecution?.scheduledFor ?? state.workflowEnrollments[enrollmentIndex]?.nextRunAt ?? enrollment.enrolledAt
      };
    }
  }

  function enrollWorkflowClients(workflowId: string, clientIds: string[], adminUserId: string | null): void {
    const now = state.now();
    for (const clientId of clientIds) {
      const alreadyEnrolled = state.workflowEnrollments.some((candidate) => (
        candidate.workflowId === workflowId
        && candidate.clientId === clientId
        && getWorkflowStatus(candidate) === "active"
      ));
      if (alreadyEnrolled) {
        continue;
      }

      const enrollment: WorkflowEnrollment = {
        id: nextWorkflowEnrollmentId(),
        workflowId,
        clientId,
        enrolledAt: now,
        nextRunAt: null,
        completedAt: null,
        status: "active",
        enrolledByAdminUserId: adminUserId,
        cancelledAt: null
      };
      state.workflowEnrollments.push(enrollment);
      scheduleWorkflowStepExecutions(enrollment);
    }
  }

  function applyAppointmentBookingTriggers(booking: Booking): void {
    const workflowIds = new Set(
      state.workflowTriggers
        .filter((trigger) => (
          trigger.active
          && trigger.triggerType === "appointment_booking"
          && trigger.appointmentTypeId === booking.serviceId
          && state.workflows.some((workflow) => workflow.id === trigger.workflowId && workflow.active)
        ))
        .map((trigger) => trigger.workflowId)
    );

    for (const workflowId of workflowIds) {
      enrollWorkflowClients(workflowId, [booking.clientId], null);
    }
  }

  function applyFormSubmissionTriggers(submission: FormSubmission): void {
    const workflowIds = new Set(
      state.workflowTriggers
        .filter((trigger) => (
          trigger.active
          && trigger.triggerType === "form_submission"
          && trigger.formTemplateId === submission.templateId
          && state.workflows.some((workflow) => workflow.id === trigger.workflowId && workflow.active)
        ))
        .map((trigger) => trigger.workflowId)
    );

    for (const workflowId of workflowIds) {
      enrollWorkflowClients(workflowId, [submission.clientId], null);
    }
  }

  return {
    enrollWorkflowClients,
    applyAppointmentBookingTriggers,
    applyFormSubmissionTriggers,
    getWorkflowProcessorIntervalMinutes,
    nextWorkflowId,
    nextWorkflowTriggerId,
    nextWorkflowStepId
  };
}

function createPublicBookingDependencies(
  state: InMemoryPlatformState,
  workflowRuntime: InMemoryWorkflowRuntime
): PublicBookingDependencies {
  let sequence = 0;

  async function ensureClientForBooking(email: string): Promise<{ clientId: string; portalUserId: string | null; displayName: string }> {
    const existing = state.portalUsers.find((user) => user.email === email);
    if (existing != null) {
      return {
        clientId: existing.clientId,
        portalUserId: existing.clientId,
        displayName: existing.displayName
      };
    }

    const clientId = `client-${state.portalUsers.length + 1}`;
    state.portalUsers.push({
      clientId,
      email,
      displayName: email,
      passwordHash: "",
      archived: false
    });

    return {
      clientId,
      portalUserId: null,
      displayName: email
    };
  }

  async function issueIcalToken(input: { bookingId: string; issuedAt: string }): Promise<PublicAccessToken> {
    return {
      token: `ical-${input.bookingId}-token`,
      issuedAt: input.issuedAt,
      expiresAt: null,
      legacySourceId: null
    };
  }

  return {
    now: state.now,
    generateId: (prefix) => `${prefix}-${++sequence}`,
    verifyCaptcha: state.captchaVerifier,
    isTimeSlotAvailable: state.availabilityChecker,
    ensureClientForBooking,
    issueIcalToken,
    saveBooking: async ({ booking }) => {
      state.bookings.push(booking);
      workflowRuntime.applyAppointmentBookingTriggers(booking);
    },
    queueConfirmationEmail: async (message) => {
      state.queuedEmails.push(message);
    },
    queueJob: async (job) => {
      state.queuedJobs.push(job);
    },
    buildPortalReturnUrl: (clientId) => `https://portal.example.test/portal?client=${clientId}`
  };
}

function createPublicPackagePurchaseDependencies(
  state: InMemoryPlatformState,
  workflowRuntime: InMemoryWorkflowRuntime
): PublicPackagePurchaseDependencies {
  let purchaseSequence = state.publicPackagePurchases.length;
  let creditSequence = state.credits.length;
  let paymentSessionSequence = state.publicPackagePaymentSessions.length;

  function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  return {
    now: state.now,
    findPublicPackageByToken: async (token) => state.packages.find((item) => item.active && item.shareToken === token) ?? null,
    findPublicCheckoutForm: async (formTemplateId) => state.formTemplates.find((item) => item.id === formTemplateId) ?? null,
    findClientIdByEmail: async (email) => state.portalUsers.find((user) => normalizeEmail(user.email) === normalizeEmail(email))?.clientId ?? null,
    hasSubmittedCheckoutForm: async (input) => state.formSubmissions.some((submission) => {
      if (submission.clientId !== input.clientId || submission.templateId !== input.templateId || submission.submittedAt == null) {
        return false;
      }

      if (input.submittedAfter != null && submission.submittedAt < input.submittedAfter) {
        return false;
      }

      if (input.appointmentTypeId == null) {
        return true;
      }

      const template = state.formTemplates.find((item) => item.id === submission.templateId) ?? null;
      return template?.appointmentTypeId === input.appointmentTypeId;
    }),
    createPublicPackagePaymentSession: async (input) => {
      const sessionId = `pkg-checkout-session-${++paymentSessionSequence}`;
      const paymentSession: InMemoryPublicPackagePaymentSession = {
        sessionId,
        paymentStatus: "unpaid",
        amountTotal: Math.round(input.packageItem.price * 100),
        packageId: input.packageItem.id,
        packageToken: input.packageItem.shareToken ?? null,
        paymentIntentId: null,
        checkoutUrl: `https://checkout.example.test/public-packages/${encodeURIComponent(sessionId)}`,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl
      };
      state.publicPackagePaymentSessions.push(paymentSession);
      return {
        sessionId,
        checkoutUrl: paymentSession.checkoutUrl
      };
    },
    storePendingPublicPackagePurchase: async (input) => {
      const existingIndex = state.pendingPublicPackagePurchases.findIndex((purchase) => (
        purchase.packageId === input.packageId
        && purchase.stripeCheckoutSessionId === input.stripeCheckoutSessionId
      ));
      if (existingIndex >= 0) {
        state.pendingPublicPackagePurchases[existingIndex] = input;
        return;
      }

      state.pendingPublicPackagePurchases.push(input);
    },
    findPendingPublicPackagePurchase: async (packageId, stripeCheckoutSessionId) => (
      state.pendingPublicPackagePurchases.find((purchase) => (
        purchase.packageId === packageId
        && purchase.stripeCheckoutSessionId === stripeCheckoutSessionId
      )) ?? null
    ),
    deletePendingPublicPackagePurchase: async (packageId, stripeCheckoutSessionId) => {
      const existingIndex = state.pendingPublicPackagePurchases.findIndex((purchase) => (
        purchase.packageId === packageId
        && purchase.stripeCheckoutSessionId === stripeCheckoutSessionId
      ));
      if (existingIndex >= 0) {
        state.pendingPublicPackagePurchases.splice(existingIndex, 1);
      }
    },
    findExistingPublicPackagePurchase: async (packageId, stripeCheckoutSessionId) => {
      const existingPurchase = state.publicPackagePurchases.find((purchase) => (
        purchase.packageId === packageId
        && purchase.stripeCheckoutSessionId === stripeCheckoutSessionId
      )) ?? null;
      if (existingPurchase == null) {
        return null;
      }

      return {
        clientId: existingPurchase.clientId,
        clientPackageId: existingPurchase.clientPackageId
      };
    },
    fetchPublicPackagePaymentSession: async (stripeCheckoutSessionId) => (
      state.publicPackagePaymentSessions.find((session) => session.sessionId === stripeCheckoutSessionId) ?? null
    ),
    finalizePublicPackagePurchase: async (input) => {
      if (input.stripeCheckoutSessionId != null && input.stripeCheckoutSessionId.trim() !== "") {
        const existingPurchase = state.publicPackagePurchases.find((purchase) => (
          purchase.packageId === input.packageItem.id
          && purchase.stripeCheckoutSessionId === input.stripeCheckoutSessionId
        )) ?? null;
        if (existingPurchase != null) {
          return {
            clientId: existingPurchase.clientId,
            clientPackageId: existingPurchase.clientPackageId
          };
        }
      }

      const normalizedEmail = normalizeEmail(input.buyerEmail);
      const existingIndex = state.portalUsers.findIndex((user) => normalizeEmail(user.email) === normalizedEmail);
      let clientId: string;

      if (existingIndex >= 0) {
        const existing = state.portalUsers[existingIndex];
        clientId = existing.clientId;
        state.portalUsers[existingIndex] = {
          ...existing,
          displayName: existing.displayName.trim() === "" ? input.buyerName : existing.displayName,
          phone: existing.phone?.trim() ? existing.phone : (input.buyerPhone.trim() === "" ? existing.phone : input.buyerPhone),
          notes: input.notes.trim() === "" ? existing.notes : input.notes,
          archived: false
        };
      } else {
        clientId = `client-${state.portalUsers.length + 1}`;
        state.portalUsers.push({
          clientId,
          email: normalizedEmail,
          displayName: input.buyerName,
          passwordHash: "",
          phone: input.buyerPhone.trim() === "" ? undefined : input.buyerPhone,
          notes: input.notes.trim() === "" ? undefined : input.notes,
          archived: false
        });
      }

      const clientPackageId = `client-package-${++purchaseSequence}`;
      for (const item of input.packageItem.items ?? []) {
        if (item.appointmentTypeId == null || item.appointmentTypeId.trim() === "") {
          throw new Error(`Package ${input.packageItem.id} is missing an appointment type for one or more credit items.`);
        }

        creditSequence += 1;
        state.credits.push({
          id: `credit-${creditSequence}`,
          clientId,
          packageId: input.packageItem.id,
          appointmentTypeId: item.appointmentTypeId,
          remainingUnits: item.quantity
        });
      }

      if (input.formSubmission != null) {
        const template = state.formTemplates.find((item) => item.id === input.formSubmission?.templateId) ?? null;
        const submission: FormSubmission = {
          id: `form-submission-${state.formSubmissions.length + 1}`,
          templateId: input.formSubmission.templateId,
          clientId,
          templateName: template?.name ?? null,
          templateDescription: template?.description ?? null,
          templateFields: template?.fields ?? [],
          formType: template?.formType,
          templateIsInternal: template?.templateIsInternal,
          templateShowInClientPortal: template?.templateShowInClientPortal,
          contactName: input.buyerName,
          contactEmail: input.buyerEmail,
          contactPhone: input.buyerPhone.trim() === "" ? null : input.buyerPhone,
          responses: input.formSubmission.responses,
          submittedAt: state.now(),
          publicAccess: null
        };
        state.formSubmissions.push(submission);
        workflowRuntime.applyFormSubmissionTriggers(submission);
      }

      state.publicPackagePurchases.push({
        packageId: input.packageItem.id,
        stripeCheckoutSessionId: input.stripeCheckoutSessionId?.trim() || null,
        stripePaymentIntentId: input.stripePaymentIntentId?.trim() || null,
        paymentMethod: input.paymentMethod ?? "offline",
        clientId,
        clientPackageId
      });

      return {
        clientId,
        clientPackageId
      };
    }
  };
}

function createPublicContactDependencies(state: InMemoryPlatformState): PublicContactDependencies {
  return {
    now: state.now,
    verifyCaptcha: state.captchaVerifier,
    findLatestClientByEmail: async (email) => {
      const normalizedEmail = email.trim().toLowerCase();
      const match = [...state.portalUsers]
        .reverse()
        .find((user) => user.email.trim().toLowerCase() === normalizedEmail) ?? null;

      return match == null ? null : {
        clientId: match.clientId,
        notes: match.notes ?? ""
      };
    },
    updateClientNotes: async (clientId, notes) => {
      const index = state.portalUsers.findIndex((user) => user.clientId === clientId);
      if (index >= 0) {
        state.portalUsers[index] = {
          ...state.portalUsers[index],
          notes
        };
      }
    },
    createClientLead: async (input) => {
      const clientId = `client-${state.portalUsers.length + 1}`;
      state.portalUsers.push({
        clientId,
        email: input.email,
        displayName: input.name,
        passwordHash: "",
        phone: input.phone,
        notes: input.notes,
        archived: false
      });
      return { clientId };
    }
  };
}

function createPortalLoginDependencies(state: InMemoryPlatformState): PortalLoginDependencies {
  return {
    now: state.now,
    findPortalUserByEmail: async (email) => state.portalUsers.find((user) => user.email === email) ?? null,
    verifyPassword: state.passwordVerifier,
    buildPortalReturnUrl: (_clientId, requestedReturnTo) => requestedReturnTo ?? "https://portal.example.test/portal",
    recordSuccessfulLogin: async (clientId) => {
      state.loginEvents.push(clientId);
    }
  };
}

function createAdminLoginDependencies(state: InMemoryPlatformState): AdminLoginDependencies {
  return {
    now: state.now,
    findAdminUserByUsername: async (username) => {
      const user = state.adminUsers.find((candidate) => candidate.username === username && candidate.active);
      if (user == null) {
        return null;
      }

      return {
        actorId: user.actorId,
        source: "admin_user",
        username: user.username,
        displayName: user.displayName,
        passwordHash: user.passwordHash,
        role: user.role
      };
    },
    findAdminClientByEmail: async (email) => {
      const user = state.portalUsers.find((candidate) => candidate.email === email && !candidate.archived);
      if (user == null) {
        return null;
      }

      return {
        actorId: user.clientId,
        source: "client_admin",
        email: user.email,
        displayName: user.displayName,
        passwordHash: user.passwordHash,
        role: "admin"
      };
    },
    verifyPassword: state.passwordVerifier,
    buildAdminRedirectPath: (role) => role === "accountant" ? "/client/invoices_list.php" : "/admin",
    recordSuccessfulLogin: async (identity: AdminIdentity) => {
      state.loginEvents.push(identity.actorId);
    }
  };
}

function createPortalActorProfileDependencies(state: InMemoryPlatformState): PortalActorProfileDependencies {
  return {
    findPortalActorById: async (clientId) => {
      const actor = state.portalUsers.find((candidate) => candidate.clientId === clientId) ?? null;
      if (actor == null) {
        return null;
      }

      return {
        clientId: actor.clientId,
        email: actor.email,
        displayName: actor.displayName,
        archived: actor.archived
      };
    }
  };
}

function createAdminActorProfileDependencies(state: InMemoryPlatformState): AdminActorProfileDependencies {
  return {
    findAdminActorById: async (actorId) => {
      const adminUser = state.adminUsers.find((candidate) => candidate.actorId === actorId);
      if (adminUser != null) {
        return {
          actorId: adminUser.actorId,
          source: "admin_user",
          username: adminUser.username,
          displayName: adminUser.displayName,
          role: adminUser.role,
          active: adminUser.active
        };
      }

      const clientAdmin = state.portalUsers.find((candidate) => candidate.clientId === actorId && !candidate.archived);
      if (clientAdmin == null) {
        return null;
      }

      return {
        actorId: clientAdmin.clientId,
        source: "client_admin",
        email: clientAdmin.email,
        displayName: clientAdmin.displayName,
        role: "admin",
        active: true
      };
    }
  };
}

function createPortalSummaryDependencies(state: InMemoryPlatformState): PortalSummaryDependencies {
  return {
    listBookingsForPortalActor: async (clientId) => state.bookings.filter((booking) => booking.clientId === clientId),
    listInvoicesForPortalActor: async (clientId) => state.invoices.filter((invoice) => invoice.clientId === clientId && invoice.outstandingAmount > 0),
    listQuotesForPortalActor: async (clientId) => state.quotes.filter((quote) => quote.clientId === clientId && quote.status !== "accepted" && quote.status !== "declined")
  };
}

function createAdminDashboardDependencies(state: InMemoryPlatformState): AdminDashboardDependencies {
  return {
    countPendingBookings: async () => state.bookings.filter((booking) => booking.status === "pending").length,
    countTodaysBookings: async () => state.bookings.filter((booking) => booking.startsAt.slice(0, 10) === state.now().slice(0, 10)).length,
    countOverdueInvoices: async () => state.invoices.filter((invoice) => invoice.status === "overdue").length,
    countActiveClients: async () => state.portalUsers.filter((user) => !user.archived).length,
    listRecentBookings: async () =>
      [...state.bookings]
        .sort((left, right) => right.startsAt.localeCompare(left.startsAt))
        .slice(0, 5)
  };
}

function createAdminOperationsDependencies(state: InMemoryPlatformState): AdminOperationsDependencies {
  function toQueuedJobLog(job: JobEnvelope) {
    return {
      jobId: job.jobId,
      kind: job.kind,
      scheduledFor: job.scheduledFor,
      status: "queued" as const,
      processedAt: null,
      summary: null,
      payload: job.payload
    };
  }

  function toHistoricalJobLog(entry: InMemoryPlatformState["jobHistory"][number]) {
    return {
      jobId: entry.job.jobId,
      kind: entry.job.kind,
      scheduledFor: entry.job.scheduledFor,
      status: entry.status,
      processedAt: entry.processedAt,
      summary: entry.summary,
      payload: entry.job.payload
    };
  }

  return {
    listAdminJobLogs: async () => [
      ...state.queuedJobs.map(toQueuedJobLog),
      ...state.jobHistory.map(toHistoricalJobLog)
    ],
    findAdminJobLogById: async (jobId) => {
      const queued = state.queuedJobs.find((job) => job.jobId === jobId);
      if (queued != null) {
        return toQueuedJobLog(queued);
      }

      const historical = state.jobHistory.find((entry) => entry.job.jobId === jobId);
      return historical == null ? null : toHistoricalJobLog(historical);
    },
    listAdminIntegrationCallbackLogs: async () => state.integrationCallbacks,
    findAdminIntegrationCallbackLogById: async (callbackId) => (
      state.integrationCallbacks.find((record) => record.callbackId === callbackId) ?? null
    )
  };
}

function createAdminConfigurationDependencies(state: InMemoryPlatformState): AdminConfigurationDependencies {
  let appointmentTypeSequence = state.appointmentTypes.length;
  let formTemplateSequence = state.formTemplates.length;
  let emailTemplateSequence = state.emailTemplates.length;
  let scheduledTaskSequence = state.scheduledTasks.length;

  function nextAppointmentTypeId(): string {
    appointmentTypeSequence += 1;
    return `appointment-type-${appointmentTypeSequence}`;
  }

  function nextEmailTemplateId(): string {
    emailTemplateSequence += 1;
    return `email-template-${emailTemplateSequence}`;
  }

  function nextFormTemplateId(): string {
    formTemplateSequence += 1;
    return `form-template-${formTemplateSequence}`;
  }

  function nextScheduledTaskId(): string {
    scheduledTaskSequence += 1;
    return `scheduled-task-${scheduledTaskSequence}`;
  }

  function toAppointmentType(item: InMemoryAppointmentType): AppointmentType {
    return {
      id: item.id,
      name: item.name,
      description: item.description ?? "",
      bulletPoints: item.bulletPoints ?? [],
      adminUserId: item.adminUserId ?? null,
      durationMinutes: item.durationMinutes ?? 60,
      bufferBeforeMinutes: item.bufferBeforeMinutes ?? 0,
      bufferAfterMinutes: item.bufferAfterMinutes ?? 0,
      useTravelTimeBuffer: item.useTravelTimeBuffer ?? false,
      travelTimeMinutes: item.travelTimeMinutes ?? 0,
      advanceBookingMinDays: item.advanceBookingMinDays ?? 1,
      advanceBookingMaxDays: item.advanceBookingMaxDays ?? 90,
      cancellationNoticeHours: item.cancellationNoticeHours ?? 0,
      requiresForms: item.requiresForms ?? false,
      formTemplateIds: item.formTemplateIds ?? [],
      requiresContract: item.requiresContract ?? false,
      contractTemplateId: item.contractTemplateId ?? null,
      autoInvoice: item.autoInvoice ?? false,
      invoiceDueDays: item.invoiceDueDays ?? 7,
      invoiceDueTiming: item.invoiceDueTiming ?? "after",
      defaultAmount: item.defaultAmount ?? 0,
      consumesCredits: item.consumesCredits ?? false,
      creditCount: item.creditCount ?? 1,
      isGroupClass: item.isGroupClass ?? false,
      maxParticipants: item.maxParticipants ?? 1,
      publicAvailable: item.publicAvailable ?? false,
      portalAvailable: item.portalAvailable ?? false,
      scheduleType: item.scheduleType ?? "recurring",
      specificDate: item.specificDate ?? null,
      specificDates: item.specificDates ?? [],
      availableDays: item.availableDays ?? [0, 1, 2, 3, 4, 5, 6],
      availableStartTime: item.availableStartTime ?? "09:00",
      availableEndTime: item.availableEndTime ?? "17:00",
      timeSlotInterval: item.timeSlotInterval ?? 30,
      perDaySchedule: item.perDaySchedule ?? {},
      isMiniSession: item.isMiniSession ?? false,
      miniSessionLocation: item.miniSessionLocation ?? "",
      miniSessionTopic: item.miniSessionTopic ?? "",
      isFieldRental: item.isFieldRental ?? false,
      fieldRentalLocation: item.fieldRentalLocation ?? "",
      groupClassLocation: item.groupClassLocation ?? "",
      locationTypes: item.locationTypes ?? [],
      confirmationTemplateId: item.confirmationTemplateId ?? null,
      bookingRequestTemplateId: item.bookingRequestTemplateId ?? null,
      invoiceTemplateId: item.invoiceTemplateId ?? null,
      reminderTemplateId: item.reminderTemplateId ?? null,
      cancellationTemplateId: item.cancellationTemplateId ?? null,
      requiresAdminConfirmation: item.requiresAdminConfirmation ?? false,
      usesResource: item.usesResource ?? false,
      resourceName: item.resourceName ?? "",
      resourceCapacity: item.resourceCapacity ?? 1,
      resourceAllocation: item.resourceAllocation ?? "per_appointment",
      uniqueLink: item.uniqueLink ?? item.id,
      active: item.active !== false,
      createdAt: item.createdAt ?? state.now(),
      updatedAt: item.updatedAt ?? state.now()
    };
  }

  function toEmailTemplate(item: InMemoryWorkflowEmailTemplate & { createdAt?: string | null; updatedAt?: string | null }): EmailTemplate {
    return {
      id: item.id,
      name: item.name,
      templateType: item.templateType ?? "other",
      subject: item.subject,
      bodyHtml: item.bodyHtml,
      bodyText: item.bodyText,
      active: item.active,
      createdAt: item.createdAt ?? state.now(),
      updatedAt: item.updatedAt ?? state.now()
    };
  }

  function toScheduledTask(item: InMemoryScheduledTask): ScheduledTask {
    return {
      id: item.id,
      name: item.name ?? item.taskType,
      taskType: item.taskType,
      scheduleType: item.scheduleType ?? "hourly",
      scheduleValue: item.scheduleValue ?? "",
      active: item.active,
      lastRunAt: item.lastRunAt ?? null,
      nextRunAt: item.nextRunAt ?? null
    };
  }

  function toFormTemplate(item: FormTemplate): FormTemplate {
    return {
      id: item.id,
      name: item.name,
      active: item.active,
      description: item.description ?? "",
      fields: item.fields ?? [],
      formType: item.formType ?? "client_form",
      requiredFrequency: item.requiredFrequency ?? null,
      appointmentTypeId: item.appointmentTypeId ?? null,
      templateIsInternal: item.templateIsInternal ?? false,
      templateShowInClientPortal: item.templateShowInClientPortal ?? true
    };
  }

  return {
    listAdminAppointmentTypes: async () => [...state.appointmentTypes]
      .map((item) => toAppointmentType(item))
      .sort((left, right) => (
        Number(right.active) - Number(left.active) || left.name.localeCompare(right.name)
      )),
    findAdminAppointmentTypeById: async (appointmentTypeId) => {
      const item = state.appointmentTypes.find((candidate) => candidate.id === appointmentTypeId);
      return item == null ? null : toAppointmentType(item);
    },
    createAdminAppointmentType: async (_adminUserId, input) => {
      const createdAt = state.now();
      const item: InMemoryAppointmentType = {
        ...input,
        id: nextAppointmentTypeId(),
        createdAt,
        updatedAt: createdAt
      };
      state.appointmentTypes.push(item);
      return toAppointmentType(item);
    },
    updateAdminAppointmentType: async (appointmentTypeId, _adminUserId, input) => {
      const index = state.appointmentTypes.findIndex((candidate) => candidate.id === appointmentTypeId);
      if (index < 0) {
        return null;
      }

      const current = state.appointmentTypes[index];
      const updated: InMemoryAppointmentType = {
        ...current,
        ...input,
        id: appointmentTypeId,
        createdAt: current.createdAt ?? state.now(),
        updatedAt: state.now()
      };
      state.appointmentTypes[index] = updated;
      return toAppointmentType(updated);
    },
    deleteAdminAppointmentType: async (appointmentTypeId) => {
      const next = state.appointmentTypes.filter((candidate) => candidate.id !== appointmentTypeId);
      if (next.length === state.appointmentTypes.length) {
        return false;
      }

      state.appointmentTypes = next;
      return true;
    },
    listAdminFormTemplates: async () => [...state.formTemplates]
      .map((item) => toFormTemplate(item))
      .sort((left, right) => (
        Number(right.active) - Number(left.active) || left.name.localeCompare(right.name)
      )),
    findAdminFormTemplateById: async (templateId) => {
      const item = state.formTemplates.find((candidate) => candidate.id === templateId);
      return item == null ? null : toFormTemplate(item);
    },
    createAdminFormTemplate: async (_adminUserId, input) => {
      const item: FormTemplate = {
        id: nextFormTemplateId(),
        name: input.name,
        active: input.active,
        description: input.description,
        fields: input.fields,
        formType: input.formType,
        requiredFrequency: input.requiredFrequency,
        appointmentTypeId: input.appointmentTypeId,
        templateIsInternal: input.templateIsInternal,
        templateShowInClientPortal: input.templateShowInClientPortal
      };
      state.formTemplates.push(item);
      return toFormTemplate(item);
    },
    updateAdminFormTemplate: async (templateId, _adminUserId, input) => {
      const index = state.formTemplates.findIndex((candidate) => candidate.id === templateId);
      if (index < 0) {
        return null;
      }

      const updated: FormTemplate = {
        id: templateId,
        name: input.name,
        active: input.active,
        description: input.description,
        fields: input.fields,
        formType: input.formType,
        requiredFrequency: input.requiredFrequency,
        appointmentTypeId: input.appointmentTypeId,
        templateIsInternal: input.templateIsInternal,
        templateShowInClientPortal: input.templateShowInClientPortal
      };
      state.formTemplates[index] = updated;
      return toFormTemplate(updated);
    },
    countAdminFormTemplateSubmissions: async (templateId) => (
      state.formSubmissions.filter((submission) => submission.templateId === templateId).length
    ),
    deleteAdminFormTemplate: async (templateId) => {
      const next = state.formTemplates.filter((candidate) => candidate.id !== templateId);
      if (next.length === state.formTemplates.length) {
        return false;
      }

      state.formTemplates = next;
      state.appointmentTypes = state.appointmentTypes.map((appointmentType) => ({
        ...appointmentType,
        formTemplateIds: (appointmentType.formTemplateIds ?? []).filter((id) => id !== templateId)
      }));
      state.workflowTriggers = state.workflowTriggers.filter((trigger) => trigger.formTemplateId !== templateId);
      return true;
    },
    listAdminEmailTemplates: async () => [...state.emailTemplates]
      .map((item) => toEmailTemplate(item))
      .sort((left, right) => left.name.localeCompare(right.name)),
    findAdminEmailTemplateById: async (templateId) => {
      const item = state.emailTemplates.find((candidate) => candidate.id === templateId);
      return item == null ? null : toEmailTemplate(item);
    },
    createAdminEmailTemplate: async (_adminUserId, input) => {
      const createdAt = state.now();
      const item: InMemoryWorkflowEmailTemplate = {
        id: nextEmailTemplateId(),
        name: input.name,
        templateType: input.templateType,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
        active: input.active,
        createdAt,
        updatedAt: createdAt
      };
      state.emailTemplates.push(item);
      return toEmailTemplate(item);
    },
    updateAdminEmailTemplate: async (templateId, _adminUserId, input) => {
      const index = state.emailTemplates.findIndex((candidate) => candidate.id === templateId);
      if (index < 0) {
        return null;
      }

      const current = state.emailTemplates[index];
      const updated: InMemoryWorkflowEmailTemplate = {
        ...current,
        id: templateId,
        name: input.name,
        templateType: input.templateType,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
        active: input.active,
        createdAt: current.createdAt ?? state.now(),
        updatedAt: state.now()
      };
      state.emailTemplates[index] = updated;
      return toEmailTemplate(updated);
    },
    listAdminScheduledTasks: async () => [...state.scheduledTasks]
      .map((item) => toScheduledTask(item))
      .sort((left, right) => left.name.localeCompare(right.name)),
    findAdminScheduledTaskById: async (taskId) => {
      const item = state.scheduledTasks.find((candidate) => candidate.id === taskId);
      return item == null ? null : toScheduledTask(item);
    },
    createAdminScheduledTask: async (_adminUserId, input) => {
      const item: InMemoryScheduledTask = {
        id: nextScheduledTaskId(),
        name: input.name,
        taskType: input.taskType,
        scheduleType: input.scheduleType,
        scheduleValue: input.scheduleValue,
        active: input.active,
        lastRunAt: null,
        nextRunAt: null
      };
      state.scheduledTasks.push(item);
      return toScheduledTask(item);
    },
    updateAdminScheduledTask: async (taskId, _adminUserId, input) => {
      const index = state.scheduledTasks.findIndex((candidate) => candidate.id === taskId);
      if (index < 0) {
        return null;
      }

      const current = state.scheduledTasks[index];
      const updated: InMemoryScheduledTask = {
        ...current,
        id: taskId,
        name: input.name,
        taskType: input.taskType,
        scheduleType: input.scheduleType,
        scheduleValue: input.scheduleValue,
        active: input.active
      };
      state.scheduledTasks[index] = updated;
      return toScheduledTask(updated);
    }
  };
}

function createContentManagementDependencies(state: InMemoryPlatformState): ContentManagementDependencies {
  let blogSequence = state.blogPosts.length;
  let pageSequence = state.sitePages.length;
  let adminSequence = state.adminUsers.length;

  function nextBlogId(): string {
    blogSequence += 1;
    return `blog-${blogSequence}`;
  }

  function nextPageId(): string {
    pageSequence += 1;
    return `page-${pageSequence}`;
  }

  function nextAdminId(): string {
    adminSequence += 1;
    return `admin-${adminSequence}`;
  }

  function sortBlogPosts(items: BlogPost[]): BlogPost[] {
    return [...items].sort((left, right) => {
      const leftKey = left.publishDate ?? left.createdAt;
      const rightKey = right.publishDate ?? right.createdAt;
      return rightKey.localeCompare(leftKey);
    });
  }

  function sortSitePages(items: SitePage[]): SitePage[] {
    return [...items].sort((left, right) => (
      left.sortOrder === right.sortOrder
        ? left.title.localeCompare(right.title)
        : left.sortOrder - right.sortOrder
    ));
  }

  function sortSettings(items: Setting[]): Setting[] {
    return [...items].sort((left, right) => {
      const categoryComparison = left.category.localeCompare(right.category);
      return categoryComparison !== 0 ? categoryComparison : left.label.localeCompare(right.label);
    });
  }

  function normalizeAdminSettingsUser(user: InMemoryAdminUser) {
    const isMainAccount = user.isMainAccount ?? (
      user.role === "owner"
      || user.accountType === "main"
      || user.username.toLowerCase() === "admin"
    );
    const accountType = isMainAccount
      ? "main"
      : (user.accountType ?? (user.role === "accountant" ? "accountant" : "standard"));
    const role = isMainAccount
      ? "owner"
      : (accountType === "accountant" ? "accountant" : user.role === "staff" ? "staff" : "admin");
    const isAccountant = accountType === "accountant" || role === "accountant";

    return {
      actorId: user.actorId,
      username: user.username,
      email: user.email ?? `${user.username}@example.com`,
      accountType,
      role,
      isMainAccount,
      canManageAdminUsers: isMainAccount ? true : isAccountant ? false : (user.canManageAdminUsers ?? false),
      canManageApiKeys: isMainAccount ? true : isAccountant ? false : (user.canManageApiKeys ?? false),
      active: user.active
    } as const;
  }

  function sortAdminSettingsUsers(items: InMemoryAdminUser[]) {
    return [...items]
      .map((item) => normalizeAdminSettingsUser(item))
      .sort((left, right) => {
        if (left.isMainAccount !== right.isMainAccount) {
          return left.isMainAccount ? -1 : 1;
        }

        const usernameComparison = left.username.localeCompare(right.username);
        return usernameComparison !== 0 ? usernameComparison : left.email.localeCompare(right.email);
      });
  }

  function normalizeBlogPost(id: string, input: Omit<BlogPost, "id" | "createdAt" | "updatedAt">, createdAt: string): BlogPost {
    return {
      id,
      title: input.title,
      slug: input.slug,
      content: input.content,
      excerpt: input.excerpt,
      coverPhoto: input.coverPhoto,
      author: input.author,
      published: input.published,
      publishDate: input.publishDate,
      createdAt,
      updatedAt: state.now()
    };
  }

  function normalizeSitePage(
    id: string,
    adminUserId: string,
    input: Omit<SitePage, "id" | "updatedByAdminUserId" | "createdAt" | "updatedAt">,
    createdAt: string
  ): SitePage {
    return {
      id,
      slug: input.slug,
      title: input.title,
      htmlContent: input.htmlContent,
      cssContent: input.cssContent,
      metaDescription: input.metaDescription,
      metaKeywords: input.metaKeywords,
      ogTitle: input.ogTitle,
      ogDescription: input.ogDescription,
      ogImage: input.ogImage,
      isHomepage: input.isHomepage,
      published: input.published,
      sortOrder: input.sortOrder,
      updatedByAdminUserId: adminUserId,
      createdAt,
      updatedAt: state.now()
    };
  }

  function ensureSingleHomepage(pageId: string): void {
    state.sitePages = state.sitePages.map((page) => (
      page.id === pageId || !page.isHomepage
        ? page
        : { ...page, isHomepage: false, updatedAt: state.now() }
    ));
  }

  function clearAdminAssignments(actorId: string): void {
    state.appointmentTypes = state.appointmentTypes.map((item) => item.adminUserId === actorId ? {
      ...item,
      adminUserId: null
    } : item);
    state.bookings = state.bookings.map((item) => item.adminUserId === actorId ? {
      ...item,
      adminUserId: null
    } : item);
  }

  return {
    now: state.now,
    listPublicBlogPosts: async () => sortBlogPosts(state.blogPosts.filter((post) => post.published)),
    findPublicBlogPostBySlug: async (slug) => (
      state.blogPosts.find((post) => post.slug === slug && post.published) ?? null
    ),
    findPublicSitePageBySlug: async (slug) => {
      if (slug == null) {
        return state.sitePages.find((page) => page.isHomepage && page.published) ?? null;
      }

      return state.sitePages.find((page) => page.slug === slug && page.published) ?? null;
    },
    listAdminBlogPosts: async () => sortBlogPosts(state.blogPosts),
    findAdminBlogPostById: async (postId) => state.blogPosts.find((post) => post.id === postId) ?? null,
    createAdminBlogPost: async (input) => {
      const createdAt = state.now();
      const item = normalizeBlogPost(nextBlogId(), input, createdAt);
      state.blogPosts.push(item);
      return item;
    },
    updateAdminBlogPost: async (postId, input) => {
      const index = state.blogPosts.findIndex((post) => post.id === postId);
      if (index < 0) {
        return null;
      }

      const current = state.blogPosts[index];
      const updated = normalizeBlogPost(postId, input, current.createdAt);
      state.blogPosts[index] = updated;
      return updated;
    },
    deleteAdminBlogPost: async (postId) => {
      const next = state.blogPosts.filter((post) => post.id !== postId);
      if (next.length === state.blogPosts.length) {
        return false;
      }

      state.blogPosts = next;
      return true;
    },
    listAdminSitePages: async () => sortSitePages(state.sitePages),
    findAdminSitePageById: async (pageId) => state.sitePages.find((page) => page.id === pageId) ?? null,
    createAdminSitePage: async (adminUserId, input) => {
      const createdAt = state.now();
      const item = normalizeSitePage(nextPageId(), adminUserId, input, createdAt);
      state.sitePages.push(item);
      if (item.isHomepage) {
        ensureSingleHomepage(item.id);
      }
      return item;
    },
    updateAdminSitePage: async (pageId, adminUserId, input) => {
      const index = state.sitePages.findIndex((page) => page.id === pageId);
      if (index < 0) {
        return null;
      }

      const current = state.sitePages[index];
      const updated = normalizeSitePage(pageId, adminUserId, input, current.createdAt);
      state.sitePages[index] = updated;
      if (updated.isHomepage) {
        ensureSingleHomepage(pageId);
      }
      return updated;
    },
    deleteAdminSitePage: async (pageId) => {
      const next = state.sitePages.filter((page) => page.id !== pageId);
      if (next.length === state.sitePages.length) {
        return false;
      }

      state.sitePages = next;
      return true;
    },
    listAdminSettings: async () => sortSettings(state.settings),
    findAdminSettingByKey: async (key) => state.settings.find((setting) => setting.key === key) ?? null,
    updateAdminSetting: async (key, input) => {
      const index = state.settings.findIndex((setting) => setting.key === key);
      if (index < 0) {
        return null;
      }

      const updated: Setting = {
        ...state.settings[index],
        value: input.value,
        updatedAt: state.now()
      };
      state.settings[index] = updated;
      return updated;
    },
    findAdminSettingsUserByActorId: async (actorId) => {
      const item = state.adminUsers.find((candidate) => candidate.actorId === actorId);
      return item == null ? null : normalizeAdminSettingsUser(item);
    },
    listAdminSettingsUsers: async () => sortAdminSettingsUsers(state.adminUsers),
    findAdminSettingsUserByUsername: async (username) => {
      const normalizedUsername = username.trim().toLowerCase();
      const item = state.adminUsers.find((candidate) => candidate.username.trim().toLowerCase() === normalizedUsername);
      return item == null ? null : normalizeAdminSettingsUser(item);
    },
    createAdminSettingsUser: async (input) => {
      const created: InMemoryAdminUser = {
        actorId: nextAdminId(),
        username: input.username,
        displayName: input.username,
        email: input.email,
        passwordHash: input.password,
        role: input.accountType === "accountant" ? "accountant" : "admin",
        accountType: input.accountType,
        canManageAdminUsers: false,
        canManageApiKeys: false,
        active: true
      };
      state.adminUsers.push(created);
      return normalizeAdminSettingsUser(created);
    },
    updateAdminSettingsUserPermissions: async (actorId, input) => {
      const index = state.adminUsers.findIndex((candidate) => candidate.actorId === actorId);
      if (index < 0) {
        return null;
      }

      const current = state.adminUsers[index];
      const updated: InMemoryAdminUser = {
        ...current,
        canManageAdminUsers: input.canManageAdminUsers,
        canManageApiKeys: input.canManageApiKeys
      };
      state.adminUsers[index] = updated;
      return normalizeAdminSettingsUser(updated);
    },
    deleteAdminSettingsUser: async (actorId) => {
      const next = state.adminUsers.filter((candidate) => candidate.actorId !== actorId);
      if (next.length === state.adminUsers.length) {
        return false;
      }

      clearAdminAssignments(actorId);
      state.adminUsers = next;
      return true;
    }
  };
}

function createAchievementDependencies(state: InMemoryPlatformState): AchievementDependencies {
  return {
    listPortalAchievements: async (clientId) => state.clientAchievements.filter((achievement) => achievement.clientId === clientId),
    findPortalAchievementById: async (clientId, achievementId) => (
      state.clientAchievements.find((achievement) => achievement.clientId === clientId && achievement.id === achievementId) ?? null
    ),
    listAdminAchievementTypes: async () => state.achievementTypes.filter((item) => item.active),
    findAdminAchievementTypeById: async (achievementTypeId) => (
      state.achievementTypes.find((item) => item.id === achievementTypeId) ?? null
    ),
    listAdminClientAchievements: async (clientId) => state.clientAchievements.filter((achievement) => achievement.clientId === clientId),
    findAdminClientAchievementById: async (clientId, achievementId) => (
      state.clientAchievements.find((achievement) => achievement.clientId === clientId && achievement.id === achievementId) ?? null
    ),
    buildAchievementCertificateHtml: async (achievement, options) => renderAchievementCertificateHtml(achievement, options),
    buildPortalCertificateBackPath: () => "/portal/achievements",
    buildAdminCertificateBackPath: (clientId) => `/client/client_achievements.php?client_id=${encodeURIComponent(clientId)}`
  };
}

function toClientRecord(user: InMemoryPortalUser) {
  const [firstName, ...rest] = user.displayName.trim().split(/\s+/);
  return {
    id: user.clientId,
    email: user.email,
    firstName: firstName || user.displayName,
    lastName: rest.join(" ") || firstName || user.displayName,
    archived: user.archived
  };
}

function toClientProfile(user: InMemoryPortalUser): ClientProfile {
  return {
    id: user.clientId,
    name: user.displayName,
    email: user.email,
    phone: user.phone ?? "",
    address: user.address ?? "",
    notes: user.notes ?? "",
    isAdmin: user.isAdmin ?? false,
    archived: user.archived
  };
}

function createClientProfileDependencies(state: InMemoryPlatformState): ClientProfileDependencies {
  async function isClientEmailInUse(email: string, excludeClientId: string | null): Promise<boolean> {
    return state.portalUsers.some((user) => user.email === email && user.clientId !== excludeClientId);
  }

  let sequence = state.portalUsers.length;

  return {
    findPortalProfile: async (clientId) => {
      const user = state.portalUsers.find((candidate) => candidate.clientId === clientId) ?? null;
      return user == null ? null : toClientProfile(user);
    },
    verifyPortalCurrentPassword: async (clientId, currentPassword) => {
      const user = state.portalUsers.find((candidate) => candidate.clientId === clientId) ?? null;
      if (user == null) {
        return false;
      }

      return state.passwordVerifier(currentPassword, user.passwordHash);
    },
    updatePortalProfile: async (clientId, input) => {
      const index = state.portalUsers.findIndex((candidate) => candidate.clientId === clientId);
      if (index < 0) {
        return null;
      }

      const current = state.portalUsers[index];
      const updated: InMemoryPortalUser = {
        ...current,
        displayName: input.name,
        email: input.email,
        phone: input.phone,
        address: input.address,
        passwordHash: input.newPassword ?? current.passwordHash
      };
      state.portalUsers[index] = updated;
      return toClientProfile(updated);
    },
    findAdminClientProfile: async (clientId) => {
      const user = state.portalUsers.find((candidate) => candidate.clientId === clientId) ?? null;
      return user == null ? null : toClientProfile(user);
    },
    createAdminClientProfile: async (input) => {
      sequence += 1;
      const user: InMemoryPortalUser = {
        clientId: `client-${sequence}`,
        email: input.email,
        displayName: input.name,
        passwordHash: "",
        phone: input.phone,
        address: input.address,
        notes: input.notes,
        isAdmin: input.isAdmin,
        archived: false
      };
      state.portalUsers.push(user);
      return toClientProfile(user);
    },
    updateAdminClientProfile: async (clientId, input) => {
      const index = state.portalUsers.findIndex((candidate) => candidate.clientId === clientId);
      if (index < 0) {
        return null;
      }

      const updated: InMemoryPortalUser = {
        ...state.portalUsers[index],
        displayName: input.name,
        email: input.email,
        phone: input.phone,
        address: input.address,
        notes: input.notes,
        isAdmin: input.isAdmin
      };
      state.portalUsers[index] = updated;
      return toClientProfile(updated);
    },
    isClientEmailInUse
  };
}

function createContactManagementDependencies(state: InMemoryPlatformState): ContactManagementDependencies {
  let sequence = state.contacts.length;

  function nextId(): string {
    sequence += 1;
    return `contact-${sequence}`;
  }

  function normalizeContact(
    clientId: string,
    input: { name: string; email: string; phone: string; isPrimary: boolean },
    id: string
  ): ClientContact {
    return {
      id,
      clientId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      isPrimary: input.isPrimary
    };
  }

  function clearPrimary(clientId: string, exceptId: string | null = null): void {
    for (let index = 0; index < state.contacts.length; index += 1) {
      const contact = state.contacts[index];
      if (contact?.clientId !== clientId) {
        continue;
      }
      if (exceptId != null && contact.id === exceptId) {
        continue;
      }
      if (contact.isPrimary) {
        state.contacts[index] = {
          ...contact,
          isPrimary: false
        };
      }
    }
  }

  return {
    listPortalContacts: async (clientId) => state.contacts
      .filter((contact) => contact.clientId === clientId)
      .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || left.name.localeCompare(right.name)),
    findPortalContactById: async (clientId, contactId) => state.contacts
      .find((contact) => contact.clientId === clientId && contact.id === contactId) ?? null,
    createPortalContact: async (clientId, input) => {
      if (input.isPrimary) {
        clearPrimary(clientId);
      }
      const contact = normalizeContact(clientId, input, nextId());
      state.contacts.push(contact);
      return contact;
    },
    updatePortalContact: async (clientId, contactId, input) => {
      const index = state.contacts.findIndex((contact) => contact.clientId === clientId && contact.id === contactId);
      if (index < 0) {
        return null;
      }
      if (input.isPrimary) {
        clearPrimary(clientId, contactId);
      }
      const updated = normalizeContact(clientId, input, contactId);
      state.contacts[index] = updated;
      return updated;
    },
    deletePortalContact: async (clientId, contactId) => {
      const index = state.contacts.findIndex((contact) => contact.clientId === clientId && contact.id === contactId);
      if (index < 0) {
        return false;
      }
      state.contacts.splice(index, 1);
      return true;
    },
    listAdminClientContacts: async (clientId) => state.contacts
      .filter((contact) => contact.clientId === clientId)
      .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || left.name.localeCompare(right.name)),
    findAdminClientContactById: async (clientId, contactId) => state.contacts
      .find((contact) => contact.clientId === clientId && contact.id === contactId) ?? null,
    createAdminClientContact: async (clientId, input) => {
      if (input.isPrimary) {
        clearPrimary(clientId);
      }
      const contact = normalizeContact(clientId, input, nextId());
      state.contacts.push(contact);
      return contact;
    },
    updateAdminClientContact: async (clientId, contactId, input) => {
      const index = state.contacts.findIndex((contact) => contact.clientId === clientId && contact.id === contactId);
      if (index < 0) {
        return null;
      }
      if (input.isPrimary) {
        clearPrimary(clientId, contactId);
      }
      const updated = normalizeContact(clientId, input, contactId);
      state.contacts[index] = updated;
      return updated;
    },
    deleteAdminClientContact: async (clientId, contactId) => {
      const index = state.contacts.findIndex((contact) => contact.clientId === clientId && contact.id === contactId);
      if (index < 0) {
        return false;
      }
      state.contacts.splice(index, 1);
      return true;
    }
  };
}

function createPetFileManagementDependencies(state: InMemoryPlatformState): PetFileManagementDependencies {
  let idSequence = state.petFiles.length;
  let fileSequence = state.petFiles.length;

  function nextId(): string {
    idSequence += 1;
    return `pet-file-${idSequence}`;
  }

  function nextStoredFileName(petId: string, fileExtension: string): string {
    fileSequence += 1;
    return `pet_${petId}_${fileSequence}.${fileExtension}`;
  }

  return {
    now: state.now,
    createPortalPetFile: async (clientId, petId, input) => {
      if (!state.pets.some((pet) => pet.clientId === clientId && pet.id === petId)) {
        return null;
      }

      const item: PetFile = {
        id: nextId(),
        petId,
        fileType: input.fileType,
        fileName: nextStoredFileName(petId, input.fileExtension),
        originalName: input.originalName,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        description: input.description,
        uploadedByAdminUserId: null,
        uploadedAt: input.uploadedAt
      };

      state.petFiles.push(item);
      state.petFileContents[item.id] = input.content;
      return item;
    },
    createAdminPetFile: async (petId, input) => {
      if (!state.pets.some((pet) => pet.id === petId)) {
        return null;
      }

      const item: PetFile = {
        id: nextId(),
        petId,
        fileType: input.fileType,
        fileName: nextStoredFileName(petId, input.fileExtension),
        originalName: input.originalName,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        description: input.description,
        uploadedByAdminUserId: input.uploadedByAdminUserId,
        uploadedAt: input.uploadedAt
      };

      state.petFiles.push(item);
      state.petFileContents[item.id] = input.content;
      return item;
    }
  };
}

function enrichInMemoryFormSubmission(state: InMemoryPlatformState, submission: FormSubmission): FormSubmission {
  const template = state.formTemplates.find((item) => item.id === submission.templateId) ?? null;
  const client = state.portalUsers.find((item) => item.clientId === submission.clientId) ?? null;
  const pet = submission.petId == null ? null : state.pets.find((item) => item.id === submission.petId) ?? null;
  const booking = submission.bookingId == null ? null : state.bookings.find((item) => item.id === submission.bookingId) ?? null;
  const appointmentType = booking == null ? null : state.appointmentTypes.find((item) => item.id === booking.serviceId) ?? null;
  const submittedByAdmin = submission.submittedByAdminUserId == null
    ? null
    : state.adminUsers.find((item) => item.actorId === submission.submittedByAdminUserId) ?? null;
  const reviewedByAdmin = submission.reviewedByAdminUserId == null
    ? null
    : state.adminUsers.find((item) => item.actorId === submission.reviewedByAdminUserId) ?? null;
  const status = submission.status ?? (submission.reviewedAt != null ? "reviewed" : submission.submittedAt == null ? "pending" : "submitted");

  return {
    ...submission,
    clientName: submission.clientName ?? client?.displayName ?? null,
    bookingSummary: submission.bookingSummary ?? (
      booking == null
        ? null
        : [appointmentType?.name ?? booking.serviceId, booking.startsAt].filter((item) => item != null && item !== "").join(" - ")
    ),
    petName: submission.petName ?? pet?.name ?? null,
    templateName: submission.templateName ?? template?.name ?? null,
    templateDescription: submission.templateDescription ?? template?.description ?? null,
    templateFields: submission.templateFields ?? template?.fields ?? [],
    formType: submission.formType ?? template?.formType,
    templateIsInternal: submission.templateIsInternal ?? template?.templateIsInternal,
    templateShowInClientPortal: submission.templateShowInClientPortal ?? template?.templateShowInClientPortal,
    status,
    submittedByName: submission.submittedByName ?? submittedByAdmin?.displayName ?? submittedByAdmin?.username ?? null,
    reviewedByName: submission.reviewedByName ?? reviewedByAdmin?.displayName ?? reviewedByAdmin?.username ?? null,
    notes: submission.notes ?? "",
    contactName: submission.contactName ?? client?.displayName ?? null,
    contactEmail: submission.contactEmail ?? client?.email ?? null,
    contactPhone: submission.contactPhone ?? client?.phone ?? null,
    responses: submission.responses ?? []
  };
}

function createPortalResourceReadDependencies(state: InMemoryPlatformState): PortalResourceReadDependencies {
  function toBase64Content(content: string | Uint8Array): string {
    return Buffer.from(content).toString("base64");
  }

  function portalPackageIds(clientId: string): Set<string> {
    return new Set(
      state.credits
        .filter((credit) => credit.clientId === clientId && credit.packageId != null)
        .map((credit) => credit.packageId as string)
    );
  }

  return {
    listPortalBookings: async (clientId) => state.bookings.filter((booking) => booking.clientId === clientId),
    findPortalBookingById: async (clientId, bookingId) => state.bookings.find((booking) => booking.clientId === clientId && booking.id === bookingId) ?? null,
    listPortalPets: async (clientId) => state.pets.filter((pet) => pet.clientId === clientId),
    findPortalPetById: async (clientId, petId) => state.pets.find((pet) => pet.clientId === clientId && pet.id === petId) ?? null,
    listPortalPetFiles: async (clientId, petId) => (
      state.pets.some((pet) => pet.clientId === clientId && pet.id === petId)
        ? state.petFiles.filter((file) => file.petId === petId)
        : []
    ),
    findPortalPetFileById: async (clientId, petId, fileId) => (
      state.pets.some((pet) => pet.clientId === clientId && pet.id === petId)
        ? state.petFiles.find((file) => file.petId === petId && file.id === fileId) ?? null
        : null
    ),
    loadPortalPetFileContent: async (clientId, petId, fileId, download) => {
      if (!state.pets.some((pet) => pet.clientId === clientId && pet.id === petId)) {
        return null;
      }

      const item = state.petFiles.find((file) => file.petId === petId && file.id === fileId) ?? null;
      if (item == null) {
        return null;
      }

      const content = state.petFileContents[fileId];
      if (content == null) {
        return null;
      }

      return {
        item,
        fileName: item.originalName,
        disposition: download ? "attachment" as const : "inline" as const,
        contentBase64: toBase64Content(content)
      };
    },
    deletePortalPetFile: async (clientId, petId, fileId) => {
      if (!state.pets.some((pet) => pet.clientId === clientId && pet.id === petId)) {
        return false;
      }

      const next = state.petFiles.filter((file) => !(file.petId === petId && file.id === fileId));
      if (next.length === state.petFiles.length) {
        return false;
      }

      state.petFiles = next;
      delete state.petFileContents[fileId];
      return true;
    },
    listPortalInvoices: async (clientId) => state.invoices.filter((invoice) => invoice.clientId === clientId),
    findPortalInvoiceById: async (clientId, invoiceId) => state.invoices.find((invoice) => invoice.clientId === clientId && invoice.id === invoiceId) ?? null,
    listPortalQuotes: async (clientId) => state.quotes.filter((quote) => quote.clientId === clientId),
    findPortalQuoteById: async (clientId, quoteId) => state.quotes.find((quote) => quote.clientId === clientId && quote.id === quoteId) ?? null,
      listPortalContracts: async (clientId) => state.contracts.filter((contract) => contract.clientId === clientId),
      findPortalContractById: async (clientId, contractId) => state.contracts.find((contract) => contract.clientId === clientId && contract.id === contractId) ?? null,
      listPortalForms: async (clientId) => state.formSubmissions.filter((submission) => submission.clientId === clientId),
      findPortalFormById: async (clientId, formId) => {
        const submission = state.formSubmissions.find((item) => item.clientId === clientId && item.id === formId) ?? null;
        return submission == null ? null : enrichInMemoryFormSubmission(state, submission);
      },
      listPortalNotifications: async (clientId) => state.notifications
        .filter((notification) => notification.clientId === clientId && notification.channel === "portal")
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      listPortalPackages: async (clientId) => {
        const packageIds = portalPackageIds(clientId);
        return state.packages.filter((item) => packageIds.has(item.id));
    },
    findPortalPackageById: async (clientId, packageId) => {
      const packageIds = portalPackageIds(clientId);
      return packageIds.has(packageId) ? state.packages.find((item) => item.id === packageId) ?? null : null;
    },
    listPortalCredits: async (clientId) => state.credits.filter((credit) => credit.clientId === clientId),
    findPortalCreditById: async (clientId, creditId) => state.credits.find((credit) => credit.clientId === clientId && credit.id === creditId) ?? null
  };
}

function createAdminResourceReadDependencies(state: InMemoryPlatformState): AdminResourceReadDependencies {
  function toBase64Content(content: string | Uint8Array): string {
    return Buffer.from(content).toString("base64");
  }

  return {
    listAdminClients: async () => state.portalUsers.map(toClientRecord),
    findAdminClientById: async (clientId) => {
      const user = state.portalUsers.find((candidate) => candidate.clientId === clientId) ?? null;
      return user == null ? null : toClientRecord(user);
    },
    listAdminPets: async () => state.pets,
    findAdminPetById: async (petId) => state.pets.find((pet) => pet.id === petId) ?? null,
    listAdminPetFiles: async (petId) => state.petFiles.filter((file) => file.petId === petId),
    findAdminPetFileById: async (petId, fileId) => state.petFiles.find((file) => file.petId === petId && file.id === fileId) ?? null,
    loadAdminPetFileContent: async (petId, fileId, download) => {
      const item = state.petFiles.find((file) => file.petId === petId && file.id === fileId) ?? null;
      if (item == null) {
        return null;
      }

      const content = state.petFileContents[fileId];
      if (content == null) {
        return null;
      }

      return {
        item,
        fileName: item.originalName,
        disposition: download ? "attachment" as const : "inline" as const,
        contentBase64: toBase64Content(content)
      };
    },
  deleteAdminPetFile: async (petId, fileId) => {
    const next = state.petFiles.filter((file) => !(file.petId === petId && file.id === fileId));
    if (next.length === state.petFiles.length) {
      return false;
    }

    state.petFiles = next;
    delete state.petFileContents[fileId];
    return true;
  },
  listAdminBookings: async () => state.bookings,
  findAdminBookingById: async (bookingId) => state.bookings.find((booking) => booking.id === bookingId) ?? null,
  listAdminExpenses: async () => state.expenses,
  findAdminExpenseById: async (expenseId) => state.expenses.find((expense) => expense.id === expenseId) ?? null,
  listAdminInvoices: async () => state.invoices,
  findAdminInvoiceById: async (invoiceId) => state.invoices.find((invoice) => invoice.id === invoiceId) ?? null,
    listAdminQuotes: async () => state.quotes,
    findAdminQuoteById: async (quoteId) => state.quotes.find((quote) => quote.id === quoteId) ?? null,
    listAdminContracts: async () => state.contracts,
    findAdminContractById: async (contractId) => state.contracts.find((contract) => contract.id === contractId) ?? null,
    listAdminForms: async () => state.formSubmissions
      .map((submission) => enrichInMemoryFormSubmission(state, submission))
      .sort((left, right) => {
        const leftDate = left.submittedAt ?? "";
        const rightDate = right.submittedAt ?? "";
        return rightDate.localeCompare(leftDate) || right.id.localeCompare(left.id);
      }),
    listAdminFormsByTemplate: async (templateId) => state.formSubmissions
      .filter((submission) => submission.templateId === templateId)
      .map((submission) => enrichInMemoryFormSubmission(state, submission))
      .sort((left, right) => {
        const leftDate = left.submittedAt ?? "";
        const rightDate = right.submittedAt ?? "";
        return rightDate.localeCompare(leftDate) || right.id.localeCompare(left.id);
      }),
    findAdminFormById: async (formId) => {
      const submission = state.formSubmissions.find((item) => item.id === formId) ?? null;
      return submission == null ? null : enrichInMemoryFormSubmission(state, submission);
    },
    createAdminFormRequest: async (input) => {
      const template = state.formTemplates.find((item) => item.id === input.templateId && item.active) ?? null;
      const client = state.portalUsers.find((item) => item.clientId === input.clientId && !item.archived) ?? null;
      const booking = input.bookingId == null
        ? null
        : state.bookings.find((item) => item.id === input.bookingId) ?? null;
      const pet = input.petId == null
        ? null
        : state.pets.find((item) => item.id === input.petId) ?? null;

      if (template == null || client == null) {
        return null;
      }
      if (input.bookingId != null && booking == null) {
        return null;
      }
      if (input.petId != null && pet == null) {
        return null;
      }

      const issuedAt = state.now();
      const submission: FormSubmission = {
        id: `form-submission-${state.formSubmissions.length + 1}`,
        templateId: template.id,
        clientId: client.clientId,
        clientName: client.displayName,
        bookingId: booking?.id ?? null,
        petId: pet?.id ?? null,
        templateName: template.name,
        templateDescription: template.description ?? "",
        templateFields: template.fields ?? [],
        formType: template.formType,
        templateIsInternal: template.templateIsInternal,
        templateShowInClientPortal: template.templateShowInClientPortal,
        status: "pending",
        contactName: client.displayName,
        contactEmail: client.email,
        contactPhone: client.phone ?? null,
        responses: [],
        submittedAt: null,
        publicAccess: {
          token: `form-request-${state.formSubmissions.length + 1}-token`,
          issuedAt,
          expiresAt: null,
          legacySourceId: null
        }
      };

      state.formSubmissions.push(submission);
      return enrichInMemoryFormSubmission(state, submission);
    },
    reviewAdminForm: async (formId, adminUserId, notes) => {
      const index = state.formSubmissions.findIndex((item) => item.id === formId);
      if (index < 0) {
        return null;
      }

      const updated: FormSubmission = {
        ...state.formSubmissions[index],
        status: "reviewed",
        reviewedByAdminUserId: adminUserId,
        reviewedAt: state.now(),
        notes: notes.trim()
      };
      state.formSubmissions[index] = updated;
      return enrichInMemoryFormSubmission(state, updated);
    },
    unreviewAdminForm: async (formId) => {
      const index = state.formSubmissions.findIndex((item) => item.id === formId);
      if (index < 0) {
        return null;
      }

      const updated: FormSubmission = {
        ...state.formSubmissions[index],
        status: "submitted",
        reviewedByAdminUserId: null,
        reviewedAt: null
      };
      state.formSubmissions[index] = updated;
      return enrichInMemoryFormSubmission(state, updated);
    },
    listAdminPackages: async () => state.packages,
    findAdminPackageById: async (packageId) => state.packages.find((item) => item.id === packageId) ?? null,
    listAdminCredits: async () => state.credits,
    findAdminCreditById: async (creditId) => state.credits.find((item) => item.id === creditId) ?? null
  };
}

function createPortalCommerceDependencies(
  state: InMemoryPlatformState,
  workflowRuntime: InMemoryWorkflowRuntime
): PortalCommerceDependencies {
  return {
    acceptPortalQuote: async (clientId, quoteId) => {
      const index = state.quotes.findIndex((quote) => quote.clientId === clientId && quote.id === quoteId);
      if (index < 0) {
        return null;
      }

      const updated = {
        ...state.quotes[index],
        status: "accepted" as const,
        acceptedAt: state.now()
      };
      state.quotes[index] = updated;
      return updated;
    },
    signPortalContract: async (clientId, contractId) => {
      const index = state.contracts.findIndex((contract) => contract.clientId === clientId && contract.id === contractId);
      if (index < 0) {
        return null;
      }

      const updated = {
        ...state.contracts[index],
        status: "signed" as const,
        signedAt: state.now()
      };
      state.contracts[index] = updated;
      return updated;
    },
    submitPortalForm: async (clientId, formId) => {
      const index = state.formSubmissions.findIndex((submission) => submission.clientId === clientId && submission.id === formId);
      if (index < 0) {
        return null;
      }

      const alreadySubmitted = state.formSubmissions[index]?.submittedAt != null;

      const updated = {
        ...state.formSubmissions[index],
        status: "submitted",
        submittedAt: state.now()
      };
      state.formSubmissions[index] = updated;
      if (!alreadySubmitted) {
        workflowRuntime.applyFormSubmissionTriggers(updated);
      }
      return updated;
    },
    createInvoicePaymentSession: async (clientId, invoiceId, input) => {
      const invoice = state.invoices.find((candidate) => candidate.clientId === clientId && candidate.id === invoiceId) ?? null;
      if (invoice == null) {
        return null;
      }

      return {
        invoice,
        paymentSession: {
          provider: "stripe" as const,
          checkoutUrl: `${input.returnUrl}?invoice=${encodeURIComponent(invoiceId)}`,
          expiresAt: new Date(Date.parse(state.now()) + 60 * 60 * 1000).toISOString()
        }
      };
    }
  };
}

function buildGoogleCalendarUrl(booking: Booking): string {
  const startsAt = booking.startsAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const endsAt = booking.endsAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `BDTA Booking - ${booking.serviceId}`,
    dates: `${startsAt}/${endsAt}`,
    details: "Brook's Dog Training Academy booking"
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function createAdminCalendarSyncDependencies(state: InMemoryPlatformState): AdminCalendarSyncDependencies {
  return {
    async syncAdminBookingCalendar(bookingId) {
      const booking = state.bookings.find((candidate) => candidate.id === bookingId) ?? null;
      if (booking == null) {
        return null;
      }

      const syncedAt = state.now();
      const externalEventId = `google-calendar-${booking.id}-${syncedAt.slice(0, 10)}`;
      const externalEventUrl = buildGoogleCalendarUrl(booking);
      const existingIndex = state.calendarSyncs.findIndex((record) => record.bookingId === booking.id && record.provider === "google_calendar");
      const record = {
        bookingId: booking.id,
        provider: "google_calendar" as const,
        externalEventId,
        externalEventUrl,
        syncedAt
      };

      if (existingIndex >= 0) {
        state.calendarSyncs[existingIndex] = record;
      } else {
        state.calendarSyncs.push(record);
      }

      return {
        booking,
        provider: "google_calendar" as const,
        externalEventId,
        externalEventUrl,
        syncedAt
      };
    },
    async getAdminBookingCalendarSync(bookingId) {
      const booking = state.bookings.find((candidate) => candidate.id === bookingId) ?? null;
      const record = state.calendarSyncs.find((candidate) => (
        candidate.bookingId === bookingId
        && candidate.provider === "google_calendar"
      )) ?? null;

      if (booking == null || record == null) {
        return null;
      }

      return {
        booking,
        provider: "google_calendar" as const,
        externalEventId: record.externalEventId,
        externalEventUrl: record.externalEventUrl,
        syncedAt: record.syncedAt
      };
    }
  };
}

function createWorkflowManagementDependencies(
  state: InMemoryPlatformState,
  workflowRuntime: InMemoryWorkflowRuntime
): WorkflowManagementDependencies {
  function getWorkflowStatus(enrollment: WorkflowEnrollment): "active" | "completed" | "cancelled" {
    if (enrollment.status != null) {
      return enrollment.status;
    }
    return enrollment.completedAt == null ? "active" : "completed";
  }

  function toWorkflowStepItem(step: WorkflowStep): WorkflowStep {
    return {
      ...step,
      emailBodyText: step.emailBodyText ?? null,
      delayValue: step.delayValue ?? null,
      scheduledDate: step.scheduledDate ?? null,
      attachContractId: step.attachContractId ?? null,
      attachFormId: step.attachFormId ?? null,
      attachQuoteId: step.attachQuoteId ?? null,
      attachInvoiceId: step.attachInvoiceId ?? null,
      appointmentTypeId: step.appointmentTypeId ?? null
    };
  }

  function toWorkflowSummary(workflow: Workflow) {
    const enrollments = state.workflowEnrollments.filter((candidate) => candidate.workflowId === workflow.id);
    const triggerCount = state.workflowTriggers.filter((candidate) => candidate.workflowId === workflow.id).length;
    return {
      ...workflow,
      description: workflow.description ?? "",
      enrollmentCount: enrollments.length,
      activeEnrollmentCount: enrollments.filter((candidate) => getWorkflowStatus(candidate) === "active").length,
      triggerCount
    };
  }

  return {
    listAdminWorkflows: async () => [...state.workflows]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((workflow) => toWorkflowSummary(workflow)),
    findAdminWorkflowById: async (workflowId) => {
      const workflow = state.workflows.find((candidate) => candidate.id === workflowId) ?? null;
      return workflow == null ? null : {
        ...workflow,
        description: workflow.description ?? ""
      };
    },
    createAdminWorkflow: async (_adminUserId, input) => {
      const workflow: Workflow = {
        id: workflowRuntime.nextWorkflowId(),
        name: input.name,
        description: input.description,
        trigger: input.trigger,
        active: input.active,
        createdAt: state.now()
      };
      state.workflows.push(workflow);
      return workflow;
    },
    updateAdminWorkflow: async (workflowId, _adminUserId, input) => {
      const index = state.workflows.findIndex((candidate) => candidate.id === workflowId);
      if (index < 0) {
        return null;
      }

      const current = state.workflows[index];
      const updated: Workflow = {
        ...current,
        name: input.name,
        description: input.description,
        trigger: input.trigger,
        active: input.active
      };
      state.workflows[index] = updated;
      return updated;
    },
    deleteAdminWorkflow: async (workflowId) => {
      const nextWorkflows = state.workflows.filter((candidate) => candidate.id !== workflowId);
      if (nextWorkflows.length === state.workflows.length) {
        return false;
      }

      const removedEnrollmentIds = state.workflowEnrollments
        .filter((candidate) => candidate.workflowId === workflowId)
        .map((candidate) => candidate.id);
      const removedStepIds = state.workflowSteps
        .filter((candidate) => candidate.workflowId === workflowId)
        .map((candidate) => candidate.id);

      state.workflows = nextWorkflows;
      state.workflowEnrollments = state.workflowEnrollments.filter((candidate) => candidate.workflowId !== workflowId);
      state.workflowSteps = state.workflowSteps.filter((candidate) => candidate.workflowId !== workflowId);
      state.workflowTriggers = state.workflowTriggers.filter((candidate) => candidate.workflowId !== workflowId);
      state.workflowStepExecutions = state.workflowStepExecutions.filter((candidate) => (
        !removedEnrollmentIds.includes(candidate.enrollmentId)
        && !removedStepIds.includes(candidate.stepId)
      ));
      return true;
    },
    listAdminWorkflowTriggers: async (workflowId) => state.workflowTriggers
      .filter((candidate) => candidate.workflowId === workflowId)
      .sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""))
      .map((trigger) => ({
        ...trigger,
        appointmentTypeName: trigger.appointmentTypeId == null
          ? null
          : (state.appointmentTypes.find((candidate) => candidate.id === trigger.appointmentTypeId)?.name ?? null),
        formTemplateName: trigger.formTemplateId == null
          ? null
          : (state.formTemplates.find((candidate) => candidate.id === trigger.formTemplateId)?.name ?? null)
      })),
    listWorkflowTriggerOptions: async () => ({
      appointmentTypes: state.appointmentTypes
        .filter((item) => item.active !== false)
        .map((item) => ({
          id: item.id,
          label: item.name
        })),
      formTemplates: state.formTemplates
        .filter((item) => item.active)
        .map((item) => ({
          id: item.id,
          label: item.name
        }))
    }),
    createAdminWorkflowTrigger: async (workflowId, _adminUserId, input) => {
      const trigger: WorkflowAutoEnrollmentTrigger = {
        id: workflowRuntime.nextWorkflowTriggerId(),
        workflowId,
        triggerType: input.triggerType,
        appointmentTypeId: input.appointmentTypeId,
        formTemplateId: input.formTemplateId,
        active: input.active,
        createdAt: state.now()
      };
      state.workflowTriggers.push(trigger);
      return {
        ...trigger,
        appointmentTypeName: trigger.appointmentTypeId == null
          ? null
          : (state.appointmentTypes.find((candidate) => candidate.id === trigger.appointmentTypeId)?.name ?? null),
        formTemplateName: trigger.formTemplateId == null
          ? null
          : (state.formTemplates.find((candidate) => candidate.id === trigger.formTemplateId)?.name ?? null)
      };
    },
    deleteAdminWorkflowTrigger: async (workflowId, triggerId) => {
      const nextTriggers = state.workflowTriggers.filter((candidate) => !(
        candidate.workflowId === workflowId
        && candidate.id === triggerId
      ));
      if (nextTriggers.length === state.workflowTriggers.length) {
        return false;
      }

      state.workflowTriggers = nextTriggers;
      return true;
    },
    listAdminWorkflowEnrollments: async (workflowId) => state.workflowEnrollments
      .filter((candidate) => candidate.workflowId === workflowId)
      .sort((left, right) => right.enrolledAt.localeCompare(left.enrolledAt))
      .map((enrollment) => {
        const client = state.portalUsers.find((candidate) => candidate.clientId === enrollment.clientId);
        const admin = state.adminUsers.find((candidate) => candidate.actorId === enrollment.enrolledByAdminUserId);
        const nextPendingExecution = state.workflowStepExecutions
          .filter((execution) => execution.enrollmentId === enrollment.id && execution.status === "pending")
          .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor))[0];
        return {
          ...enrollment,
          status: getWorkflowStatus(enrollment),
          nextRunAt: nextPendingExecution?.scheduledFor ?? enrollment.nextRunAt ?? enrollment.enrolledAt,
          enrolledByAdminUserId: enrollment.enrolledByAdminUserId ?? null,
          cancelledAt: enrollment.cancelledAt ?? null,
          clientName: client?.displayName ?? enrollment.clientId,
          clientEmail: client?.email ?? `${enrollment.clientId}@example.test`,
          enrolledByName: admin?.username ?? null
        };
      }),
    listWorkflowEnrollableClients: async (workflowId) => state.portalUsers
      .filter((candidate) => !candidate.archived)
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .map((client) => ({
        clientId: client.clientId,
        name: client.displayName,
        email: client.email,
        alreadyEnrolled: state.workflowEnrollments.some((enrollment) => (
          enrollment.workflowId === workflowId
          && enrollment.clientId === client.clientId
          && getWorkflowStatus(enrollment) === "active"
        ))
      })),
    enrollWorkflowClients: async (workflowId, clientIds, adminUserId) => {
      workflowRuntime.enrollWorkflowClients(workflowId, clientIds, adminUserId);
    },
    cancelWorkflowEnrollment: async (workflowId, enrollmentId) => {
      const index = state.workflowEnrollments.findIndex((candidate) => (
        candidate.workflowId === workflowId
        && candidate.id === enrollmentId
      ));
      if (index < 0) {
        return false;
      }

      state.workflowEnrollments[index] = {
        ...state.workflowEnrollments[index],
        status: "cancelled",
        completedAt: state.workflowEnrollments[index]?.completedAt ?? state.now(),
        cancelledAt: state.now()
      };
      state.workflowStepExecutions = state.workflowStepExecutions.map((execution) => (
        execution.enrollmentId !== enrollmentId || execution.status === "completed"
          ? execution
          : {
            ...execution,
            status: "cancelled"
          }
      ));
      return true;
    },
    listAdminWorkflowSteps: async (workflowId) => [...state.workflowSteps]
      .filter((step) => step.workflowId === workflowId)
      .sort((left, right) => left.stepOrder - right.stepOrder)
      .map((step) => toWorkflowStepItem(step)),
    findAdminWorkflowStepById: async (workflowId, stepId) => {
      const step = state.workflowSteps.find((candidate) => candidate.workflowId === workflowId && candidate.id === stepId) ?? null;
      return step == null ? null : toWorkflowStepItem(step);
    },
    createAdminWorkflowStep: async (workflowId, _adminUserId, input) => {
      const stepOrder = Math.max(
        0,
        ...state.workflowSteps
          .filter((step) => step.workflowId === workflowId)
          .map((step) => step.stepOrder)
      ) + 1;
      const now = state.now();
      const step: WorkflowStep = {
        id: workflowRuntime.nextWorkflowStepId(),
        workflowId,
        stepOrder,
        stepName: input.stepName,
        emailSubject: input.emailSubject,
        emailBodyHtml: input.emailBodyHtml,
        emailBodyText: input.emailBodyText,
        delayType: input.delayType,
        delayValue: input.delayValue,
        scheduledDate: input.scheduledDate,
        attachContractId: input.attachContractId,
        attachFormId: input.attachFormId,
        attachQuoteId: input.attachQuoteId,
        attachInvoiceId: input.attachInvoiceId,
        includeAppointmentLink: input.includeAppointmentLink,
        appointmentTypeId: input.appointmentTypeId,
        createdAt: now,
        updatedAt: now
      };
      state.workflowSteps.push(step);
      return toWorkflowStepItem(step);
    },
    updateAdminWorkflowStep: async (workflowId, stepId, _adminUserId, input) => {
      const index = state.workflowSteps.findIndex((candidate) => candidate.workflowId === workflowId && candidate.id === stepId);
      if (index < 0) {
        return null;
      }

      const updated: WorkflowStep = {
        ...state.workflowSteps[index],
        stepName: input.stepName,
        emailSubject: input.emailSubject,
        emailBodyHtml: input.emailBodyHtml,
        emailBodyText: input.emailBodyText,
        delayType: input.delayType,
        delayValue: input.delayValue,
        scheduledDate: input.scheduledDate,
        attachContractId: input.attachContractId,
        attachFormId: input.attachFormId,
        attachQuoteId: input.attachQuoteId,
        attachInvoiceId: input.attachInvoiceId,
        includeAppointmentLink: input.includeAppointmentLink,
        appointmentTypeId: input.appointmentTypeId,
        updatedAt: state.now()
      };
      state.workflowSteps[index] = updated;
      return toWorkflowStepItem(updated);
    },
    deleteAdminWorkflowStep: async (workflowId, stepId) => {
      const nextSteps = state.workflowSteps.filter((candidate) => !(candidate.workflowId === workflowId && candidate.id === stepId));
      if (nextSteps.length === state.workflowSteps.length) {
        return false;
      }

      state.workflowSteps = nextSteps;
      state.workflowStepExecutions = state.workflowStepExecutions.filter((candidate) => candidate.stepId !== stepId);
      return true;
    },
    listWorkflowStepEditorOptions: async () => ({
      contractTemplates: state.contractTemplates.map((item) => ({
        id: item.id,
        label: item.name
      })),
      formTemplates: state.formTemplates
        .filter((item) => item.active)
        .map((item) => ({
          id: item.id,
          label: item.name
        })),
      appointmentTypes: state.appointmentTypes
        .filter((item) => item.active !== false)
        .map((item) => ({
          id: item.id,
          label: item.name
        })),
      quotes: state.quotes.map((item) => ({
        id: item.id,
        label: `${item.id} (${item.status})`
      })),
      invoices: state.invoices.map((item) => ({
        id: item.id,
        label: `${item.id} (${item.status})`
      })),
      emailTemplates: state.emailTemplates
        .filter((item) => item.active)
        .map((item) => ({
          id: item.id,
          label: item.name,
          subject: item.subject,
          bodyHtml: item.bodyHtml,
          bodyText: item.bodyText
        })),
      processorIntervalMinutes: workflowRuntime.getWorkflowProcessorIntervalMinutes()
    })
  };
}

function createPublicDocumentAccessDependencies(
  state: InMemoryPlatformState,
  workflowRuntime: InMemoryWorkflowRuntime
): PublicDocumentAccessDependencies {
  return {
    now: state.now,
    findPublicQuoteById: async (quoteId) => state.quotes.find((quote) => quote.id === quoteId) ?? null,
    findPublicQuoteByToken: async (token) => state.quotes.find((quote) => quote.publicAccess?.token === token) ?? null,
    respondPublicQuote: async (quoteId, action) => {
      const index = state.quotes.findIndex((quote) => quote.id === quoteId);
      if (index < 0) {
        return null;
      }

      const updated = {
        ...state.quotes[index],
        status: action === "accept" ? "accepted" as const : "declined" as const,
        acceptedAt: action === "accept" ? state.now() : (state.quotes[index]?.acceptedAt ?? null),
        declinedAt: action === "decline" ? state.now() : (state.quotes[index]?.declinedAt ?? null)
      };
      state.quotes[index] = updated;
      return updated;
    },
    findPublicContractById: async (contractId) => state.contracts.find((contract) => contract.id === contractId) ?? null,
    findPublicContractByToken: async (token) => state.contracts.find((contract) => contract.publicAccess?.token === token) ?? null,
    signPublicContract: async (input) => {
      const index = state.contracts.findIndex((contract) => contract.id === input.contractId);
      if (index < 0) {
        return null;
      }

      const updated = {
        ...state.contracts[index],
        status: "signed" as const,
        signatureTypedName: input.typedName,
        signatureFont: input.signatureFont,
        signedAt: state.now()
      };
      state.contracts[index] = updated;
      return updated;
    },
    findPublicFormSubmissionById: async (submissionId) => {
      const submission = state.formSubmissions.find((item) => item.id === submissionId) ?? null;
      return submission == null ? null : enrichInMemoryFormSubmission(state, submission);
    },
    findPublicFormSubmissionByToken: async (token) => {
      const submission = state.formSubmissions.find((item) => item.publicAccess?.token === token) ?? null;
      return submission == null ? null : enrichInMemoryFormSubmission(state, submission);
    },
    submitPublicForm: async (input) => {
      const index = state.formSubmissions.findIndex((submission) => submission.id === input.submissionId);
      if (index < 0) {
        return null;
      }

      const existing = state.formSubmissions[index];
      if (existing == null) {
        return null;
      }

      const clientIndex = state.portalUsers.findIndex((user) => user.clientId === existing.clientId);
      if (clientIndex >= 0) {
        state.portalUsers[clientIndex] = {
          ...state.portalUsers[clientIndex],
          displayName: input.contactName,
          email: input.contactEmail,
          phone: input.contactPhone === "" ? undefined : input.contactPhone
        };
      }

      const updated: FormSubmission = {
        ...existing,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone === "" ? null : input.contactPhone,
        responses: input.responses,
        status: "submitted",
        submittedAt: state.now()
      };
      state.formSubmissions[index] = updated;
      workflowRuntime.applyFormSubmissionTriggers(updated);
      return enrichInMemoryFormSubmission(state, updated);
    },
    findPublicBookingIcalById: async (bookingId) => state.bookings.find((booking) => booking.id === bookingId) ?? null,
    findPublicBookingIcalByToken: async (token) => state.bookings.find((booking) => booking.icalAccess?.token === token) ?? null,
    verifyCaptcha: state.captchaVerifier
  };
}

export function createInMemoryApiDependencies(state: InMemoryPlatformState): ApiDependencies {
  const workflowRuntime = createInMemoryWorkflowRuntime(state);
  return {
    publicBooking: createPublicBookingDependencies(state, workflowRuntime),
    publicContact: createPublicContactDependencies(state),
    publicPackages: createPublicPackagePurchaseDependencies(state, workflowRuntime),
    integrationCallbacks: createIntegrationCallbackDependencies(state),
    portalLogin: createPortalLoginDependencies(state),
    adminLogin: createAdminLoginDependencies(state),
    portalActorProfile: createPortalActorProfileDependencies(state),
    adminActorProfile: createAdminActorProfileDependencies(state),
    clientProfiles: createClientProfileDependencies(state),
    portalSummary: createPortalSummaryDependencies(state),
    adminDashboard: createAdminDashboardDependencies(state),
    adminOperations: createAdminOperationsDependencies(state),
    adminConfiguration: createAdminConfigurationDependencies(state),
    content: createContentManagementDependencies(state),
    achievements: createAchievementDependencies(state),
    portalResources: createPortalResourceReadDependencies(state),
    adminResources: createAdminResourceReadDependencies(state),
    petFiles: createPetFileManagementDependencies(state),
    contacts: createContactManagementDependencies(state),
    adminCalendarSync: createAdminCalendarSyncDependencies(state),
    portalCommerce: createPortalCommerceDependencies(state, workflowRuntime),
    publicDocuments: createPublicDocumentAccessDependencies(state, workflowRuntime),
    workflows: createWorkflowManagementDependencies(state, workflowRuntime)
  };
}

export function createInMemoryJobProcessorDependencies(
  state: InMemoryPlatformState,
  options: InMemoryJobProcessorOptions = {}
): BackgroundProcessorDependencies {
  let emailSequence = 0;
  const claimedEmails = new Map<string, OutboundEmailMessage>();
  const claimedJobs = new Map<string, JobEnvelope>();

  return {
    now: state.now,
    async claimDueJobs(limit) {
      const dueJobs = state.queuedJobs
        .filter((job) => job.scheduledFor <= state.now())
        .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor))
        .slice(0, limit);

      const claimedIds = new Set(dueJobs.map((job) => job.jobId));
      state.queuedJobs = state.queuedJobs.filter((job) => !claimedIds.has(job.jobId));
      for (const job of dueJobs) {
        claimedJobs.set(job.jobId, job);
      }
      return dueJobs;
    },
    async completeJob(result) {
      state.processedJobResults.push(result);
      const job = claimedJobs.get(result.jobId);
      if (job != null) {
        state.jobHistory.push({
          job,
          status: "processed",
          processedAt: result.processedAt,
          summary: result.summary
        });
        claimedJobs.delete(result.jobId);
      }
    },
    async failJob(result) {
      state.failedJobResults.push(result);
      const job = claimedJobs.get(result.jobId);
      if (job != null) {
        state.jobHistory.push({
          job,
          status: "failed",
          processedAt: result.processedAt,
          summary: result.summary
        });
        claimedJobs.delete(result.jobId);
      }
    },
    async claimQueuedEmails(limit) {
      const claimed = state.queuedEmails.splice(0, limit);
      return claimed.map((message) => {
        const emailId = `email-${++emailSequence}`;
        claimedEmails.set(emailId, message);
        return {
          emailId,
          message
        };
      });
    },
    async sendEmail(message) {
      if (options.sendEmail != null) {
        await options.sendEmail(message);
      }
    },
    async markEmailSent(emailId) {
      const message = claimedEmails.get(emailId);
      if (message != null) {
        state.sentEmails.push(message);
        claimedEmails.delete(emailId);
      }
    },
    async markEmailFailed(emailId, reason) {
      const message = claimedEmails.get(emailId);
      if (message != null) {
        state.failedEmailAttempts.push({ message, reason });
        claimedEmails.delete(emailId);
      }
    },
    handlers: options.handlers ?? {}
  };
}

export function createInMemoryInboundEmailProcessingDependencies(
  state: InMemoryPlatformState,
  overrides: Partial<InboundEmailProcessingDependencies> = {}
): InboundEmailProcessingDependencies {
  let sequence = 0;

  return {
    now: state.now,
    generateId: (prefix) => `${prefix}-${++sequence}`,
    saveInboundEmail: async (record) => {
      state.inboundEmails.push(record);
    },
    findPortalUsersByEmail: async (email) => state.portalUsers
      .filter((user) => user.email === email && !user.archived)
      .map((user) => ({
        id: user.clientId,
        email: user.email
      })),
    recordUnmatchedEmail: async (record) => {
      state.unmatchedEmails.push(record);
    },
    ...overrides
  };
}

export function createInMemorySessionStore(state: InMemoryPlatformState) {
  return {
    async save(sessionId: string, sessionData: string): Promise<void> {
      state.sessions.set(sessionId, sessionData);
    },
    async load(sessionId: string): Promise<string | null> {
      return state.sessions.get(sessionId) ?? null;
    },
    async delete(sessionId: string): Promise<void> {
      state.sessions.delete(sessionId);
    },
    async purgeExpired(): Promise<void> {
      return;
    }
  };
}
