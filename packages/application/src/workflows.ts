import { z } from "zod";

import {
  adminWorkflowCollectionSchema,
  adminWorkflowDetailSchema,
  adminWorkflowEnrollmentCollectionSchema,
  adminWorkflowTriggerCollectionSchema,
  adminWorkflowTriggerCreateRequestSchema,
  adminWorkflowStepCollectionSchema,
  adminWorkflowStepEditorSchema,
  adminWorkflowStepUpsertRequestSchema,
  adminWorkflowUpsertRequestSchema,
  successResponseSchema,
  workflowClientEnrollmentRequestSchema,
  workflowEnrollableClientCollectionSchema,
  type AdminWorkflowTriggerCreateRequest,
  type WorkflowTriggerEditorOptions,
  type WorkflowStepEditorOptions
} from "@bdta/contracts";
import { idSchema } from "@bdta/domain";

import { SessionActorError, type SessionSnapshot } from "./session-actors.js";

export class WorkflowActionError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_input",
    message: string
  ) {
    super(message);
    this.name = "WorkflowActionError";
  }
}

type AdminWorkflowItem = z.infer<typeof adminWorkflowDetailSchema>["item"];
type AdminWorkflowTriggerItem = z.infer<typeof adminWorkflowTriggerCollectionSchema>["items"][number];
type AdminWorkflowStepItem = z.infer<typeof adminWorkflowStepCollectionSchema>["items"][number];
type AdminWorkflowStepInput = z.infer<typeof adminWorkflowStepUpsertRequestSchema>;

export type WorkflowManagementDependencies = {
  listAdminWorkflows(): Promise<z.infer<typeof adminWorkflowCollectionSchema>["items"]>;
  findAdminWorkflowById(workflowId: string): Promise<AdminWorkflowItem | null>;
  createAdminWorkflow(
    adminUserId: string,
    input: z.infer<typeof adminWorkflowUpsertRequestSchema>
  ): Promise<AdminWorkflowItem>;
  updateAdminWorkflow(
    workflowId: string,
    adminUserId: string,
    input: z.infer<typeof adminWorkflowUpsertRequestSchema>
  ): Promise<AdminWorkflowItem | null>;
  deleteAdminWorkflow(workflowId: string): Promise<boolean>;
  listAdminWorkflowTriggers(workflowId: string): Promise<AdminWorkflowTriggerItem[]>;
  listWorkflowTriggerOptions(workflowId: string): Promise<WorkflowTriggerEditorOptions>;
  createAdminWorkflowTrigger(
    workflowId: string,
    adminUserId: string,
    input: AdminWorkflowTriggerCreateRequest
  ): Promise<AdminWorkflowTriggerItem>;
  deleteAdminWorkflowTrigger(workflowId: string, triggerId: string): Promise<boolean>;
  listAdminWorkflowEnrollments(
    workflowId: string
  ): Promise<z.infer<typeof adminWorkflowEnrollmentCollectionSchema>["items"]>;
  listWorkflowEnrollableClients(
    workflowId: string
  ): Promise<z.infer<typeof workflowEnrollableClientCollectionSchema>["items"]>;
  enrollWorkflowClients(workflowId: string, clientIds: string[], adminUserId: string | null): Promise<void>;
  cancelWorkflowEnrollment(workflowId: string, enrollmentId: string): Promise<boolean>;
  listAdminWorkflowSteps(workflowId: string): Promise<AdminWorkflowStepItem[]>;
  findAdminWorkflowStepById(workflowId: string, stepId: string): Promise<AdminWorkflowStepItem | null>;
  createAdminWorkflowStep(
    workflowId: string,
    adminUserId: string,
    input: AdminWorkflowStepInput
  ): Promise<AdminWorkflowStepItem>;
  updateAdminWorkflowStep(
    workflowId: string,
    stepId: string,
    adminUserId: string,
    input: AdminWorkflowStepInput
  ): Promise<AdminWorkflowStepItem | null>;
  deleteAdminWorkflowStep(workflowId: string, stepId: string): Promise<boolean>;
  listWorkflowStepEditorOptions(workflowId: string): Promise<WorkflowStepEditorOptions>;
};

