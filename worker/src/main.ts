import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import { encode } from './encode.js';

const connection = { url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' };

new Worker(
  'tasks',
  async (job: Job) => {
    switch (job.name) {
      case 'encode': {
        const fileId = job.data?.fileId;

        if (fileId == null) {
          console.log('Missing fileId in job data');
          break;
        }

        if (typeof fileId !== 'string') {
          console.log('Invalid fileId in job data');
          break;
        }

        try {
          await encode(fileId);
        } catch (error) {
          console.error(error);
        }

        break;
      }
      default: {
        console.log(`Unknown job name: ${job.name}`);
        break;
      }
    }
  },
  { connection, concurrency: 5 },
);
