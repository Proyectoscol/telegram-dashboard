const inFlight = new Map<string, number>();
const waitQueues = new Map<string, Array<() => void>>();

/**
 * Runs fn with an in-process concurrency cap per key.
 * Useful for expensive API routes to avoid DB connection storms.
 */
export async function withConcurrencyLimit<T>(
  key: string,
  limit: number,
  fn: () => Promise<T>
): Promise<T> {
  if (!Number.isFinite(limit) || limit < 1) {
    return fn();
  }

  while ((inFlight.get(key) ?? 0) >= limit) {
    await new Promise<void>((resolve) => {
      const queue = waitQueues.get(key) ?? [];
      queue.push(resolve);
      waitQueues.set(key, queue);
    });
  }

  inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    const nextCount = (inFlight.get(key) ?? 1) - 1;
    if (nextCount <= 0) {
      inFlight.delete(key);
    } else {
      inFlight.set(key, nextCount);
    }

    const queue = waitQueues.get(key);
    if (queue && queue.length > 0) {
      const next = queue.shift();
      if (queue.length === 0) {
        waitQueues.delete(key);
      } else {
        waitQueues.set(key, queue);
      }
      next?.();
    }
  }
}
