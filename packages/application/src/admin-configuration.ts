import { z } from "zod";

import {
  adminAppointmentTypeUpsertRequestSchema,
  adminEmailTemplateUpsertRequestSchema,
  adminFormTemplateUpsertRequestSchema,
  adminScheduledTaskUpsertRequestSchema,
  appointmentTypeCollectionSchema,
  appointmentTypeDetailSchema,
  deleteResponseSchema,
  emailTemplateCollectionSchema,
  emailTemplateDetailSchema,
  formTemplateCollectionSchema,
  formTemplateDetailSchema,
  scheduledTaskCollectionSchema,
  scheduledTaskDetailSchema
} from "@bdta/contracts";
import {
  appointmentTypeSchema,
  emailTemplateSchema,
  formTemplateSchema,
  idSchema,
  scheduledTaskSchema,
  type AppointmentType,
  type EmailTemplate,
  type FormTemplate,
  type ScheduledTask
} from "@bdta/domain";
import { SessionActorError, type SessionSnapshot } from "./session-actors.js";

export class AdminConfigurationError extends Error {
  constructor(
    public readonly code: "in_use" | "not_found",
    message: string
  ) {
    super(message);
    this.name = "AdminConfigurationError";
  }
}

export type AdminConfigurationDependencies = {
  listAdminAppointmentTypes(): Promise<AppointmentType[]>;
  findAdminAppointmentTypeById(appointmentTypeId: string): Promise<AppointmentType | null>;
  createAdminAppointmentType(adminUserId: string, input: z.infer<typeof adminAppointmentTypeUpsertRequestSchema>): Promise<AppointmentType>;
  updateAdminAppointmentType(
    appointmentTypeId: string,
    adminUserId: string,
    input: z.infer<typeof adminAppointmentTypeUpsertRequestSchema>
  ): Promise<AppointmentType | null>;
  deleteAdminAppointmentType(appointmentTypeId: string): Promise<boolean>;
  listAdminFormTemplates(): Promise<FormTemplate[]>;
  findAdminFormTemplateById(templateId: string): Promise<FormTemplate | null>;
  createAdminFormTemplate(adminUserId: string, input: z.infer<typeof adminFormTemplateUpsertRequestSchema>): Promise<FormTemplate>;
  updateAdminFormTemplate(
    templateId: string,
    adminUserId: string,
    input: z.infer<typeof adminFormTemplateUpsertRequestSchema>
  ): Promise<FormTemplate | null>;
  countAdminFormTemplateSubmissions(templateId: string): Promise<number>;
  deleteAdminFormTemplate(templateId: string): Promise<boolean>;
  listAdminEmailTemplates(): Promise<EmailTemplate[]>;
  findAdminEmailTemplateById(templateId: string): Promise<EmailTemplate | null>;
  createAdminEmailTemplate(adminUserId: string, input: z.infer<typeof adminEmailTemplateUpsertRequestSchema>): Promise<EmailTemplate>;
  updateAdminEmailTemplate(
    templateId: string,
    adminUserId: string,
    input: z.infer<typeof adminEmailTemplateUpsertRequestSchema>
  ): Promise<EmailTemplate | null>;
  listAdminScheduledTasks(): Promise<ScheduledTask[]>;
  findAdminScheduledTaskById(taskId: string): Promise<ScheduledTask | null>;
  createAdminScheduledTask(adminUserId: string, input: z.infer<typeof adminScheduledTaskUpsertRequestSchema>): Promise<ScheduledTask>;
  updateAdminScheduledTask(
    taskId: string,
    adminUserId: string,
    input: z.infer<typeof adminScheduledTaskUpsertRequestSchema>
  ): Promise<ScheduledTask | null>;
};

function requireAdminSession(session: SessionSnapshot): string {
  if (session.actorType !== "admin_user") {
    throw new SessionActorError("unauthorized", "Admin session required.");
  }

  return session.actorId;
}

export async function listAdminAppointmentTypes(
  session: SessionSnapshot,
  dependencies: AdminConfigurationDependencies
) {
  requireAdminSession(session);
  return appointmentTypeCollectionSchema.parse({
    items: (await dependencies.listAdminAppointmentTypes()).map((item) => appointmentTypeSchema.parse(item))
  });
}

