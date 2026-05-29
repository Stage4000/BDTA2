import { z } from "zod";

import type { OutboundEmailMessage, Workflow, WorkflowEnrollment } from "@bdta/domain";
import type { JobEnvelope } from "@bdta/contracts";

const workflowProcessorPayloadSchema = z.object({
  limit: z.number().int().positive().max(500).optional()
});

export type DueWorkflowEnrollmentRecord = {
  workflow: Workflow;
  enrollment: WorkflowEnrollment;
  recipientEmail: string;
  recipientDisplayName?: string | null;
};

export type WorkflowProcessorDependencies = {
  now(): string;
  listDueWorkflowEnrollments(limit: number): Promise<DueWorkflowEnrollmentRecord[]>;
  queueWorkflowEmail(message: OutboundEmailMessage): Promise<void>;
  markWorkflowEnrollmentCompleted(enrollmentId: string, completedAt: string): Promise<void>;
  buildPortalClientUrl(clientId: string): string;
};

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export async function processWorkflowProcessorJob(
  job: JobEnvelope,
  dependencies: WorkflowProcessorDependencies
): Promise<string> {
  const payload = workflowProcessorPayloadSchema.parse(job.payload);
  const limit = payload.limit ?? 50;
  const dueEnrollments = await dependencies.listDueWorkflowEnrollments(limit);
  let processedCount = 0;

  for (const record of dueEnrollments) {
    if (!record.workflow.active) {
      continue;
    }

    const portalUrl = dependencies.buildPortalClientUrl(record.enrollment.clientId);
    const displayName = record.recipientDisplayName?.trim() || "there";

    await dependencies.queueWorkflowEmail({
      to: [record.recipientEmail],
      subject: `Workflow: ${record.workflow.name}`,
      html: [
        `<p>Hello ${escapeHtml(displayName)},</p>`,
        `<p>This workflow update is part of "${escapeHtml(record.workflow.name)}".</p>`,
        `<p>Trigger: ${escapeHtml(record.workflow.trigger)}</p>`,
        `<p><a href="${portalUrl}">Open your portal</a></p>`
      ].join(""),
      templateKey: "workflow_notification"
    });

    await dependencies.markWorkflowEnrollmentCompleted(record.enrollment.id, dependencies.now());
    processedCount += 1;
  }

  const label = processedCount === 1 ? "enrollment" : "enrollments";
  return `Processed ${processedCount} workflow ${label}.`;
}