function requireAdminSession(session: SessionSnapshot): string {
  if (session.actorType !== "admin_user") {
    throw new SessionActorError("unauthorized", "Admin session required.");
  }

  return session.actorId;
}

function requireFound<T>(item: T | null, message: string): T {
  if (item == null) {
    throw new WorkflowActionError("not_found", message);
  }

  return item;
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

function normalizeWorkflowStepInput(input: unknown): AdminWorkflowStepInput {
  const parsed = adminWorkflowStepUpsertRequestSchema.parse(input);
  return {
    ...parsed,
    emailBodyText: parsed.emailBodyText == null || parsed.emailBodyText.trim() === "" ? null : parsed.emailBodyText,
    delayValue: parsed.delayValue == null || parsed.delayValue.trim() === "" ? null : parsed.delayValue,
    scheduledDate: parsed.scheduledDate ?? null,
    attachContractId: parsed.attachContractId ?? null,
    attachFormId: parsed.attachFormId ?? null,
    attachQuoteId: parsed.attachQuoteId ?? null,
    attachInvoiceId: parsed.attachInvoiceId ?? null,
    appointmentTypeId: parsed.appointmentTypeId ?? null
  };
}

function validateWorkflowStepInput(input: AdminWorkflowStepInput, processorIntervalMinutes: number): void {
  if (input.delayType === "specific_date" && input.scheduledDate == null) {
    throw new WorkflowActionError("invalid_input", "Specific-date workflow steps require a scheduled date.");
  }

  if (input.delayType === "after_enrollment" || input.delayType === "after_previous") {
    const delayMinutes = parseWorkflowDelayToMinutes(input.delayValue);
    if (delayMinutes < processorIntervalMinutes) {
      throw new WorkflowActionError(
        "invalid_input",
        `Delay must be at least ${processorIntervalMinutes} minutes to match the workflow processor cadence.`
      );
    }
  }
}

export async function listAdminWorkflows(
  session: SessionSnapshot,
  dependencies: WorkflowManagementDependencies
) {
  requireAdminSession(session);
  return adminWorkflowCollectionSchema.parse({
    items: await dependencies.listAdminWorkflows()
  });
}

export async function getAdminWorkflowDetail(
  session: SessionSnapshot,
  workflowId: string,
  dependencies: WorkflowManagementDependencies
) {
  requireAdminSession(session);
  const item = requireFound(
    await dependencies.findAdminWorkflowById(idSchema.parse(workflowId)),
    "Admin workflow not found."
  );

  return adminWorkflowDetailSchema.parse({ item });
}

export async function createAdminWorkflow(
  session: SessionSnapshot,
  input: unknown,
  dependencies: WorkflowManagementDependencies
) {
  const adminUserId = requireAdminSession(session);
  return adminWorkflowDetailSchema.parse({
    item: await dependencies.createAdminWorkflow(adminUserId, adminWorkflowUpsertRequestSchema.parse(input))
  });
}

export async function updateAdminWorkflow(
  session: SessionSnapshot,
  workflowId: string,
  input: unknown,
  dependencies: WorkflowManagementDependencies
) {
  const adminUserId = requireAdminSession(session);
  const item = requireFound(
    await dependencies.updateAdminWorkflow(
      idSchema.parse(workflowId),
      adminUserId,
      adminWorkflowUpsertRequestSchema.parse(input)
    ),
    "Admin workflow not found."
  );

  return adminWorkflowDetailSchema.parse({ item });
}

export async function deleteAdminWorkflow(
  session: SessionSnapshot,
  workflowId: string,
  dependencies: WorkflowManagementDependencies
) {
  requireAdminSession(session);
  const deleted = await dependencies.deleteAdminWorkflow(idSchema.parse(workflowId));
  if (!deleted) {
    throw new WorkflowActionError("not_found", "Admin workflow not found.");
  }

  return successResponseSchema.parse({ success: true });
}

export async function listAdminWorkflowEnrollments(
  session: SessionSnapshot,
  workflowId: string,
  dependencies: WorkflowManagementDependencies
) {
  requireAdminSession(session);
  const workflow = requireFound(
    await dependencies.findAdminWorkflowById(idSchema.parse(workflowId)),
    "Admin workflow not found."
  );

  return adminWorkflowEnrollmentCollectionSchema.parse({
    workflow,
    items: await dependencies.listAdminWorkflowEnrollments(workflow.id)
  });
}

export async function listAdminWorkflowTriggers(
  session: SessionSnapshot,
  workflowId: string,
  dependencies: WorkflowManagementDependencies
) {
  requireAdminSession(session);
  const workflow = requireFound(
    await dependencies.findAdminWorkflowById(idSchema.parse(workflowId)),
    "Admin workflow not found."
  );

  return adminWorkflowTriggerCollectionSchema.parse({
    workflow,
    items: await dependencies.listAdminWorkflowTriggers(workflow.id),
    options: await dependencies.listWorkflowTriggerOptions(workflow.id)
  });
}

export async function createAdminWorkflowTrigger(
  session: SessionSnapshot,
  workflowId: string,
  input: unknown,
  dependencies: WorkflowManagementDependencies
) {
  const adminUserId = requireAdminSession(session);
  const normalizedWorkflowId = idSchema.parse(workflowId);
  const workflow = requireFound(
    await dependencies.findAdminWorkflowById(normalizedWorkflowId),
    "Admin workflow not found."
  );

  await dependencies.createAdminWorkflowTrigger(
    normalizedWorkflowId,
    adminUserId,
    adminWorkflowTriggerCreateRequestSchema.parse(input)
  );

  return adminWorkflowTriggerCollectionSchema.parse({
    workflow,
    items: await dependencies.listAdminWorkflowTriggers(normalizedWorkflowId),
    options: await dependencies.listWorkflowTriggerOptions(normalizedWorkflowId)
  });
}

export async function deleteAdminWorkflowTrigger(
  session: SessionSnapshot,
  workflowId: string,
  triggerId: string,
  dependencies: WorkflowManagementDependencies
) {
  requireAdminSession(session);
  const normalizedWorkflowId = idSchema.parse(workflowId);
  requireFound(
    await dependencies.findAdminWorkflowById(normalizedWorkflowId),
    "Admin workflow not found."
  );

  const deleted = await dependencies.deleteAdminWorkflowTrigger(normalizedWorkflowId, idSchema.parse(triggerId));
  if (!deleted) {
    throw new WorkflowActionError("not_found", "Workflow trigger not found.");
  }

  return successResponseSchema.parse({ success: true });
}

export async function listAdminWorkflowEnrollableClients(
  session: SessionSnapshot,
  workflowId: string,
  dependencies: WorkflowManagementDependencies
) {
  requireAdminSession(session);
  const workflow = requireFound(
    await dependencies.findAdminWorkflowById(idSchema.parse(workflowId)),
    "Admin workflow not found."
  );

  return workflowEnrollableClientCollectionSchema.parse({
    workflow,
    items: await dependencies.listWorkflowEnrollableClients(workflow.id)
  });
}

export async function enrollAdminWorkflowClients(
  session: SessionSnapshot,
  workflowId: string,
  input: unknown,
  dependencies: WorkflowManagementDependencies
) {
  const adminUserId = requireAdminSession(session);
  const normalizedWorkflowId = idSchema.parse(workflowId);
  requireFound(
    await dependencies.findAdminWorkflowById(normalizedWorkflowId),
    "Admin workflow not found."
  );

  const parsed = workflowClientEnrollmentRequestSchema.parse(input);
  await dependencies.enrollWorkflowClients(normalizedWorkflowId, parsed.clientIds, adminUserId);
  return successResponseSchema.parse({ success: true });
}

export async function cancelAdminWorkflowEnrollment(
  session: SessionSnapshot,
  workflowId: string,
  enrollmentId: string,
  dependencies: WorkflowManagementDependencies
) {
  requireAdminSession(session);
  const normalizedWorkflowId = idSchema.parse(workflowId);
  requireFound(
    await dependencies.findAdminWorkflowById(normalizedWorkflowId),
    "Admin workflow not found."
  );

  const cancelled = await dependencies.cancelWorkflowEnrollment(normalizedWorkflowId, idSchema.parse(enrollmentId));
  if (!cancelled) {
    throw new WorkflowActionError("not_found", "Workflow enrollment not found.");
  }

  return successResponseSchema.parse({ success: true });
}

export async function listAdminWorkflowSteps(
  session: SessionSnapshot,
  workflowId: string,
  dependencies: WorkflowManagementDependencies
) {
  requireAdminSession(session);
  const workflow = requireFound(
    await dependencies.findAdminWorkflowById(idSchema.parse(workflowId)),
    "Admin workflow not found."
  );

  return adminWorkflowStepCollectionSchema.parse({
    workflow,
    items: await dependencies.listAdminWorkflowSteps(workflow.id)
  });
}

export async function getAdminWorkflowStepEditor(
  session: SessionSnapshot,
  workflowId: string,
  stepId: string | null,
  dependencies: WorkflowManagementDependencies
) {
  requireAdminSession(session);
  const workflow = requireFound(
    await dependencies.findAdminWorkflowById(idSchema.parse(workflowId)),
    "Admin workflow not found."
  );

  const item = stepId == null
    ? null
    : requireFound(
      await dependencies.findAdminWorkflowStepById(workflow.id, idSchema.parse(stepId)),
      "Workflow step not found."
    );

  return adminWorkflowStepEditorSchema.parse({
    workflow,
    item,
    options: await dependencies.listWorkflowStepEditorOptions(workflow.id)
  });
}

export async function createAdminWorkflowStep(
  session: SessionSnapshot,
  workflowId: string,
  input: unknown,
  dependencies: WorkflowManagementDependencies
) {
  const adminUserId = requireAdminSession(session);
  const normalizedWorkflowId = idSchema.parse(workflowId);
  requireFound(
    await dependencies.findAdminWorkflowById(normalizedWorkflowId),
    "Admin workflow not found."
  );

  const normalizedInput = normalizeWorkflowStepInput(input);
  const options = await dependencies.listWorkflowStepEditorOptions(normalizedWorkflowId);
  validateWorkflowStepInput(normalizedInput, options.processorIntervalMinutes);

  return adminWorkflowStepEditorSchema.parse({
    workflow: requireFound(await dependencies.findAdminWorkflowById(normalizedWorkflowId), "Admin workflow not found."),
    item: await dependencies.createAdminWorkflowStep(normalizedWorkflowId, adminUserId, normalizedInput),
    options
  });
}

export async function updateAdminWorkflowStep(
  session: SessionSnapshot,
  workflowId: string,
  stepId: string,
  input: unknown,
  dependencies: WorkflowManagementDependencies
) {
  const adminUserId = requireAdminSession(session);
  const normalizedWorkflowId = idSchema.parse(workflowId);
  requireFound(
    await dependencies.findAdminWorkflowById(normalizedWorkflowId),
    "Admin workflow not found."
  );

  const normalizedInput = normalizeWorkflowStepInput(input);
  const options = await dependencies.listWorkflowStepEditorOptions(normalizedWorkflowId);
  validateWorkflowStepInput(normalizedInput, options.processorIntervalMinutes);

  const item = requireFound(
    await dependencies.updateAdminWorkflowStep(
      normalizedWorkflowId,
      idSchema.parse(stepId),
      adminUserId,
      normalizedInput
    ),
    "Workflow step not found."
  );

  return adminWorkflowStepEditorSchema.parse({
    workflow: requireFound(await dependencies.findAdminWorkflowById(normalizedWorkflowId), "Admin workflow not found."),
    item,
    options
  });
}

export async function deleteAdminWorkflowStep(
  session: SessionSnapshot,
  workflowId: string,
  stepId: string,
  dependencies: WorkflowManagementDependencies
) {
  requireAdminSession(session);
  const normalizedWorkflowId = idSchema.parse(workflowId);
  requireFound(
    await dependencies.findAdminWorkflowById(normalizedWorkflowId),
    "Admin workflow not found."
  );

  const deleted = await dependencies.deleteAdminWorkflowStep(normalizedWorkflowId, idSchema.parse(stepId));
  if (!deleted) {
    throw new WorkflowActionError("not_found", "Workflow step not found.");
  }

  return successResponseSchema.parse({ success: true });
}
