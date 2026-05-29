import { startProductionApiServerFromDatabaseUrl } from "./bootstrap.js";
import { readApiServerConfig } from "./config.js";

const config = readApiServerConfig(process.env);
await startProductionApiServerFromDatabaseUrl(config);
