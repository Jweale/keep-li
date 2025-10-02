type LogLevel = "debug" | "info" | "warn" | "error";

type LoggerContext = Record<string, unknown>;

type LogMetadata = Record<string, unknown> | undefined;

const levelToConsole: Record<LogLevel, (message?: unknown, ...optionalParams: unknown[]) => void> = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};

const SENSITIVE_KEYS = ["password", "token", "secret", "key", "authorization", "cookie"];

const redactValue = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    if (value.length <= 8) {
      return "[redacted]";
    }
    return `${value.slice(0, 4)}…${value.slice(-2)}`;
  }
  if (typeof value === "object") {
    return "[redacted]";
  }
  return "[redacted]";
};

export const sanitize = (input: unknown, depth = 0): unknown => {
  if (depth > 4) {
    return "[max-depth]";
  }
  if (input === null || input === undefined) {
    return input;
  }
  if (Array.isArray(input)) {
    return input.slice(0, 50).map((value) => sanitize(value, depth + 1));
  }
  if (typeof input === "object") {
    const record = input as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      const lower = key.toLowerCase();
      if (SENSITIVE_KEYS.some((needle) => lower.includes(needle))) {
        sanitized[key] = redactValue(value);
        continue;
      }
      sanitized[key] = sanitize(value, depth + 1);
    }
    return sanitized;
  }
  if (typeof input === "string" && input.length > 2000) {
    return `${input.slice(0, 2000)}…[truncated:${input.length}]`;
  }
  return input;
};

export class Logger {
  private readonly context: LoggerContext;

  constructor(context: LoggerContext = {}) {
    this.context = context;
  }

  child(context: LoggerContext = {}): Logger {
    return new Logger({ ...this.context, ...context });
  }

  debug(message: string, metadata?: LogMetadata) {
    this.emit("debug", message, metadata);
  }

  info(message: string, metadata?: LogMetadata) {
    this.emit("info", message, metadata);
  }

  warn(message: string, metadata?: LogMetadata) {
    this.emit("warn", message, metadata);
  }

  error(message: string, metadata?: LogMetadata) {
    this.emit("error", message, metadata);
  }

  private emit(level: LogLevel, message: string, metadata?: LogMetadata) {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: this.context,
      ...(metadata ? { metadata: sanitize(metadata) } : {})
    };
    try {
      levelToConsole[level](JSON.stringify(payload));
    } catch (error) {
      console.error("Logger serialization failed", error);
      levelToConsole[level](message);
    }
  }
}

export const createLogger = (context: LoggerContext = {}): Logger => new Logger(context);
