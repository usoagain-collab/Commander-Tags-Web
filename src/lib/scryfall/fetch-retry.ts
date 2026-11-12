// A fetch that waits and tries again when the server is busy or briefly down (HTTP 429 or 5xx, or a dropped
// connection). Used by the nightly import: on Nov 12, 2026 Scryfall answered 503 to the very first request and
// the whole run failed, though a retry a minute later would have worked.

export type RetryOptions = {
  /** Tries in all, the first one included. */
  attempts?: number;
  /** Wait before the second try, in ms; it doubles after each try. */
  baseDelayMs?: number;
  /** Called before each wait, for logging. */
  onRetry?: (info: { attempt: number; waitMs: number; reason: string }) => void;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** True for answers worth trying again: too many requests, or a server-side error. */
export const isRetryable = (status: number) => status === 429 || status >= 500;

export async function fetchWithRetry(url: string, init: RequestInit = {}, options: RetryOptions = {}): Promise<Response> {
  const { attempts = 6, baseDelayMs = 5000, onRetry, sleep = defaultSleep } = options;
  for (let attempt = 1; ; attempt++) {
    let reason: string;
    let retryAfterMs = 0;
    try {
      const res = await fetch(url, init);
      if (!isRetryable(res.status) || attempt >= attempts) return res;
      reason = `HTTP ${res.status}`;
      retryAfterMs = (Number(res.headers.get("retry-after")) || 0) * 1000;
      await res.body?.cancel().catch(() => {});
    } catch (err) {
      if (attempt >= attempts) throw err;
      reason = err instanceof Error ? err.message : String(err);
    }
    const waitMs = Math.max(retryAfterMs, baseDelayMs * 2 ** (attempt - 1));
    onRetry?.({ attempt, waitMs, reason });
    await sleep(waitMs);
  }
}
