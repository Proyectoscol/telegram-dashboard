/**
 * Serializes persona generation so only one runs at a time.
 * Prevents DB/OpenAI overload when multiple users trigger generation concurrently.
 */
let tail: Promise<unknown> = Promise.resolve();

export function runPersonaSerial<T>(fn: () => Promise<T>): Promise<T> {
  const prev = tail;
  const next = prev.then(
    () => fn(),
    () => fn()
  );
  tail = next;
  return next as Promise<T>;
}
