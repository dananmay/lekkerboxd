const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_DEADLINE_MS = 4000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_FACTOR = 2;

export interface FetchRetryOptions {
  maxRetries?: number;
  deadlineMs?: number;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const parsedDate = Date.parse(value);
  if (Number.isNaN(parsedDate)) return null;

  return Math.max(0, parsedDate - Date.now());
}

function computeBackoffMs(attempt: number): number {
  const raw = BACKOFF_BASE_MS * (BACKOFF_FACTOR ** attempt);
  const jitter = 0.8 + (Math.random() * 0.4); // +/-20%
  return Math.max(0, Math.round(raw * jitter));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    let onAbort: (() => void) | undefined;
    if (signal) {
      onAbort = () => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort!);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function buildAttemptSignal(
  upstream: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));

  if (!upstream) {
    return {
      signal: controller.signal,
      cleanup: () => clearTimeout(timeout),
    };
  }

  if (upstream.aborted) {
    controller.abort();
    return {
      signal: controller.signal,
      cleanup: () => clearTimeout(timeout),
    };
  }

  const onAbort = () => controller.abort();
  upstream.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      upstream.removeEventListener('abort', onAbort);
    },
  };
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: FetchRetryOptions = {},
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return fetch(url, init);
  }

  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const startedAt = Date.now();
  const upstreamSignal = init.signal ?? undefined;

  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const elapsed = Date.now() - startedAt;
    const remaining = deadlineMs - elapsed;
    if (remaining <= 0) break;

    const { signal, cleanup } = buildAttemptSignal(upstreamSignal, remaining);
    try {
      const response = await fetch(url, { ...init, signal });
      if (!isRetryableStatus(response.status)) return response;

      lastResponse = response;
      if (attempt >= maxRetries) break;

      const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
      const delayMs = retryAfterMs ?? computeBackoffMs(attempt);
      const boundedDelay = Math.min(delayMs, Math.max(0, deadlineMs - (Date.now() - startedAt)));
      if (boundedDelay <= 0) break;

      const reason = response.status === 429 ? '429' : '5xx';
      console.warn(`[Lekkerboxd Retry] ${method} ${url} retry ${attempt + 1}/${maxRetries} in ${boundedDelay}ms (${reason})`);
      await sleep(boundedDelay, upstreamSignal);
      continue;
    } catch (error) {
      if (upstreamSignal?.aborted) throw error;
      lastError = error;
      if (attempt >= maxRetries) break;

      const delayMs = computeBackoffMs(attempt);
      const boundedDelay = Math.min(delayMs, Math.max(0, deadlineMs - (Date.now() - startedAt)));
      if (boundedDelay <= 0) break;

      const reason = isAbortError(error) ? 'timeout' : 'network';
      console.warn(`[Lekkerboxd Retry] ${method} ${url} retry ${attempt + 1}/${maxRetries} in ${boundedDelay}ms (${reason})`);
      await sleep(boundedDelay, upstreamSignal);
      continue;
    } finally {
      cleanup();
    }
  }

  if (lastResponse) return lastResponse;
  if (lastError) throw lastError;
  throw new Error(`fetchWithRetry deadline exceeded for ${url}`);
}
