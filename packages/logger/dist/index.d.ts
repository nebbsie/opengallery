export interface LoggerConfig {
    name: string;
    addToDb?: (type: "error" | "info" | "warn" | "debug", value: string, service: string) => Promise<void>;
}
export declare class Logger {
    private config;
    private readonly logger;
    constructor(config: LoggerConfig);
    private saveToDb;
    info(msg: string, data?: Record<string, any>): Promise<void>;
    error(msg: string, err?: Error | Record<string, any> | unknown): Promise<void>;
    debug(msg: string, data?: Record<string, any>): Promise<void>;
    warn(msg: string, data?: Record<string, any>): Promise<void>;
}
