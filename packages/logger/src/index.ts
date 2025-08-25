import { accessSync, constants, existsSync, mkdirSync } from "fs";
import pino, { LoggerOptions, Logger as PinoLogger } from "pino";

const isProd = process.env.NODE_ENV === "production";

export interface LoggerConfig {
  name?: string;
}

export class Logger {
  private logger: PinoLogger;

  constructor(config: LoggerConfig) {
    const name = config.name;
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

  info(msg: string, data?: Record<string, any>) {
    this.logger.info(data || {}, msg);
  }
  error(msg: string, err?: Error | Record<string, any> | unknown) {
    if (err instanceof Error) this.logger.error({ err, stack: err.stack }, msg);
    else this.logger.error(err || {}, msg);
  }
  warn(msg: string, data?: Record<string, any>) {
    this.logger.warn(data || {}, msg);
  }
  debug(msg: string, data?: Record<string, any>) {
    this.logger.debug(data || {}, msg);
  }
  trace(msg: string, data?: Record<string, any>) {
    this.logger.trace(data || {}, msg);
  }
  fatal(msg: string, err?: Error | Record<string, any>) {
    if (err instanceof Error) this.logger.fatal({ err, stack: err.stack }, msg);
    else this.logger.fatal(err || {}, msg);
  }

  child(bindings: Record<string, any>): Logger {
    const l = new Logger({ name: this.logger.bindings().name as string });
    l.logger = this.logger.child(bindings);
    return l;
  }

  getPinoLogger(): PinoLogger {
    return this.logger;
  }
}
