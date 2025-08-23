import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import pino from "pino";
const isProd = process.env.NODE_ENV === "production";
const isDev = !isProd;
export class Logger {
    logger;
    constructor(config = {}) {
        const { level = process.env.LOG_LEVEL || "info", name = process.env.SERVICE_NAME || "opengallery", prettyPrint = isDev, redact = ["password", "token", "secret", "key"], logFile = process.env.LOG_FILE, } = config;
        const base = {
            level,
            name,
            redact: { paths: redact, remove: true },
        };
        let dest;
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
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            // write directly to file stream in prod
            dest = pino.destination({ dest: logFile, append: true, sync: false });
        }
        this.logger = dest ? pino(base, dest) : pino(base);
    }
    info(message, data) {
        this.logger.info(data || {}, message);
    }
    error(message, error) {
        if (error instanceof Error) {
            this.logger.error({ err: error, stack: error.stack }, message);
        }
        else {
            this.logger.error(error || {}, message);
        }
    }
    warn(message, data) {
        this.logger.warn(data || {}, message);
    }
    debug(message, data) {
        this.logger.debug(data || {}, message);
    }
    trace(message, data) {
        this.logger.trace(data || {}, message);
    }
    fatal(message, error) {
        if (error instanceof Error) {
            this.logger.fatal({ err: error, stack: error.stack }, message);
        }
        else {
            this.logger.fatal(error || {}, message);
        }
    }
    child(bindings) {
        const child = new Logger();
        child.logger = this.logger.child(bindings);
        return child;
    }
    getPinoLogger() {
        return this.logger;
    }
}
export const logger = new Logger();
export const info = (message, data) => logger.info(message, data);
export const error = (message, e) => logger.error(message, e);
export const warn = (message, data) => logger.warn(message, data);
export const debug = (message, data) => logger.debug(message, data);
export const trace = (message, data) => logger.trace(message, data);
export const fatal = (message, e) => logger.fatal(message, e);
export const child = (bindings) => logger.child(bindings);
