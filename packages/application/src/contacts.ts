import {
  clientContactCollectionSchema,
  clientContactDetailSchema,
  clientContactUpsertRequestSchema,
  deleteResponseSchema
} from "@bdta/contracts";
import type { ClientContact } from "@bdta/domain";
import { clientContactSchema, idSchema } from "@bdta/domain";
import { SessionActorError, type SessionSnapshot } from "./session-actors.js";

export class ContactActionError extends Error {
  constructor(
    public readonly code: "not_found",
    message: string
  ) {
    super(message);
    this.name = "ContactActionError";
  }
}

export type ContactManagementDependencies = {
  listPortalContacts(clientId: string): Promise<ClientContact[]>;
  findPortalContactById(clientId: string, contactId: string): Promise<ClientContact | null>;
  createPortalContact(clientId: string, input: ContactUpsertInput): Promise<ClientContact>;
  updatePortalContact(clientId: string, contactId: string, input: ContactUpsertInput): Promise<ClientContact | null>;
  deletePortalContact(clientId: string, contactId: string): Promise<boolean>;
  listAdminClientContacts(clientId: string): Promise<ClientContact[]>;
  findAdminClientContactById(clientId: string, contactId: string): Promise<ClientContact | null>;
  createAdminClientContact(clientId: string, input: ContactUpsertInput): Promise<ClientContact>;
  updateAdminClientContact(clientId: string, contactId: string, input: ContactUpsertInput): Promise<ClientContact | null>;
  deleteAdminClientContact(clientId: string, contactId: string): Promise<boolean>;
};

type ContactUpsertInput = {
  name: string;
  email: string;
  phone: string;
  isPrimary: boolean;
};

function requirePortalSession(session: SessionSnapshot): string {
  if (session.actorType !== "portal_user") {
    throw new SessionActorError("unauthorized", "Portal session required.");
  }

  return session.actorId;
}

function requireAdminSession(session: SessionSnapshot): void {
  if (session.actorType !== "admin_user") {
    throw new SessionActorError("unauthorized", "Admin session required.");
  }
}

function parseContactInput(input: unknown): ContactUpsertInput {
  return clientContactUpsertRequestSchema.parse(input);
}

function requireFound<T>(value: T | null, message: string): T {
  if (value == null) {
    throw new ContactActionError("not_found", message);
  }

  return value;
}

export async function listPortalContacts(session: SessionSnapshot, dependencies: ContactManagementDependencies) {
  const clientId = requirePortalSession(session);
  return clientContactCollectionSchema.parse({
    items: (await dependencies.listPortalContacts(clientId)).map((contact) => clientContactSchema.parse(contact))
  });
}

export async function getPortalContactDetail(
  session: SessionSnapshot,
  contactId: string,
  dependencies: ContactManagementDependencies
) {
  const clientId = requirePortalSession(session);
  const item = requireFound(
    await dependencies.findPortalContactById(clientId, idSchema.parse(contactId)),
    "Portal contact not found."
  );
  return clientContactDetailSchema.parse({
    item: clientContactSchema.parse(item)
  });
}

export async function createPortalContact(
  session: SessionSnapshot,
  input: unknown,
  dependencies: ContactManagementDependencies
) {
  const clientId = requirePortalSession(session);
  return clientContactDetailSchema.parse({
    item: clientContactSchema.parse(await dependencies.createPortalContact(clientId, parseContactInput(input)))
  });
}

export async function updatePortalContact(
  session: SessionSnapshot,
  contactId: string,
  input: unknown,
  dependencies: ContactManagementDependencies
) {
  const clientId = requirePortalSession(session);
  const item = requireFound(
    await dependencies.updatePortalContact(clientId, idSchema.parse(contactId), parseContactInput(input)),
    "Portal contact not found."
  );
  return clientContactDetailSchema.parse({
    item: clientContactSchema.parse(item)
  });
}

export async function deletePortalContact(
  session: SessionSnapshot,
  contactId: string,
  dependencies: ContactManagementDependencies
) {
  const clientId = requirePortalSession(session);
  const deleted = await dependencies.deletePortalContact(clientId, idSchema.parse(contactId));
  if (!deleted) {
    throw new ContactActionError("not_found", "Portal contact not found.");
  }

  return deleteResponseSchema.parse({ deleted: true });
}

export async function listAdminClientContacts(
  session: SessionSnapshot,
  clientId: string,
  dependencies: ContactManagementDependencies
) {
  requireAdminSession(session);
  return clientContactCollectionSchema.parse({
    items: (await dependencies.listAdminClientContacts(idSchema.parse(clientId))).map((contact) => clientContactSchema.parse(contact))
  });
}

export async function getAdminClientContactDetail(
  session: SessionSnapshot,
  clientId: string,
  contactId: string,
  dependencies: ContactManagementDependencies
) {
  requireAdminSession(session);
  const item = requireFound(
    await dependencies.findAdminClientContactById(idSchema.parse(clientId), idSchema.parse(contactId)),
    "Admin client contact not found."
  );
  return clientContactDetailSchema.parse({
    item: clientContactSchema.parse(item)
  });
}

export async function createAdminClientContact(
  session: SessionSnapshot,
  clientId: string,
  input: unknown,
  dependencies: ContactManagementDependencies
) {
  requireAdminSession(session);
  return clientContactDetailSchema.parse({
    item: clientContactSchema.parse(
      await dependencies.createAdminClientContact(idSchema.parse(clientId), parseContactInput(input))
    )
  });
}

export async function updateAdminClientContact(
  session: SessionSnapshot,
  clientId: string,
  contactId: string,
  input: unknown,
  dependencies: ContactManagementDependencies
) {
  requireAdminSession(session);
  const item = requireFound(
    await dependencies.updateAdminClientContact(
      idSchema.parse(clientId),
      idSchema.parse(contactId),
      parseContactInput(input)
    ),
    "Admin client contact not found."
  );
  return clientContactDetailSchema.parse({
    item: clientContactSchema.parse(item)
  });
}

export async function deleteAdminClientContact(
  session: SessionSnapshot,
  clientId: string,
  contactId: string,
  dependencies: ContactManagementDependencies
) {
  requireAdminSession(session);
  const deleted = await dependencies.deleteAdminClientContact(idSchema.parse(clientId), idSchema.parse(contactId));
  if (!deleted) {
    throw new ContactActionError("not_found", "Admin client contact not found.");
  }

  return deleteResponseSchema.parse({ deleted: true });
}
