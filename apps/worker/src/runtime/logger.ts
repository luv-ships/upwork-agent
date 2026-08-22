export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogValue = boolean | number | string | null | undefined;
export type LogContext = Readonly<Record<string, LogValue>>;

export interface Logger {
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext): void;
}

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function compactContext(context: LogContext | undefined): Record<string, Exclude<LogValue, undefined>> {
  if (context === undefined) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(context).filter(
      (entry): entry is [string, Exclude<LogValue, undefined>] => entry[1] !== undefined,
    ),
  );
}

export function createLogger(minimumLevel: LogLevel): Logger {
  function write(level: LogLevel, event: string, context?: LogContext): void {
    if (levelPriority[level] < levelPriority[minimumLevel]) {
      return;
    }

    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...compactContext(context),
    });

    if (level === "error") {
      process.stderr.write(`${record}\n`);
      return;
    }

    process.stdout.write(`${record}\n`);
  }

  return {
    debug: (event, context) => write("debug", event, context),
    info: (event, context) => write("info", event, context),
    warn: (event, context) => write("warn", event, context),
    error: (event, context) => write("error", event, context),
  };
}
