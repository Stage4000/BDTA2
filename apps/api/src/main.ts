import { startProductionApiServerFromDatabaseUrl } from "./bootstrap.js";
import { readApiServerConfig } from "./config.js";
import { installProcessLifecycleHandlers, resolveStartupEnvironment } from "@bdta/platform";

const environment = await resolveStartupEnvironment({
  processEnv: process.env
});
const config = readApiServerConfig(environment);
const runtime = await startProductionApiServerFromDatabaseUrl(config);
installProcessLifecycleHandlers({
  label: "bdta-api",
  shutdown: () => runtime.stop()
});
