import { runMigrationRehearsalFromDatabaseUrl } from "./bootstrap.js";
import { readMigrationConfig } from "./config.js";

const config = readMigrationConfig(process.env);
const runtime = await runMigrationRehearsalFromDatabaseUrl(config);

console.log(JSON.stringify(runtime.report, null, 2));
await runtime.closePool();
