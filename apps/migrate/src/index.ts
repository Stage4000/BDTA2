import { cutoverRehearsalReportSchema } from "@bdta/contracts";

export const migrationRuntimeManifest = {
  name: "bdta-migrate",
  surface: "migration",
  supports: {
    cutoverRehearsalReport: cutoverRehearsalReportSchema
  }
} as const;
