// Create logger with file output in production
import { Logger } from '@opengallery/logger';

const loggerConfig: any = {
  name: 'worker',
};

if (process.env['NODE_ENV'] === 'production') {
  loggerConfig.logFile = '/var/log/opengallery/worker.log';
}

export const logger = new Logger(loggerConfig);
