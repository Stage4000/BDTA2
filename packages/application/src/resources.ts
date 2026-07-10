import { z } from "zod";

import {
  bookingCollectionSchema,
  bookingDetailSchema,
  clientCollectionSchema,
  clientDetailSchema,
  contractCollectionSchema,
  contractDetailSchema,
  creditCollectionSchema,
  creditDetailSchema,
  deleteResponseSchema,
  formSubmissionCollectionSchema,
  formSubmissionDetailSchema,
  invoiceCollectionSchema,
  invoiceDetailSchema,
  packageCollectionSchema,
  packageDetailSchema,
  petCollectionSchema,
  petDetailSchema,
  petFileContentSchema,
  petFileCollectionSchema,
  petFileDetailSchema,
  portalNotificationCollectionSchema,
  quoteCollectionSchema,
  quoteDetailSchema
} from "@bdta/contracts";
import type { Booking, Client, Contract, Credit, FormSubmission, Invoice, Notification, Package, Pet, PetFile, Quote } from "@bdta/domain";
import {
  bookingSchema,
  clientSchema,
  contractSchema,
  creditSchema,
  formSubmissionSchema,
  idSchema,
  invoiceSchema,
  notificationSchema,
  packageSchema,
  petSchema,
  petFileSchema,
  quoteSchema
} from "@bdta/domain";
import {
  isFormSubmissionClientPortalVisible,
  normalizeFormSubmissionPortalMetadata
} from "./form-portal-visibility.js";
import { SessionActorError, type SessionSnapshot } from "./session-actors.js";

function collectValidItems<T>(
  items: readonly unknown[],
  schema: z.ZodType<T>
): T[] {
  return items.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export type PortalResourceReadDependencies = {
  listPortalBookings(clientId: string): Promise<Booking[]>;
  findPortalBookingById(clientId: string, bookingId: string): Promise<Booking | null>;
  listPortalPets(clientId: string): Promise<Pet[]>;
  findPortalPetById(clientId: string, petId: string): Promise<Pet | null>;
  listPortalPetFiles(clientId: string, petId: string): Promise<PetFile[]>;
  findPortalPetFileById(clientId: string, petId: string, fileId: string): Promise<PetFile | null>;
  loadPortalPetFileContent(
    clientId: string,
    petId: string,
    fileId: string,
    download: boolean
  ): Promise<z.infer<typeof petFileContentSchema> | null>;
  deletePortalPetFile(clientId: string, petId: string, fileId: string): Promise<boolean>;
  listPortalInvoices(clientId: string): Promise<Invoice[]>;
  findPortalInvoiceById(clientId: string, invoiceId: string): Promise<Invoice | null>;
  listPortalQuotes(clientId: string): Promise<Quote[]>;
  findPortalQuoteById(clientId: string, quoteId: string): Promise<Quote | null>;
  listPortalContracts(clientId: string): Promise<Contract[]>;
  findPortalContractById(clientId: string, contractId: string): Promise<Contract | null>;
  listPortalForms(clientId: string): Promise<FormSubmission[]>;
  findPortalFormById(clientId: string, formId: string): Promise<FormSubmission | null>;
  listPortalNotifications(clientId: string): Promise<Notification[]>;
  listPortalPackages(clientId: string): Promise<Package[]>;
  findPortalPackageById(clientId: string, packageId: string): Promise<Package | null>;
  listPortalCredits(clientId: string): Promise<Credit[]>;
  findPortalCreditById(clientId: string, creditId: string): Promise<Credit | null>;
};

export type AdminResourceReadDependencies = {
  listAdminClients(): Promise<Client[]>;
  findAdminClientById(clientId: string): Promise<Client | null>;
  listAdminPets(): Promise<Pet[]>;
  findAdminPetById(petId: string): Promise<Pet | null>;
  listAdminPetFiles(petId: string): Promise<PetFile[]>;
  findAdminPetFileById(petId: string, fileId: string): Promise<PetFile | null>;
  loadAdminPetFileContent(
    petId: string,
    fileId: string,
    download: boolean
  ): Promise<z.infer<typeof petFileContentSchema> | null>;
  deleteAdminPetFile(petId: string, fileId: string): Promise<boolean>;
  listAdminBookings(): Promise<Booking[]>;
  findAdminBookingById(bookingId: string): Promise<Booking | null>;
  listAdminInvoices(): Promise<Invoice[]>;
  findAdminInvoiceById(invoiceId: string): Promise<Invoice | null>;
  listAdminQuotes(): Promise<Quote[]>;
  findAdminQuoteById(quoteId: string): Promise<Quote | null>;
  listAdminContracts(): Promise<Contract[]>;
  findAdminContractById(contractId: string): Promise<Contract | null>;
  listAdminForms(): Promise<FormSubmission[]>;
  listAdminFormsByTemplate(templateId: string): Promise<FormSubmission[]>;
  findAdminFormById(formId: string): Promise<FormSubmission | null>;
  createAdminFormRequest(input: {
    templateId: string;
    clientId: string;
    bookingId?: string | null;
    petId?: string | null;
    sentAt?: string | null;
  }): Promise<FormSubmission | null>;
  reviewAdminForm(formId: string, adminUserId: string, notes: string): Promise<FormSubmission | null>;
  unreviewAdminForm(formId: string): Promise<FormSubmission | null>;
  listAdminPackages(): Promise<Package[]>;
  findAdminPackageById(packageId: string): Promise<Package | null>;
  listAdminCredits(): Promise<Credit[]>;
  findAdminCreditById(creditId: string): Promise<Credit | null>;
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
    throw new SessionActorError("actor_not_found", message);
  }

  return item;
}

