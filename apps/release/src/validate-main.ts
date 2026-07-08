import path from "node:path";

import { runReleaseValidation } from "./main.js";

function writeAndExit(stream: NodeJS.WriteStream, text: string, exitCode: number): void {
  stream.write(text);
  process.exit(exitCode);
}

const externalVerificationDir = process.argv[2] == null
  ? null
  : path.resolve(process.cwd(), process.argv[2]);

void runReleaseValidation({
  externalVerificationDir
})
  .then((result) => {
    writeAndExit(
      process.stdout,
      `${result.reportPath}\n`,
      result.report.summary.validationReadinessPassed ? 0 : 1
    );
  })
  .catch((error) => {
    writeAndExit(
      process.stderr,
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
      1
    );
  });
