import { z } from "zod";

import {
  inboundEmailSchema,
  type Client,
  type InboundEmail,
  type UnmatchedEmail
} from "@bdta/domain";
import type { JobEnvelope } from "@bdta/contracts";

const inboundEmailPayloadSchema = z.object({
  callbackId: z.string().min(1).optional(),
  provider: z.enum(["imap", "mail_provider"]).default("imap"),
  mailbox: z.string().min(1).default("INBOX"),
  messageId: z.string().min(1),
  receivedAt: z.string().datetime(),
  from: z.string().email(),
  subject: z.string().min(1)
}).passthrough();

export type InboundEmailProcessingDependencies = {
  now(): string;
  generateId(prefix: string): string;
  saveInboundEmail(record: InboundEmail): Promise<void>;
  findPortalUsersByEmail(email: string): Promise<Array<Pick<Client, "id" | "email">>>;
  recordUnmatchedEmail(record: UnmatchedEmail): Promise<void>;
};

export async function processInboundEmailReceiverJob(
  job: JobEnvelope,
  dependencies: InboundEmailProcessingDependencies
): Promise<string> {
  const payload = inboundEmailPayloadSchema.parse(job.payload);
  const matchedClients = await dependencies.findPortalUsersByEmail(payload.from);
  const matchedClientId = matchedClients.length === 1 ? matchedClients[0]?.id ?? null : null;
  const inboundEmailId = dependencies.generateId("inbound_email");

  await dependencies.saveInboundEmail(inboundEmailSchema.parse({
    id: inboundEmailId,
    provider: payload.provider,
    mailbox: payload.mailbox,
    messageId: payload.messageId,
    receivedAt: payload.receivedAt,
    fromEmail: payload.from,
    subject: payload.subject,
    matchedClientId,
    rawPayload: job.payload
  }));

  if (matchedClients.length !== 1) {
    await dependencies.recordUnmatchedEmail({
      id: dependencies.generateId("unmatched_email"),
      inboundEmailId,
      reason: matchedClients.length === 0 ? "no_client_match" : "multiple_client_matches",
      detectedAt: dependencies.now(),
      resolvedAt: null
    });
  }

  return matchedClientId == null
    ? `Processed inbound email ${payload.messageId} with unmatched client handling.`
    : `Processed inbound email ${payload.messageId} for client ${matchedClientId}.`;
}