export async function listPortalBookings(session: SessionSnapshot, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  return bookingCollectionSchema.parse({
    items: (await dependencies.listPortalBookings(clientId)).map((item) => bookingSchema.parse(item))
  });
}

export async function getPortalBookingDetail(session: SessionSnapshot, bookingId: string, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  const item = requireFound(await dependencies.findPortalBookingById(clientId, idSchema.parse(bookingId)), "Portal booking not found.");
  return bookingDetailSchema.parse({ item: bookingSchema.parse(item) });
}

export async function listPortalPets(session: SessionSnapshot, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  return petCollectionSchema.parse({
    items: (await dependencies.listPortalPets(clientId)).map((item) => petSchema.parse(item))
  });
}

export async function getPortalPetDetail(session: SessionSnapshot, petId: string, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  const item = requireFound(await dependencies.findPortalPetById(clientId, idSchema.parse(petId)), "Portal pet not found.");
  return petDetailSchema.parse({ item: petSchema.parse(item) });
}

export async function listPortalPetFiles(session: SessionSnapshot, petId: string, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  return petFileCollectionSchema.parse({
    items: (await dependencies.listPortalPetFiles(clientId, idSchema.parse(petId))).map((item) => petFileSchema.parse(item))
  });
}

export async function getPortalPetFileDetail(
  session: SessionSnapshot,
  petId: string,
  fileId: string,
  dependencies: PortalResourceReadDependencies
) {
  const clientId = requirePortalSession(session);
  const item = requireFound(
    await dependencies.findPortalPetFileById(clientId, idSchema.parse(petId), idSchema.parse(fileId)),
    "Portal pet file not found."
  );
  return petFileDetailSchema.parse({ item: petFileSchema.parse(item) });
}

export async function getPortalPetFileContent(
  session: SessionSnapshot,
  petId: string,
  fileId: string,
  download: boolean,
  dependencies: PortalResourceReadDependencies
) {
  const clientId = requirePortalSession(session);
  const item = await dependencies.loadPortalPetFileContent(clientId, idSchema.parse(petId), idSchema.parse(fileId), download);
  if (item == null) {
    throw new SessionActorError("actor_not_found", "Portal pet file content not found.");
  }

  return petFileContentSchema.parse(item);
}

export async function deletePortalPetFile(
  session: SessionSnapshot,
  petId: string,
  fileId: string,
  dependencies: PortalResourceReadDependencies
) {
  const clientId = requirePortalSession(session);
  const deleted = await dependencies.deletePortalPetFile(clientId, idSchema.parse(petId), idSchema.parse(fileId));
  if (!deleted) {
    throw new SessionActorError("actor_not_found", "Portal pet file not found.");
  }

  return deleteResponseSchema.parse({ deleted: true });
}

export async function listPortalInvoices(session: SessionSnapshot, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  return invoiceCollectionSchema.parse({
    items: (await dependencies.listPortalInvoices(clientId)).map((item) => invoiceSchema.parse(item))
  });
}

export async function getPortalInvoiceDetail(session: SessionSnapshot, invoiceId: string, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  const item = requireFound(await dependencies.findPortalInvoiceById(clientId, idSchema.parse(invoiceId)), "Portal invoice not found.");
  return invoiceDetailSchema.parse({ item: invoiceSchema.parse(item) });
}

export async function listPortalQuotes(session: SessionSnapshot, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  return quoteCollectionSchema.parse({
    items: (await dependencies.listPortalQuotes(clientId)).map((item) => quoteSchema.parse(item))
  });
}

