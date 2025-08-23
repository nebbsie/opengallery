import { Logger as PinoLogger } from "pino";
export interface LoggerConfig {
    level?: string;
    name?: string;
    prettyPrint?: boolean;
    redact?: string[];
    logFile?: string | undefined;
}
export declare class Logger {
    private logger;
    constructor(config?: LoggerConfig);
    info(message: string, data?: Record<string, any>): void;
    error(message: string, error?: Error | Record<string, any>): void;
    warn(message: string, data?: Record<string, any>): void;
    debug(message: string, data?: Record<string, any>): void;
    trace(message: string, data?: Record<string, any>): void;
    fatal(message: string, error?: Error | Record<string, any>): void;
    child(bindings: Record<string, any>): Logger;
    getPinoLogger(): PinoLogger;
}
export declare const logger: Logger;
export declare const info: (message: string, data?: Record<string, any>) => void;
export declare const error: (message: string, e?: Error | Record<string, any>) => void;
export declare const warn: (message: string, data?: Record<string, any>) => void;
export declare const debug: (message: string, data?: Record<string, any>) => void;
export declare const trace: (message: string, data?: Record<string, any>) => void;
export declare const fatal: (message: string, e?: Error | Record<string, any>) => void;
export declare const child: (bindings: Record<string, any>) => Logger;
