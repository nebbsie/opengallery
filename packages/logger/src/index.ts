import { accessSync, constants, existsSync, mkdirSync } from "fs";
import pino, { Logger as PinoLogger, LoggerOptions } from "pino";

const isProd = process.env.NODE_ENV === "production";

export interface LoggerConfig {
  name: string;
  addToDb?: (
    type: "error" | "info" | "warn" | "debug",
    value: string,
    service: string,
  ) => Promise<void>;
}

export class Logger {
  private readonly logger: PinoLogger;

  constructor(private config: LoggerConfig) {
    const { name } = config;
    if (!name) throw new Error("Logger name is required");

    const base: LoggerOptions = {
      name,
      level: process.env.LOG_LEVEL || "info",
    };

    const targets: any[] = [
      {
        target: "pino-pretty",
        level: base.level,
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname",
          singleLine: false,
        },
      },
    ];

    if (isProd) {
      const logDir = `/var/log/opengallery`;
      const filePath = `${logDir}/${name}.log`;

      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
      try {
        accessSync(logDir, constants.W_OK);
      } catch {
        throw new Error(`Log directory not writable: ${logDir}`);
      }

      targets.push({
        target: "pino/file",
        level: base.level,
        options: { destination: filePath, append: true },
      });
    }

    const transport = pino.transport({ targets });
    this.logger = pino(base, transport);
  }

  private async saveToDb(
    type: "error" | "info" | "warn" | "debug",
    msg: string,
    data?: Record<string, any>,
  ) {
    const line =
      data && Object.keys(data).length > 0
        ? `${msg} ${JSON.stringify(data)}`
        : msg;

    if (!this.config.addToDb) return;
    await this.config.addToDb(type, line, this.config.name);
  }

  info(msg: string, data?: Record<string, any>) {
    this.logger.info(data || {}, msg);
    this.saveToDb("info", msg, data);
  }

  error(msg: string, err?: Error | Record<string, any> | unknown) {
    if (err instanceof Error) {
      this.logger.error({ err, stack: err.stack }, msg);
      this.saveToDb("error", msg, {
        error: err.message,
        stack: err.stack,
      });
    } else if (err && typeof err === "object") {
      this.logger.error(err, msg);
      this.saveToDb("error", msg, err as Record<string, any>);
    } else {
      this.logger.error({}, msg);
      this.saveToDb("error", msg);
    }
  }

  debug(msg: string, data?: Record<string, any>) {
    this.logger.debug(data || {}, msg);
  }

  warn(msg: string, data?: Record<string, any>) {
    this.logger.warn(data || {}, msg);
    this.saveToDb("warn", msg, data);
  }
}
