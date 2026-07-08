import { readJobWorkerConfig } from "./config.js";
import { startProductionJobWorkerFromDatabaseUrl } from "./bootstrap.js";
import { installProcessLifecycleHandlers, resolveStartupEnvironment } from "@bdta/platform";

const environment = await resolveStartupEnvironment({
  processEnv: process.env
});
const config = readJobWorkerConfig(environment);
const runtime = await startProductionJobWorkerFromDatabaseUrl(config);
installProcessLifecycleHandlers({
  label: "bdta-jobs",
  shutdown: () => runtime.stop()
});
