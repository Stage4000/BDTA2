import { runMigrationCli } from "./cli.js";
import { resolveStartupEnvironment } from "@bdta/platform";

const environment = await resolveStartupEnvironment({
  processEnv: process.env
});
process.exitCode = await runMigrationCli({
  env: environment,
  writeLine(line) {
    console.log(line);
  }
});