export async function getAdminAppointmentTypeDetail(
  session: SessionSnapshot,
  appointmentTypeId: string,
  dependencies: AdminConfigurationDependencies
) {
  requireAdminSession(session);
  const item = await dependencies.findAdminAppointmentTypeById(idSchema.parse(appointmentTypeId));
  if (item == null) {
    throw new AdminConfigurationError("not_found", "Admin appointment type not found.");
  }

  return appointmentTypeDetailSchema.parse({ item: appointmentTypeSchema.parse(item) });
}

export async function createAdminAppointmentType(
  session: SessionSnapshot,
  input: unknown,
  dependencies: AdminConfigurationDependencies
) {
  const adminUserId = requireAdminSession(session);
  const item = await dependencies.createAdminAppointmentType(
    adminUserId,
    adminAppointmentTypeUpsertRequestSchema.parse(input)
  );
  return appointmentTypeDetailSchema.parse({ item: appointmentTypeSchema.parse(item) });
}

export async function updateAdminAppointmentType(
  session: SessionSnapshot,
  appointmentTypeId: string,
  input: unknown,
  dependencies: AdminConfigurationDependencies
) {
  const adminUserId = requireAdminSession(session);
  const item = await dependencies.updateAdminAppointmentType(
    idSchema.parse(appointmentTypeId),
    adminUserId,
    adminAppointmentTypeUpsertRequestSchema.parse(input)
  );
  if (item == null) {
    throw new AdminConfigurationError("not_found", "Admin appointment type not found.");
  }

  return appointmentTypeDetailSchema.parse({ item: appointmentTypeSchema.parse(item) });
}

export async function deleteAdminAppointmentType(
  session: SessionSnapshot,
  appointmentTypeId: string,
  dependencies: AdminConfigurationDependencies
) {
  requireAdminSession(session);
  const normalizedAppointmentTypeId = idSchema.parse(appointmentTypeId);
  const item = await dependencies.findAdminAppointmentTypeById(normalizedAppointmentTypeId);
  if (item == null) {
    throw new AdminConfigurationError("not_found", "Admin appointment type not found.");
  }

  const deleted = await dependencies.deleteAdminAppointmentType(normalizedAppointmentTypeId);
  if (!deleted) {
    throw new AdminConfigurationError("not_found", "Admin appointment type not found.");
  }

  return deleteResponseSchema.parse({ deleted: true });
}

export async function listAdminEmailTemplates(
  session: SessionSnapshot,
  dependencies: AdminConfigurationDependencies
) {
  requireAdminSession(session);
  return emailTemplateCollectionSchema.parse({
    items: (await dependencies.listAdminEmailTemplates()).map((item) => emailTemplateSchema.parse(item))
  });
}

export async function getAdminEmailTemplateDetail(
  session: SessionSnapshot,
  templateId: string,
  dependencies: AdminConfigurationDependencies
) {
  requireAdminSession(session);
  const item = await dependencies.findAdminEmailTemplateById(idSchema.parse(templateId));
  if (item == null) {
    throw new AdminConfigurationError("not_found", "Admin email template not found.");
  }

  return emailTemplateDetailSchema.parse({ item: emailTemplateSchema.parse(item) });
}

export async function createAdminEmailTemplate(
  session: SessionSnapshot,
  input: unknown,
  dependencies: AdminConfigurationDependencies
) {
  const adminUserId = requireAdminSession(session);
  const item = await dependencies.createAdminEmailTemplate(
    adminUserId,
    adminEmailTemplateUpsertRequestSchema.parse(input)
  );
  return emailTemplateDetailSchema.parse({ item: emailTemplateSchema.parse(item) });
}

export async function listAdminFormTemplates(
  session: SessionSnapshot,
  dependencies: AdminConfigurationDependencies
) {
  requireAdminSession(session);
  return formTemplateCollectionSchema.parse({
    items: (await dependencies.listAdminFormTemplates()).map((item) => formTemplateSchema.parse(item))
  });
}

export async function getAdminFormTemplateDetail(
  session: SessionSnapshot,
  templateId: string,
  dependencies: AdminConfigurationDependencies
) {
  requireAdminSession(session);
  const item = await dependencies.findAdminFormTemplateById(idSchema.parse(templateId));
  if (item == null) {
    throw new AdminConfigurationError("not_found", "Admin form template not found.");
  }

  return formTemplateDetailSchema.parse({ item: formTemplateSchema.parse(item) });
}

