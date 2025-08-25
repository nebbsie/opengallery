import { Worker, Job } from 'bullmq';

const connection = { url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' };

const worker = new Worker(
  'tasks', // queue name
  async (job: Job) => {
    console.log(`job ${job.id} ${job.name}`, job.data);
    // do work based on job.name and job.data
  },
  { connection, concurrency: 5 },
);
