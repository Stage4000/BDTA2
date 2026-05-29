import {
  achievementCertificateHtmlSchema,
  achievementTypeCollectionSchema,
  achievementTypeDetailSchema,
  clientAchievementCollectionSchema,
  clientAchievementDetailSchema
} from "@bdta/contracts";
import type { AchievementType, ClientAchievement } from "@bdta/domain";
import {
  achievementModeSchema,
  achievementTypeSchema,
  clientAchievementSchema,
  idSchema
} from "@bdta/domain";
import { SessionActorError, type SessionSnapshot } from "./session-actors.js";

export class AchievementError extends Error {
  constructor(
    public readonly code: "not_found" | "certificate_unavailable",
    message: string
  ) {
    super(message);
    this.name = "AchievementError";
  }
}

export type AchievementDependencies = {
  listPortalAchievements(clientId: string): Promise<ClientAchievement[]>;
  findPortalAchievementById(clientId: string, achievementId: string): Promise<ClientAchievement | null>;
  listAdminAchievementTypes(): Promise<AchievementType[]>;
  findAdminAchievementTypeById(achievementTypeId: string): Promise<AchievementType | null>;
  listAdminClientAchievements(clientId: string): Promise<ClientAchievement[]>;
  findAdminClientAchievementById(clientId: string, achievementId: string): Promise<ClientAchievement | null>;
  buildAchievementCertificateHtml(
    achievement: ClientAchievement,
    options: { audience: "portal" | "admin"; download: boolean; backPath: string }
  ): Promise<string>;
  buildPortalCertificateBackPath(): string;
  buildAdminCertificateBackPath(clientId: string): string;
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

function requireFound<T>(item: T | null, message: string): T {
  if (item == null) {
    throw new AchievementError("not_found", message);
  }

  return item;
}

function achievementSupportsCertificate(mode: string): boolean {
  return achievementModeSchema.parse(mode) !== "badge_only";
}

function ensureCertificateAvailable(achievement: ClientAchievement): ClientAchievement {
  if (achievement.status !== "awarded" || !achievementSupportsCertificate(achievement.awardMode)) {
    throw new AchievementError("certificate_unavailable", "This achievement does not currently have a printable certificate.");
  }

  return achievement;
}

export async function listPortalAchievements(session: SessionSnapshot, dependencies: AchievementDependencies) {
  const clientId = requirePortalSession(session);
  return clientAchievementCollectionSchema.parse({
    items: (await dependencies.listPortalAchievements(clientId)).map((item) => clientAchievementSchema.parse(item))
  });
}

export async function getPortalAchievementDetail(
  session: SessionSnapshot,
  achievementId: string,
  dependencies: AchievementDependencies
) {
  const clientId = requirePortalSession(session);
  const item = requireFound(
    await dependencies.findPortalAchievementById(clientId, idSchema.parse(achievementId)),
    "Portal achievement not found."
  );
  return clientAchievementDetailSchema.parse({
    item: clientAchievementSchema.parse(item)
  });
}

export async function getPortalAchievementCertificate(
  session: SessionSnapshot,
  achievementId: string,
  download: boolean,
  dependencies: AchievementDependencies
) {
  const clientId = requirePortalSession(session);
  const item = ensureCertificateAvailable(requireFound(
    await dependencies.findPortalAchievementById(clientId, idSchema.parse(achievementId)),
    "Portal achievement not found."
  ));

  return achievementCertificateHtmlSchema.parse(await dependencies.buildAchievementCertificateHtml(item, {
    audience: "portal",
    download,
    backPath: dependencies.buildPortalCertificateBackPath()
  }));
}

export async function listAdminAchievementTypes(session: SessionSnapshot, dependencies: AchievementDependencies) {
  requireAdminSession(session);
  return achievementTypeCollectionSchema.parse({
    items: (await dependencies.listAdminAchievementTypes()).map((item) => achievementTypeSchema.parse(item))
  });
}

export async function getAdminAchievementTypeDetail(
  session: SessionSnapshot,
  achievementTypeId: string,
  dependencies: AchievementDependencies
) {
  requireAdminSession(session);
  const item = requireFound(
    await dependencies.findAdminAchievementTypeById(idSchema.parse(achievementTypeId)),
    "Admin achievement type not found."
  );
  return achievementTypeDetailSchema.parse({
    item: achievementTypeSchema.parse(item)
  });
}

export async function listAdminClientAchievements(
  session: SessionSnapshot,
  clientId: string,
  dependencies: AchievementDependencies
) {
  requireAdminSession(session);
  return clientAchievementCollectionSchema.parse({
    items: (await dependencies.listAdminClientAchievements(idSchema.parse(clientId))).map((item) => clientAchievementSchema.parse(item))
  });
}

export async function getAdminClientAchievementDetail(
  session: SessionSnapshot,
  clientId: string,
  achievementId: string,
  dependencies: AchievementDependencies
) {
  requireAdminSession(session);
  const item = requireFound(
    await dependencies.findAdminClientAchievementById(idSchema.parse(clientId), idSchema.parse(achievementId)),
    "Admin client achievement not found."
  );
  return clientAchievementDetailSchema.parse({
    item: clientAchievementSchema.parse(item)
  });
}

export async function getAdminClientAchievementCertificate(
  session: SessionSnapshot,
  clientId: string,
  achievementId: string,
  download: boolean,
  dependencies: AchievementDependencies
) {
  requireAdminSession(session);
  const parsedClientId = idSchema.parse(clientId);
  const item = ensureCertificateAvailable(requireFound(
    await dependencies.findAdminClientAchievementById(parsedClientId, idSchema.parse(achievementId)),
    "Admin client achievement not found."
  ));

  return achievementCertificateHtmlSchema.parse(await dependencies.buildAchievementCertificateHtml(item, {
    audience: "admin",
    download,
    backPath: dependencies.buildAdminCertificateBackPath(parsedClientId)
  }));
}
