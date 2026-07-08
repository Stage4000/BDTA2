import {
  cutoverExecutionReportSchema,
  cutoverRehearsalReportSchema,
  launchPreflightReportSchema
} from "@bdta/contracts";

export const migrationRuntimeManifest = {
  name: "bdta-migrate",
  surface: "migration",
  supports: {
    cutoverRehearsalReport: cutoverRehearsalReportSchema,
    launchPreflightReport: launchPreflightReportSchema,
    cutoverExecutionReport: cutoverExecutionReportSchema
  }
} as const;
