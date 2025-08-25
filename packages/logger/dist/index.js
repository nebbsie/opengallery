import { accessSync, constants, existsSync, mkdirSync } from "fs";
import pino from "pino";
const isProd = process.env.NODE_ENV === "production";
export class Logger {
    logger;
    constructor(config) {
        const name = config.name;
        if (!name)
            throw new Error("Logger name is required");
        const base = {
            name,
            level: process.env.LOG_LEVEL || "info",
        };
        const targets = [
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
            if (!existsSync(logDir))
                mkdirSync(logDir, { recursive: true });
            try {
                accessSync(logDir, constants.W_OK);
            }
            catch {
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
    info(msg, data) {
        this.logger.info(data || {}, msg);
    }
    error(msg, err) {
        if (err instanceof Error)
            this.logger.error({ err, stack: err.stack }, msg);
        else
            this.logger.error(err || {}, msg);
    }
    warn(msg, data) {
        this.logger.warn(data || {}, msg);
    }
    debug(msg, data) {
        this.logger.debug(data || {}, msg);
    }
    trace(msg, data) {
        this.logger.trace(data || {}, msg);
    }
    fatal(msg, err) {
        if (err instanceof Error)
            this.logger.fatal({ err, stack: err.stack }, msg);
        else
            this.logger.fatal(err || {}, msg);
    }
    child(bindings) {
        const l = new Logger({ name: this.logger.bindings().name });
        l.logger = this.logger.child(bindings);
        return l;
    }
    getPinoLogger() {
        return this.logger;
    }
}
