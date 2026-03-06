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
    // #region agent log
    fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',runId:`limit:${key}`,hypothesisId:'H1',location:'lib/concurrency.ts:17',message:'withConcurrencyLimit waiting',data:{key,limit,inFlight:inFlight.get(key) ?? 0,queueLength:(waitQueues.get(key) ?? []).length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
