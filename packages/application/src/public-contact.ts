import { emailSchema } from "@bdta/domain";
import {
  publicContactRequestSchema,
  publicContactResponseSchema,
  type PublicContactResponse
} from "@bdta/contracts";
import { PublicContactError } from "./errors.js";

export type PublicContactDependencies = {
  now(): string;
  verifyCaptcha(turnstileToken: string): Promise<boolean>;
  findLatestClientByEmail(email: string): Promise<{ clientId: string; notes: string } | null>;
  updateClientNotes(clientId: string, notes: string): Promise<void>;
  createClientLead(input: { name: string; email: string; phone: string; notes: string }): Promise<{ clientId: string }>;
};

function buildContactNote(now: string, service: string, message: string): string {
  const noteLines = [`Public contact form message submitted on ${now}`];

  if (service !== "") {
    noteLines.push(`Service interested in: ${service}`);
  }

  noteLines.push(`Message: ${message}`);
  return noteLines.join("\n");
}

export async function createPublicContact(
  input: unknown,
  dependencies: PublicContactDependencies
): Promise<PublicContactResponse> {
  const request = publicContactRequestSchema.parse(input);
  const name = request.name.trim();
  const email = request.email.trim().toLowerCase();
  const phone = request.phone.trim();
  const service = request.service.trim();
  const message = request.message.trim();
  const turnstileToken = request.turnstileToken.trim();

  if (name === "" || email === "" || message === "") {
    throw new PublicContactError("validation_failed", "Name, email, and message are required.");
  }

  if (!emailSchema.safeParse(email).success) {
    throw new PublicContactError("validation_failed", "Please enter a valid email address.");
  }

  const captchaValid = await dependencies.verifyCaptcha(turnstileToken);
  if (!captchaValid) {
    throw new PublicContactError("captcha_failed", "Please confirm you are not a robot and try again.");
  }

  const contactNote = buildContactNote(dependencies.now(), service, message);
  const existing = await dependencies.findLatestClientByEmail(email);

  if (existing != null) {
    const existingNotes = existing.notes.trim();
    await dependencies.updateClientNotes(
      existing.clientId,
      existingNotes === ""
        ? contactNote
        : `${existingNotes}\n\n${contactNote}`
    );
  } else {
    await dependencies.createClientLead({
      name,
      email,
      phone,
      notes: contactNote
    });
  }

  return publicContactResponseSchema.parse({
    success: true
  });
}
