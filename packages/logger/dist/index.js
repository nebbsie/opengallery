import { accessSync, constants, existsSync, mkdirSync } from "fs";
import pino, { multistream } from "pino";
const isProd = process.env.NODE_ENV === "production";
export class Logger {
    logger;
    constructor(config) {
        const name = config.name;
        if (!name) {
            throw new Error("Logger name is required");
        }
        const base = {
            name,
            level: process.env.LOG_LEVEL || "info",
        };
        const streams = [
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
            }
            catch {
                throw new Error(`Log directory not writable: ${logDir}`);
            }
            const fileStream = pino.destination({
                dest: filePath,
                append: true,
                sync: false,
            });
            // Workaround: SonicBoom (returned by pino.destination) does not have 'writable' property required by NodeJS.WritableStream type.
            // Cast to 'any' to satisfy the type checker.
            streams.push({ stream: fileStream });
        }
        this.logger = pino(base, multistream(streams));
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
