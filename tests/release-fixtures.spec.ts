import { createReleaseValidationState } from "../apps/release/src/fixtures.js";
import { requiredLaunchSettingsCatalog } from "../apps/release/src/settings-catalog.js";

describe("release validation fixtures", () => {
  it("provisions public-access tokens for every tokenized release artifact row", () => {
    const state = createReleaseValidationState();

    expect(state.quotes.every((item) => item.publicAccess?.token?.trim())).toBe(true);
    expect(state.contracts.every((item) => item.publicAccess?.token?.trim())).toBe(true);
    expect(state.formSubmissions.every((item) => item.publicAccess?.token?.trim())).toBe(true);
    expect(state.bookings.every((item) => item.icalAccess?.token?.trim())).toBe(true);
  });

  it("includes a portal follow-up review notification artifact", () => {
    const state = createReleaseValidationState() as {
      notifications?: Array<{
        channel?: string;
        subject?: string;
        url?: string;
      }>;
    };

    expect(state.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "portal",
          subject: "New follow-up note available",
          url: `/portal/forms/form-1`
        })
      ])
    );
  });

  it("includes the full launch settings catalog for UI-managed production configuration", () => {
    const state = createReleaseValidationState();
    const settingKeys = new Set(state.settings.map((setting) => setting.key));

    expect([...requiredLaunchSettingsCatalog.keys()]).toEqual(
      expect.arrayContaining([...settingKeys].filter((key) => requiredLaunchSettingsCatalog.has(key)))
    );
    for (const key of requiredLaunchSettingsCatalog.keys()) {
      expect(settingKeys.has(key)).toBe(true);
    }
    expect(settingKeys.has("newsletter_embed_html")).toBe(true);
    expect(settingKeys.has("public_notice_enabled")).toBe(true);
    expect(settingKeys.has("public_notice_text")).toBe(true);
    expect(settingKeys.has("facebook_url")).toBe(true);
    expect(settingKeys.has("custom_social_link_1_url")).toBe(true);
    expect(settingKeys.has("google_calendar_enabled")).toBe(true);
    expect(settingKeys.has("smtp_password")).toBe(true);
  });

  it("seeds workflow fixtures for release parity validation", () => {
    const state = createReleaseValidationState() as {
      workflows?: Array<{ id?: string; name?: string }>;
      workflowTriggers?: Array<{ id?: string; workflowId?: string; triggerType?: string; appointmentTypeId?: string | null }>;
      workflowEnrollments?: Array<{ id?: string; workflowId?: string; clientId?: string }>;
      workflowSteps?: Array<{ id?: string; workflowId?: string; stepName?: string }>;
      workflowStepExecutions?: Array<{ id?: string; enrollmentId?: string; stepId?: string; status?: string }>;
      scheduledTasks?: Array<{ taskType?: string; active?: boolean }>;
      queuedJobs?: Array<{ kind?: string; payload?: Record<string, unknown> }>;
    };

    expect(state.workflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "workflow-1",
          name: "Welcome Series"
        })
      ])
    );
    expect(state.workflowTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "workflow-trigger-1",
          workflowId: "workflow-1",
          triggerType: "appointment_booking",
          appointmentTypeId: "appointment-type-1"
        })
      ])
    );
    expect(state.workflowEnrollments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "workflow-enrollment-1",
          workflowId: "workflow-1",
          clientId: "client-portal-1"
        })
      ])
    );
    expect(state.workflowSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "workflow-step-1",
          workflowId: "workflow-1",
          stepName: "Welcome Email"
        })
      ])
    );
    expect(state.workflowStepExecutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "workflow-step-execution-1",
          enrollmentId: "workflow-enrollment-1",
          stepId: "workflow-step-1",
          status: "pending"
        })
      ])
    );
    expect(state.scheduledTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskType: "workflow_processor",
          active: true
        })
      ])
    );
    expect(state.queuedJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "workflow_processor",
          payload: {
            limit: 10
          }
        })
      ])
    );
  });
});
