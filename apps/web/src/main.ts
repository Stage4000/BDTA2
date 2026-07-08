import { startProductionWebServerFromDatabaseUrl } from "./bootstrap.js";
import { readWebServerConfig } from "./config.js";
import { installProcessLifecycleHandlers, resolveStartupEnvironment } from "@bdta/platform";

const environment = await resolveStartupEnvironment({
  processEnv: process.env
});
const config = readWebServerConfig(environment);
const runtime = await startProductionWebServerFromDatabaseUrl(config);
installProcessLifecycleHandlers({
  label: "bdta-web",
  shutdown: () => runtime.stop()
});
