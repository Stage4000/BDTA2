import type { Setting } from "@bdta/domain";
import { requiredLaunchSettingsCatalog } from "@bdta/platform";

export {
  createManagedSettingsCatalog,
  managedSettingsCatalog,
  createRequiredLaunchSettingsCatalog,
  requiredLaunchSettingsCatalog,
  type ManagedSettingDefinition,
  type RequiredLaunchSettingCatalogMode,
  type RequiredLaunchSettingDefinition
} from "@bdta/platform";

export type SettingsCatalogEntryAssessment = {
  key: string;
  present: boolean;
  issues: string[];
};

export type SettingsCatalogAssessment = {
  ready: boolean;
  totalRequired: number;
  presentCount: number;
  adminCatalogPageCaptured: boolean;
  adminSettingDetailPageCaptured: boolean;
  entries: SettingsCatalogEntryAssessment[];
  blockingIssues: string[];
};

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

export function buildSettingsCatalogAssessment(input: {
  settings: Setting[];
  capturedPages: string[];
}): SettingsCatalogAssessment {
  const settingsByKey = new Map(input.settings.map((setting) => [setting.key, setting]));
  const entries: SettingsCatalogEntryAssessment[] = [...requiredLaunchSettingsCatalog.values()].map((definition) => {
    const setting = settingsByKey.get(definition.key);
    const issues: string[] = [];

    if (setting == null) {
      issues.push(`Settings catalog is missing required launch setting: ${definition.key}.`);
    } else {
      if (setting.label.trim() === "") {
        issues.push(`Settings catalog entry ${definition.key} is missing a label.`);
      }
      if (setting.description.trim() === "") {
        issues.push(`Settings catalog entry ${definition.key} is missing a description.`);
      }
      if (setting.category.trim() === "") {
        issues.push(`Settings catalog entry ${definition.key} is missing a category.`);
      }
      if (setting.type.trim() === "") {
        issues.push(`Settings catalog entry ${definition.key} is missing a type.`);
      }
      if (setting.secret !== definition.secret) {
        issues.push(
          definition.secret
            ? `Settings catalog entry ${definition.key} must be marked secret.`
            : `Settings catalog entry ${definition.key} must not be marked secret.`
        );
      }
    }

    return {
      key: definition.key,
      present: setting != null,
      issues
    };
  });

  const blockingIssues = unique([
    ...entries.flatMap((entry) => entry.issues),
    ...(input.capturedPages.includes("admin-settings")
      ? []
      : ["Release validation did not capture the admin settings catalog page."]),
    ...(input.capturedPages.includes("admin-setting-detail")
      ? []
      : ["Release validation did not capture the admin setting detail page."])
  ]);

  return {
    ready: blockingIssues.length === 0,
    totalRequired: requiredLaunchSettingsCatalog.size,
    presentCount: entries.filter((entry) => entry.present).length,
    adminCatalogPageCaptured: input.capturedPages.includes("admin-settings"),
    adminSettingDetailPageCaptured: input.capturedPages.includes("admin-setting-detail"),
    entries,
    blockingIssues
  };
}
