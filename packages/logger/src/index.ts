import { accessSync, constants, existsSync, mkdirSync } from "fs";
import pino, { LoggerOptions, multistream, Logger as PinoLogger } from "pino";

const isProd = process.env.NODE_ENV === "production";

export interface LoggerConfig {
  name?: string; // only override allowed
}

export class Logger {
  private logger: PinoLogger;

  constructor(config: LoggerConfig) {
    const name = config.name;

    if (!name) {
      throw new Error("Logger name is required");
    }

    const base: LoggerOptions = {
      name,
      level: process.env.LOG_LEVEL || "info",
    };

    const streams: { stream: NodeJS.WritableStream }[] = [
      { stream: process.stdout },
    ];

    if (isProd) {
      const logDir = `/var/log/opengallery`;
      const filePath = `${logDir}/${name}.log`;

      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }

      try {
        accessSync(logDir, constants.W_OK);
      } catch {
        throw new Error(`Log directory not writable: ${logDir}`);
      }

      const fileStream = pino.destination({
        dest: filePath,
        append: true,
        sync: false,
      });
      // Workaround: SonicBoom (returned by pino.destination) does not have 'writable' property required by NodeJS.WritableStream type.
      // Cast to 'any' to satisfy the type checker.
      streams.push({ stream: fileStream as any });
    }

    this.logger = pino(base, multistream(streams));
  }

  info(msg: string, data?: Record<string, any>) {
    this.logger.info(data || {}, msg);
  }
  error(msg: string, err?: Error | Record<string, any>) {
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
