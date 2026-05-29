import { startProductionWebServerFromDatabaseUrl } from "./bootstrap.js";
import { readWebServerConfig } from "./config.js";

const config = readWebServerConfig(process.env);
await startProductionWebServerFromDatabaseUrl(config);