export async function createAdminFormTemplate(
  session: SessionSnapshot,
  input: unknown,
  dependencies: AdminConfigurationDependencies
) {
  const adminUserId = requireAdminSession(session);
  const item = await dependencies.createAdminFormTemplate(
    adminUserId,
    adminFormTemplateUpsertRequestSchema.parse(input)
  );
  return formTemplateDetailSchema.parse({ item: formTemplateSchema.parse(item) });
}

export async function updateAdminFormTemplate(
  session: SessionSnapshot,
  templateId: string,
  input: unknown,
  dependencies: AdminConfigurationDependencies
) {
  const adminUserId = requireAdminSession(session);
  const item = await dependencies.updateAdminFormTemplate(
    idSchema.parse(templateId),
    adminUserId,
    adminFormTemplateUpsertRequestSchema.parse(input)
  );
  if (item == null) {
    throw new AdminConfigurationError("not_found", "Admin form template not found.");
  }

  return formTemplateDetailSchema.parse({ item: formTemplateSchema.parse(item) });
}

export async function deleteAdminFormTemplate(
  session: SessionSnapshot,
  templateId: string,
  dependencies: AdminConfigurationDependencies
) {
  requireAdminSession(session);
  const normalizedTemplateId = idSchema.parse(templateId);
  const item = await dependencies.findAdminFormTemplateById(normalizedTemplateId);
  if (item == null) {
    throw new AdminConfigurationError("not_found", "Admin form template not found.");
  }

  const submissionCount = await dependencies.countAdminFormTemplateSubmissions(normalizedTemplateId);
  if (submissionCount > 0) {
    throw new AdminConfigurationError(
      "in_use",
      `Form template has ${submissionCount} submission(s) and cannot be deleted. Mark it inactive instead.`
    );
  }

  const deleted = await dependencies.deleteAdminFormTemplate(normalizedTemplateId);
  if (!deleted) {
    throw new AdminConfigurationError("not_found", "Admin form template not found.");
  }

  return deleteResponseSchema.parse({ deleted: true });
}

export async function updateAdminEmailTemplate(
  session: SessionSnapshot,
  templateId: string,
  input: unknown,
  dependencies: AdminConfigurationDependencies
) {
  const adminUserId = requireAdminSession(session);
  const item = await dependencies.updateAdminEmailTemplate(
    idSchema.parse(templateId),
    adminUserId,
    adminEmailTemplateUpsertRequestSchema.parse(input)
  );
  if (item == null) {
    throw new AdminConfigurationError("not_found", "Admin email template not found.");
  }

  return emailTemplateDetailSchema.parse({ item: emailTemplateSchema.parse(item) });
}

export async function listAdminScheduledTasks(
  session: SessionSnapshot,
  dependencies: AdminConfigurationDependencies
) {
  requireAdminSession(session);
  return scheduledTaskCollectionSchema.parse({
    items: (await dependencies.listAdminScheduledTasks()).map((item) => scheduledTaskSchema.parse(item))
  });
}

export async function getAdminScheduledTaskDetail(
  session: SessionSnapshot,
  taskId: string,
  dependencies: AdminConfigurationDependencies
) {
  requireAdminSession(session);
  const item = await dependencies.findAdminScheduledTaskById(idSchema.parse(taskId));
  if (item == null) {
    throw new AdminConfigurationError("not_found", "Admin scheduled task not found.");
  }

  return scheduledTaskDetailSchema.parse({ item: scheduledTaskSchema.parse(item) });
}

export async function createAdminScheduledTask(
  session: SessionSnapshot,
  input: unknown,
  dependencies: AdminConfigurationDependencies
) {
  const adminUserId = requireAdminSession(session);
  const item = await dependencies.createAdminScheduledTask(
    adminUserId,
    adminScheduledTaskUpsertRequestSchema.parse(input)
  );
  return scheduledTaskDetailSchema.parse({ item: scheduledTaskSchema.parse(item) });
}

export async function updateAdminScheduledTask(
  session: SessionSnapshot,
  taskId: string,
  input: unknown,
  dependencies: AdminConfigurationDependencies
) {
  const adminUserId = requireAdminSession(session);
  const item = await dependencies.updateAdminScheduledTask(
    idSchema.parse(taskId),
    adminUserId,
    adminScheduledTaskUpsertRequestSchema.parse(input)
  );
  if (item == null) {
    throw new AdminConfigurationError("not_found", "Admin scheduled task not found.");
  }

  return scheduledTaskDetailSchema.parse({ item: scheduledTaskSchema.parse(item) });
}
