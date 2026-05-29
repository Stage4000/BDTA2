import { z } from "zod";

import type { Invoice, OutboundEmailMessage } from "@bdta/domain";
import type { JobEnvelope } from "@bdta/contracts";

const invoiceReminderPayloadSchema = z.object({
  invoiceId: z.string().min(1)
});

export type InvoiceReminderTarget = {
  invoice: Invoice;
  recipientEmail: string;
};

export type InvoiceReminderDependencies = {
  findInvoiceReminderTarget(invoiceId: string): Promise<InvoiceReminderTarget | null>;
  queueReminderEmail(message: OutboundEmailMessage): Promise<void>;
  buildPortalInvoiceUrl(invoiceId: string): string;
};

export async function processInvoiceReminderJob(
  job: JobEnvelope,
  dependencies: InvoiceReminderDependencies
): Promise<string> {
  const payload = invoiceReminderPayloadSchema.parse(job.payload);
  const target = await dependencies.findInvoiceReminderTarget(payload.invoiceId);

  if (target == null) {
    throw new Error(`Invoice ${payload.invoiceId} not found for reminder processing.`);
  }

  const dueDate = target.invoice.dueAt == null ? "soon" : target.invoice.dueAt.slice(0, 10);
  const invoiceUrl = dependencies.buildPortalInvoiceUrl(target.invoice.id);

  await dependencies.queueReminderEmail({
    to: [target.recipientEmail],
    subject: "Invoice reminder",
    html: [
      `<p>This is a reminder for invoice ${target.invoice.id}.</p>`,
      `<p>Outstanding amount: ${target.invoice.outstandingAmount}</p>`,
      `<p>Due date: ${dueDate}</p>`,
      `<p><a href="${invoiceUrl}">View invoice</a></p>`
    ].join(""),
    templateKey: "invoice_reminder"
  });

  return `Queued invoice reminder for ${payload.invoiceId}.`;
}