export async function getPortalQuoteDetail(session: SessionSnapshot, quoteId: string, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  const item = requireFound(await dependencies.findPortalQuoteById(clientId, idSchema.parse(quoteId)), "Portal quote not found.");
  return quoteDetailSchema.parse({ item: quoteSchema.parse(item) });
}

export async function listPortalContracts(session: SessionSnapshot, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  return contractCollectionSchema.parse({
    items: (await dependencies.listPortalContracts(clientId)).map((item) => contractSchema.parse(item))
  });
}

export async function getPortalContractDetail(session: SessionSnapshot, contractId: string, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  const item = requireFound(await dependencies.findPortalContractById(clientId, idSchema.parse(contractId)), "Portal contract not found.");
  return contractDetailSchema.parse({ item: contractSchema.parse(item) });
}

export async function listPortalForms(session: SessionSnapshot, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  return formSubmissionCollectionSchema.parse({
    items: (await dependencies.listPortalForms(clientId))
      .map((item) => normalizeFormSubmissionPortalMetadata(formSubmissionSchema.parse(item)))
      .filter((item) => isFormSubmissionClientPortalVisible(item))
  });
}

export async function getPortalFormDetail(session: SessionSnapshot, formId: string, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  const item = requireFound(await dependencies.findPortalFormById(clientId, idSchema.parse(formId)), "Portal form not found.");
  const normalized = normalizeFormSubmissionPortalMetadata(formSubmissionSchema.parse(item));
  if (!isFormSubmissionClientPortalVisible(normalized)) {
    throw new SessionActorError("actor_not_found", "Portal form not found.");
  }

  return formSubmissionDetailSchema.parse({ item: normalized });
}

export async function listPortalNotifications(session: SessionSnapshot, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  return portalNotificationCollectionSchema.parse({
    items: (await dependencies.listPortalNotifications(clientId)).map((item) => notificationSchema.parse(item))
  });
}

export async function listPortalPackages(session: SessionSnapshot, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  return packageCollectionSchema.parse({
    items: (await dependencies.listPortalPackages(clientId)).map((item) => packageSchema.parse(item))
  });
}

export async function getPortalPackageDetail(session: SessionSnapshot, packageId: string, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  const item = requireFound(await dependencies.findPortalPackageById(clientId, idSchema.parse(packageId)), "Portal package not found.");
  return packageDetailSchema.parse({ item: packageSchema.parse(item) });
}

export async function listPortalCredits(session: SessionSnapshot, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  return creditCollectionSchema.parse({
    items: (await dependencies.listPortalCredits(clientId)).map((item) => creditSchema.parse(item))
  });
}

export async function getPortalCreditDetail(session: SessionSnapshot, creditId: string, dependencies: PortalResourceReadDependencies) {
  const clientId = requirePortalSession(session);
  const item = requireFound(await dependencies.findPortalCreditById(clientId, idSchema.parse(creditId)), "Portal credit not found.");
  return creditDetailSchema.parse({ item: creditSchema.parse(item) });
}

export async function listAdminClients(session: SessionSnapshot, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  return clientCollectionSchema.parse({
    items: (await dependencies.listAdminClients()).map((item) => clientSchema.parse(item))
  });
}

export async function getAdminClientDetail(session: SessionSnapshot, clientId: string, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  const item = requireFound(await dependencies.findAdminClientById(idSchema.parse(clientId)), "Admin client not found.");
  return clientDetailSchema.parse({ item: clientSchema.parse(item) });
}

export async function listAdminPets(session: SessionSnapshot, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  return petCollectionSchema.parse({
    items: (await dependencies.listAdminPets()).map((item) => petSchema.parse(item))
  });
}

export async function getAdminPetDetail(session: SessionSnapshot, petId: string, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  const item = requireFound(await dependencies.findAdminPetById(idSchema.parse(petId)), "Admin pet not found.");
  return petDetailSchema.parse({ item: petSchema.parse(item) });
}

export async function listAdminPetFiles(session: SessionSnapshot, petId: string, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  return petFileCollectionSchema.parse({
    items: (await dependencies.listAdminPetFiles(idSchema.parse(petId))).map((item) => petFileSchema.parse(item))
  });
}

export async function getAdminPetFileDetail(
  session: SessionSnapshot,
  petId: string,
  fileId: string,
  dependencies: AdminResourceReadDependencies
) {
  requireAdminSession(session);
  const item = requireFound(
    await dependencies.findAdminPetFileById(idSchema.parse(petId), idSchema.parse(fileId)),
    "Admin pet file not found."
  );
  return petFileDetailSchema.parse({ item: petFileSchema.parse(item) });
}

