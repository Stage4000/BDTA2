import {
  adminClientProfileDetailSchema,
  adminClientUpsertRequestSchema,
  portalProfileDetailSchema,
  portalProfileUpdateRequestSchema
} from "@bdta/contracts";
import type { ClientProfile } from "@bdta/domain";
import { clientProfileSchema, idSchema } from "@bdta/domain";
import { SessionActorError, type SessionSnapshot } from "./session-actors.js";

export class ClientProfileError extends Error {
  constructor(
    public readonly code: "not_found" | "email_in_use" | "invalid_current_password" | "password_too_short" | "password_confirmation_mismatch",
    message: string
  ) {
    super(message);
    this.name = "ClientProfileError";
  }
}

export type ClientProfileDependencies = {
  findPortalProfile(clientId: string): Promise<ClientProfile | null>;
  verifyPortalCurrentPassword(clientId: string, currentPassword: string): Promise<boolean>;
  updatePortalProfile(
    clientId: string,
    input: { name: string; email: string; phone: string; address: string; newPassword: string | null }
  ): Promise<ClientProfile | null>;
  findAdminClientProfile(clientId: string): Promise<ClientProfile | null>;
  createAdminClientProfile(
    input: { name: string; email: string; phone: string; address: string; notes: string; isAdmin: boolean }
  ): Promise<ClientProfile>;
  updateAdminClientProfile(
    clientId: string,
    input: { name: string; email: string; phone: string; address: string; notes: string; isAdmin: boolean }
  ): Promise<ClientProfile | null>;
  isClientEmailInUse(email: string, excludeClientId: string | null): Promise<boolean>;
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

function parsePasswordChange(input: { currentPassword: string; newPassword: string; confirmPassword: string }) {
  const currentPassword = input.currentPassword.trim();
  const newPassword = input.newPassword;
  const confirmPassword = input.confirmPassword;
  const changePassword = newPassword !== "" || confirmPassword !== "";

  if (!changePassword) {
    return null;
  }

  if (currentPassword === "") {
    throw new ClientProfileError("invalid_current_password", "Current password is required to change your password.");
  }

  if (newPassword.length < 8) {
    throw new ClientProfileError("password_too_short", "New password must be at least 8 characters long.");
  }

  if (newPassword !== confirmPassword) {
    throw new ClientProfileError("password_confirmation_mismatch", "New passwords do not match.");
  }

  return {
    currentPassword,
    newPassword
  };
}

export async function getPortalProfile(session: SessionSnapshot, dependencies: ClientProfileDependencies) {
  const clientId = requirePortalSession(session);
  const profile = await dependencies.findPortalProfile(clientId);
  if (profile == null) {
    throw new ClientProfileError("not_found", "Portal profile not found.");
  }

  return portalProfileDetailSchema.parse({
    item: clientProfileSchema.pick({
      id: true,
      name: true,
      email: true,
      phone: true,
      address: true,
      archived: true
    }).parse(profile)
  });
}

export async function updatePortalProfile(
  session: SessionSnapshot,
  input: unknown,
  dependencies: ClientProfileDependencies
) {
  const clientId = requirePortalSession(session);
  const parsed = portalProfileUpdateRequestSchema.parse(input);

  if (await dependencies.isClientEmailInUse(parsed.email, clientId)) {
    throw new ClientProfileError("email_in_use", "That email address is already in use by another account.");
  }

  const passwordChange = parsePasswordChange(parsed);
  if (passwordChange != null) {
    const valid = await dependencies.verifyPortalCurrentPassword(clientId, passwordChange.currentPassword);
    if (!valid) {
      throw new ClientProfileError("invalid_current_password", "Current password is incorrect.");
    }
  }

  const profile = await dependencies.updatePortalProfile(clientId, {
    name: parsed.name,
    email: parsed.email,
    phone: parsed.phone,
    address: parsed.address,
    newPassword: passwordChange?.newPassword ?? null
  });
  if (profile == null) {
    throw new ClientProfileError("not_found", "Portal profile not found.");
  }

  return portalProfileDetailSchema.parse({
    item: clientProfileSchema.pick({
      id: true,
      name: true,
      email: true,
      phone: true,
      address: true,
      archived: true
    }).parse(profile)
  });
}

export async function getAdminClientProfile(
  session: SessionSnapshot,
  clientId: string,
  dependencies: ClientProfileDependencies
) {
  requireAdminSession(session);
  const profile = await dependencies.findAdminClientProfile(idSchema.parse(clientId));
  if (profile == null) {
    throw new ClientProfileError("not_found", "Admin client profile not found.");
  }

  return adminClientProfileDetailSchema.parse({
    item: clientProfileSchema.parse(profile)
  });
}

export async function createAdminClientProfile(
  session: SessionSnapshot,
  input: unknown,
  dependencies: ClientProfileDependencies
) {
  requireAdminSession(session);
  const parsed = adminClientUpsertRequestSchema.parse(input);

  if (await dependencies.isClientEmailInUse(parsed.email, null)) {
    throw new ClientProfileError("email_in_use", "That email address is already in use by another account.");
  }

  const profile = await dependencies.createAdminClientProfile(parsed);
  return adminClientProfileDetailSchema.parse({
    item: clientProfileSchema.parse(profile)
  });
}

export async function updateAdminClientProfile(
  session: SessionSnapshot,
  clientId: string,
  input: unknown,
  dependencies: ClientProfileDependencies
) {
  requireAdminSession(session);
  const parsed = adminClientUpsertRequestSchema.parse(input);
  const parsedClientId = idSchema.parse(clientId);

  if (await dependencies.isClientEmailInUse(parsed.email, parsedClientId)) {
    throw new ClientProfileError("email_in_use", "That email address is already in use by another account.");
  }

  const profile = await dependencies.updateAdminClientProfile(parsedClientId, parsed);
  if (profile == null) {
    throw new ClientProfileError("not_found", "Admin client profile not found.");
  }

  return adminClientProfileDetailSchema.parse({
    item: clientProfileSchema.parse(profile)
  });
}
