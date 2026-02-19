/**
 * Per-key async mutex for chrome.storage.local operations.
 *
 * Prevents lost-update races when multiple concurrent callers do
 * read → mutate → write on the same storage key. Each call for a
 * given key is queued behind the previous one.
 */

const locks = new Map<string, Promise<unknown>>();

export function withStorageLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();

  const next = prev
    .catch(() => {}) // don't let a previous failure block the queue
    .then(() => fn());

  // Store the chain so the next caller waits for us
  locks.set(key, next);

  // Clean up the map entry when the chain settles to avoid memory leaks
  next.finally(() => {
    if (locks.get(key) === next) {
      locks.delete(key);
    }
  });

  return next;
}