export async function getAdminPetFileContent(
  session: SessionSnapshot,
  petId: string,
  fileId: string,
  download: boolean,
  dependencies: AdminResourceReadDependencies
) {
  requireAdminSession(session);
  const item = await dependencies.loadAdminPetFileContent(idSchema.parse(petId), idSchema.parse(fileId), download);
  if (item == null) {
    throw new SessionActorError("actor_not_found", "Admin pet file content not found.");
  }

  return petFileContentSchema.parse(item);
}

export async function deleteAdminPetFile(
  session: SessionSnapshot,
  petId: string,
  fileId: string,
  dependencies: AdminResourceReadDependencies
) {
  requireAdminSession(session);
  const deleted = await dependencies.deleteAdminPetFile(idSchema.parse(petId), idSchema.parse(fileId));
  if (!deleted) {
    throw new SessionActorError("actor_not_found", "Admin pet file not found.");
  }

  return deleteResponseSchema.parse({ deleted: true });
}

export async function listAdminBookings(session: SessionSnapshot, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  return bookingCollectionSchema.parse({
    items: collectValidItems(await dependencies.listAdminBookings(), bookingSchema)
  });
}

export async function getAdminBookingDetail(session: SessionSnapshot, bookingId: string, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  const item = requireFound(await dependencies.findAdminBookingById(idSchema.parse(bookingId)), "Admin booking not found.");
  return bookingDetailSchema.parse({ item: bookingSchema.parse(item) });
}

export async function listAdminInvoices(session: SessionSnapshot, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  return invoiceCollectionSchema.parse({
    items: collectValidItems(await dependencies.listAdminInvoices(), invoiceSchema)
  });
}

export async function getAdminInvoiceDetail(session: SessionSnapshot, invoiceId: string, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  const item = requireFound(await dependencies.findAdminInvoiceById(idSchema.parse(invoiceId)), "Admin invoice not found.");
  return invoiceDetailSchema.parse({ item: invoiceSchema.parse(item) });
}

export async function listAdminQuotes(session: SessionSnapshot, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  return quoteCollectionSchema.parse({
    items: collectValidItems(await dependencies.listAdminQuotes(), quoteSchema)
  });
}

export async function getAdminQuoteDetail(session: SessionSnapshot, quoteId: string, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  const item = requireFound(await dependencies.findAdminQuoteById(idSchema.parse(quoteId)), "Admin quote not found.");
  return quoteDetailSchema.parse({ item: quoteSchema.parse(item) });
}

export async function listAdminContracts(session: SessionSnapshot, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  return contractCollectionSchema.parse({
    items: (await dependencies.listAdminContracts()).map((item) => contractSchema.parse(item))
  });
}

export async function getAdminContractDetail(session: SessionSnapshot, contractId: string, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  const item = requireFound(await dependencies.findAdminContractById(idSchema.parse(contractId)), "Admin contract not found.");
  return contractDetailSchema.parse({ item: contractSchema.parse(item) });
}

export async function listAdminForms(session: SessionSnapshot, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  return formSubmissionCollectionSchema.parse({
    items: (await dependencies.listAdminForms()).map((item) => normalizeFormSubmissionPortalMetadata(formSubmissionSchema.parse(item)))
  });
}

export async function getAdminFormDetail(session: SessionSnapshot, formId: string, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  const item = requireFound(await dependencies.findAdminFormById(idSchema.parse(formId)), "Admin form not found.");
  return formSubmissionDetailSchema.parse({ item: normalizeFormSubmissionPortalMetadata(formSubmissionSchema.parse(item)) });
}

export async function listAdminPackages(session: SessionSnapshot, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  return packageCollectionSchema.parse({
    items: (await dependencies.listAdminPackages()).map((item) => packageSchema.parse(item))
  });
}

export async function getAdminPackageDetail(session: SessionSnapshot, packageId: string, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  const item = requireFound(await dependencies.findAdminPackageById(idSchema.parse(packageId)), "Admin package not found.");
  return packageDetailSchema.parse({ item: packageSchema.parse(item) });
}

export async function listAdminCredits(session: SessionSnapshot, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  return creditCollectionSchema.parse({
    items: (await dependencies.listAdminCredits()).map((item) => creditSchema.parse(item))
  });
}

export async function getAdminCreditDetail(session: SessionSnapshot, creditId: string, dependencies: AdminResourceReadDependencies) {
  requireAdminSession(session);
  const item = requireFound(await dependencies.findAdminCreditById(idSchema.parse(creditId)), "Admin credit not found.");
  return creditDetailSchema.parse({ item: creditSchema.parse(item) });
}
