import { readJobWorkerConfig } from "./config.js";
import { startProductionJobWorkerFromDatabaseUrl } from "./bootstrap.js";

const config = readJobWorkerConfig(process.env);
await startProductionJobWorkerFromDatabaseUrl(config);
