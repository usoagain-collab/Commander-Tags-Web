import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry, isRetryable } from "./fetch-retry";

const respond = (status: number, headers: Record<string, string> = {}) => new Response(status === 200 ? "{}" : null, { status, headers });
const noSleep = () => Promise.resolve();

afterEach(() => vi.unstubAllGlobals());

describe("fetchWithRetry", () => {
  it("tries again after a 503 and returns the later success", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respond(503)).mockResolvedValueOnce(respond(200));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchWithRetry("https://example.test", {}, { sleep: noSleep });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(404));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchWithRetry("https://example.test", {}, { sleep: noSleep });
    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives back the last answer once the tries run out, waiting longer each time", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(respond(503)));
    vi.stubGlobal("fetch", fetchMock);
    const waits: number[] = [];
    const res = await fetchWithRetry("https://example.test", {}, { attempts: 3, baseDelayMs: 100, sleep: noSleep, onRetry: ({ waitMs }) => waits.push(waitMs) });
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([100, 200]);
  });

  it("waits as long as Retry-After asks", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respond(429, { "retry-after": "30" })).mockResolvedValueOnce(respond(200)));
    const waits: number[] = [];
    await fetchWithRetry("https://example.test", {}, { baseDelayMs: 100, sleep: noSleep, onRetry: ({ waitMs }) => waits.push(waitMs) });
    expect(waits).toEqual([30000]);
  });

  it("retries a dropped connection, then throws if it never comes back", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchWithRetry("https://example.test", {}, { attempts: 2, sleep: noSleep })).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats 429 and 5xx as worth retrying", () => {
    expect([429, 500, 502, 503].every(isRetryable)).toBe(true);
    expect([200, 400, 403, 404].some(isRetryable)).toBe(false);
  });
});
