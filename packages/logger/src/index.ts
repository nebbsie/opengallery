import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import pino, {
  DestinationStream,
  LoggerOptions,
  Logger as PinoLogger,
} from "pino";

export interface LoggerConfig {
  level?: string;
  name?: string;
  prettyPrint?: boolean;
  redact?: string[];
  logFile?: string | undefined;
}

const isProd = process.env.NODE_ENV === "production";
const isDev = !isProd;

export class Logger {
  private logger: PinoLogger;

  constructor(config: LoggerConfig = {}) {
    const {
      level = process.env.LOG_LEVEL || "info",
      name = process.env.SERVICE_NAME || "opengallery",
      prettyPrint = isDev,
      redact = ["password", "token", "secret", "key"],
      logFile = process.env.LOG_FILE,
    } = config;

    const base: LoggerOptions = {
      level,
      name,
      redact: { paths: redact, remove: true },
    };

    let dest: DestinationStream | undefined;

    if (isDev && prettyPrint) {
      base.transport = {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
          singleLine: false,
        },
      };
    }

    if (isProd && logFile) {
      const dir = dirname(logFile);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      // write directly to file stream in prod
      dest = pino.destination({ dest: logFile, append: true, sync: false });
    }

    this.logger = dest ? pino(base, dest) : pino(base);
  }

  info(message: string, data?: Record<string, any>): void {
    this.logger.info(data || {}, message);
  }
  error(message: string, error?: Error | Record<string, any>): void {
    if (error instanceof Error) {
      this.logger.error({ err: error, stack: error.stack }, message);
    } else {
      this.logger.error(error || {}, message);
    }
  }
  warn(message: string, data?: Record<string, any>): void {
    this.logger.warn(data || {}, message);
  }
  debug(message: string, data?: Record<string, any>): void {
    this.logger.debug(data || {}, message);
  }
  trace(message: string, data?: Record<string, any>): void {
    this.logger.trace(data || {}, message);
  }
  fatal(message: string, error?: Error | Record<string, any>): void {
    if (error instanceof Error) {
      this.logger.fatal({ err: error, stack: error.stack }, message);
    } else {
      this.logger.fatal(error || {}, message);
    }
  }

  child(bindings: Record<string, any>): Logger {
    const child = new Logger();
    child.logger = this.logger.child(bindings);
    return child;
  }

  getPinoLogger(): PinoLogger {
    return this.logger;
  }
}

export const logger = new Logger();

export const info = (message: string, data?: Record<string, any>) =>
  logger.info(message, data);
export const error = (message: string, e?: Error | Record<string, any>) =>
  logger.error(message, e);
export const warn = (message: string, data?: Record<string, any>) =>
  logger.warn(message, data);
export const debug = (message: string, data?: Record<string, any>) =>
  logger.debug(message, data);
export const trace = (message: string, data?: Record<string, any>) =>
  logger.trace(message, data);
export const fatal = (message: string, e?: Error | Record<string, any>) =>
  logger.fatal(message, e);
export const child = (bindings: Record<string, any>) => logger.child(bindings);
