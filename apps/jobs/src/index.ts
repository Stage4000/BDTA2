import {
  runBackgroundCycle,
  type BackgroundCycleOptions,
  type BackgroundProcessorDependencies
} from "@bdta/application";
import { supportedJobKinds } from "@bdta/contracts";

export const jobRuntimeManifest = {
  name: "bdta-jobs",
  queue: "default",
  supportedJobKinds
} as const;

export function hasJobKind(kind: string): boolean {
  return jobRuntimeManifest.supportedJobKinds.includes(kind as (typeof supportedJobKinds)[number]);
}

export function buildJobRuntime(dependencies: BackgroundProcessorDependencies) {
  return {
    manifest: jobRuntimeManifest,
    processDueWork(options?: BackgroundCycleOptions) {
      return runBackgroundCycle(dependencies, options);
    }
  };
}
