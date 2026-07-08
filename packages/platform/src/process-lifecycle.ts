type ProcessLike = {
  exitCode?: number | string | null;
  once(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
};

type LoggerLike = Pick<Console, "error">;

type LifecycleOptions = {
  processRef?: ProcessLike;
  logger?: LoggerLike;
  label: string;
  shutdown: () => Promise<void> | void;
};

function setSuccessExitCode(processRef: ProcessLike) {
  processRef.exitCode = processRef.exitCode ?? 0;
}

function setFailureExitCode(processRef: ProcessLike) {
  if (processRef.exitCode == null || processRef.exitCode === 0 || processRef.exitCode === "0") {
    processRef.exitCode = 1;
  }
}

export function installProcessLifecycleHandlers(options: LifecycleOptions): () => void {
  const processRef = options.processRef ?? process;
  const logger = options.logger ?? console;
  let shuttingDown: Promise<void> | null = null;

  const runShutdown = (markExitCode: () => void) => {
    if (shuttingDown == null) {
      shuttingDown = Promise.resolve()
        .then(() => options.shutdown())
        .catch((error) => {
          logger.error(`[${options.label}] shutdown failed`, error);
          setFailureExitCode(processRef);
        })
        .finally(() => {
          markExitCode();
        });
      return;
    }

    markExitCode();
  };

  const handleSignal = () => {
    runShutdown(() => {
      setSuccessExitCode(processRef);
    });
  };

  const handleFatalError = (error: unknown) => {
    logger.error(`[${options.label}] fatal process error`, error);
    runShutdown(() => {
      setFailureExitCode(processRef);
    });
  };

  processRef.once("SIGINT", handleSignal);
  processRef.once("SIGTERM", handleSignal);
  processRef.once("uncaughtException", handleFatalError);
  processRef.once("unhandledRejection", handleFatalError);

  return () => {
    processRef.removeListener("SIGINT", handleSignal);
    processRef.removeListener("SIGTERM", handleSignal);
    processRef.removeListener("uncaughtException", handleFatalError);
    processRef.removeListener("unhandledRejection", handleFatalError);
  };
}
