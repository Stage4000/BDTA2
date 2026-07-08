import { z } from "zod";

import type { OutboundEmailMessage, Workflow, WorkflowEnrollment, WorkflowStep, WorkflowStepExecution } from "@bdta/domain";
import type { JobEnvelope } from "@bdta/contracts";

const workflowProcessorPayloadSchema = z.object({
  limit: z.number().int().positive().max(500).optional()
});

export type DueWorkflowStepExecutionRecord = {
  workflow: Workflow;
  enrollment: WorkflowEnrollment;
  step: WorkflowStep;
  execution: WorkflowStepExecution;
  recipientEmail: string;
  recipientDisplayName?: string | null;
};

export type WorkflowProcessorDependencies = {
  now(): string;
  listDueWorkflowStepExecutions(limit: number): Promise<DueWorkflowStepExecutionRecord[]>;
  queueWorkflowEmail(message: OutboundEmailMessage): Promise<void>;
  markWorkflowStepExecutionCompleted(executionId: string, completedAt: string): Promise<void>;
  buildPortalClientUrl(clientId: string): string;
};

function applyWorkflowPlaceholders(input: string, record: DueWorkflowStepExecutionRecord): string {
  const displayName = record.recipientDisplayName?.trim() || "there";
  return input
    .replaceAll("{client_name}", displayName)
    .replaceAll("{workflow_name}", record.workflow.name)
    .replaceAll("{step_name}", record.step.stepName);
}

export async function processWorkflowProcessorJob(
  job: JobEnvelope,
  dependencies: WorkflowProcessorDependencies
): Promise<string> {
  const payload = workflowProcessorPayloadSchema.parse(job.payload);
  const limit = payload.limit ?? 50;
  const dueExecutions = await dependencies.listDueWorkflowStepExecutions(limit);
  let processedCount = 0;

  for (const record of dueExecutions) {
    if (!record.workflow.active) {
      continue;
    }

    const portalUrl = dependencies.buildPortalClientUrl(record.enrollment.clientId);
    const messageHtml = applyWorkflowPlaceholders(record.step.emailBodyHtml, record);

    await dependencies.queueWorkflowEmail({
      to: [record.recipientEmail],
      subject: applyWorkflowPlaceholders(record.step.emailSubject, record),
      html: [
        messageHtml,
        `<p><a href="${portalUrl}">Open your portal</a></p>`
      ].join(""),
      templateKey: "workflow_step"
    });

    await dependencies.markWorkflowStepExecutionCompleted(record.execution.id, dependencies.now());
    processedCount += 1;
  }

  const label = processedCount === 1 ? "workflow step execution" : "workflow step executions";
  return `Processed ${processedCount} ${label}.`;
}
