import pLimit from 'p-limit';

const DEFAULT_IO_CONCURRENCY = 2;

let ioLimiter = pLimit(DEFAULT_IO_CONCURRENCY);

export function setIoConcurrency(concurrency: number) {
  ioLimiter = pLimit(Math.max(1, concurrency));
}

export function getIoLimiter() {
  return ioLimiter;
}

export async function throttleIo<T>(fn: () => Promise<T>): Promise<T> {
  return ioLimiter(fn);
}
