/**
 * Retries a model call when the provider answers 429 (quota or rate limit), waiting the delay the provider
 * asks for. The free tier allows a few requests a minute, so a burst of probes would otherwise fail.
 * Other errors are thrown at once. The total wait stays under the function's time budget.
 */
export const QUOTA_RETRIES = 2;
export const QUOTA_MAX_WAIT_MS = 12_000;

export function quotaDelayMs(error: unknown): number | undefined {
  const text = error instanceof Error ? error.message : String(error);
  if (!/\b429\b|RESOURCE_EXHAUSTED/.test(text)) return undefined;
  const asked = /retry in ([\d.]+)s/i.exec(text) ?? /"retryDelay":\s*"([\d.]+)s"/.exec(text);
  // A daily quota asks for hours ("retry in 19h3m59s" or a retryDelay of 68639s): waiting cannot help, fail now.
  if (/retry in \d+h/i.test(text) || /PerDay/.test(text)) return undefined;
  const seconds = asked ? Number(asked[1]) : 5;
  if (seconds * 1000 > QUOTA_MAX_WAIT_MS * 2) return undefined;
  return Math.min(Math.ceil(seconds * 1000) + 250, QUOTA_MAX_WAIT_MS);
}

export async function withQuotaRetry<T>(call: () => Promise<T>, sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const wait = quotaDelayMs(error);
      if (wait === undefined || attempt >= QUOTA_RETRIES) throw error;
      await sleep(wait);
    }
  }
}
