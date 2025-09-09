import { Logger } from '@opengallery/logger';
import { trpc } from './trpc.js';

export const logger = new Logger({
  name: 'worker',
  addToDb: async (type, value, service) => {
    await trpc.log.create.mutate({ type, value, service });
  },
});
