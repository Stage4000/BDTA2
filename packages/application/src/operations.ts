import { z } from "zod";

import {
  adminIntegrationCallbackLogCollectionSchema,
  adminIntegrationCallbackLogDetailSchema,
  adminJobLogCollectionSchema,
  adminJobLogDetailSchema,
  type AdminIntegrationCallbackLog,
  type AdminJobLog
} from "@bdta/contracts";
import { SessionActorError, type SessionSnapshot } from "./session-actors.js";

export class AdminOperationsError extends Error {
  constructor(
    public readonly code: "not_found",
    message: string
  ) {
    super(message);
    this.name = "AdminOperationsError";
  }
}

export type AdminOperationsDependencies = {
  listAdminJobLogs(): Promise<AdminJobLog[]>;
  findAdminJobLogById(jobId: string): Promise<AdminJobLog | null>;
  listAdminIntegrationCallbackLogs(): Promise<AdminIntegrationCallbackLog[]>;
  findAdminIntegrationCallbackLogById(callbackId: string): Promise<AdminIntegrationCallbackLog | null>;
};

function requireAdminSession(session: SessionSnapshot): void {
  if (session.actorType !== "admin_user") {
    throw new SessionActorError("unauthorized", "Admin session required.");
  }
}

export async function listAdminJobLogs(
  session: SessionSnapshot,
  dependencies: AdminOperationsDependencies
) {
  requireAdminSession(session);
  return adminJobLogCollectionSchema.parse({
    items: await dependencies.listAdminJobLogs()
  });
}

export async function getAdminJobLogDetail(
  session: SessionSnapshot,
  jobId: string,
  dependencies: AdminOperationsDependencies
) {
  requireAdminSession(session);
  const item = await dependencies.findAdminJobLogById(z.string().min(1).parse(jobId));
  if (item == null) {
    throw new AdminOperationsError("not_found", "Admin job log not found.");
  }

  return adminJobLogDetailSchema.parse({ item });
}

export async function listAdminIntegrationCallbackLogs(
  session: SessionSnapshot,
  dependencies: AdminOperationsDependencies
) {
  requireAdminSession(session);
  return adminIntegrationCallbackLogCollectionSchema.parse({
    items: await dependencies.listAdminIntegrationCallbackLogs()
  });
}

export async function getAdminIntegrationCallbackLogDetail(
  session: SessionSnapshot,
  callbackId: string,
  dependencies: AdminOperationsDependencies
) {
  requireAdminSession(session);
  const item = await dependencies.findAdminIntegrationCallbackLogById(z.string().min(1).parse(callbackId));
  if (item == null) {
    throw new AdminOperationsError("not_found", "Admin integration callback log not found.");
  }

  return adminIntegrationCallbackLogDetailSchema.parse({ item });
}
