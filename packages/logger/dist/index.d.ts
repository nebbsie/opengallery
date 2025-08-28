import { Logger as PinoLogger } from "pino";
export interface LoggerConfig {
    name?: string;
}
export declare class Logger {
    private logger;
    constructor(config: LoggerConfig);
    info(msg: string, data?: Record<string, any>): void;
    error(msg: string, err?: Error | Record<string, any> | unknown): void;
    warn(msg: string, data?: Record<string, any>): void;
    debug(msg: string, data?: Record<string, any>): void;
    trace(msg: string, data?: Record<string, any>): void;
    fatal(msg: string, err?: Error | Record<string, any>): void;
    child(bindings: Record<string, any>): Logger;
    getPinoLogger(): PinoLogger;
}
