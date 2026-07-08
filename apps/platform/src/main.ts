import { readPlatformServerConfig } from "./config.js";
import { startProductionPlatformServerFromDatabaseUrl } from "./bootstrap.js";
import { installProcessLifecycleHandlers, resolveStartupEnvironment } from "@bdta/platform";

const environment = await resolveStartupEnvironment({
  processEnv: process.env
});
const config = readPlatformServerConfig(environment);
const runtime = await startProductionPlatformServerFromDatabaseUrl(config);
installProcessLifecycleHandlers({
  label: "bdta-platform",
  shutdown: () => runtime.stop()
});
