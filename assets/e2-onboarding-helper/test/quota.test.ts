import { describe, expect, it } from 'vitest';
import { QUOTA_MAX_WAIT_MS, quotaDelayMs, withQuotaRetry } from '../src/quota.js';

const quotaError = new Error('{"error":{"code":429,"message":"Quota exceeded. Please retry in 1.16992295s.","status":"RESOURCE_EXHAUSTED"}}');

describe('quota retry', () => {
  it('reads the delay the provider asks for, and caps it', () => {
    expect(quotaDelayMs(quotaError)).toBe(1420);
    expect(quotaDelayMs(new Error('429 RESOURCE_EXHAUSTED retry in 20s'))).toBe(QUOTA_MAX_WAIT_MS);
    expect(quotaDelayMs(new Error('429 RESOURCE_EXHAUSTED retry in 90s'))).toBeUndefined();
    expect(quotaDelayMs(new Error('429 GenerateRequestsPerDayPerProjectPerModel-FreeTier. Please retry in 19h3m59.6s.'))).toBeUndefined();
    expect(quotaDelayMs(new Error('400 INVALID_ARGUMENT'))).toBeUndefined();
  });

  it('retries a 429 and returns the answer', async () => {
    const waits: number[] = [];
    let calls = 0;
    const answer = await withQuotaRetry(
      async () => {
        calls++;
        if (calls < 3) throw quotaError;
        return 'ok';
      },
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(answer).toBe('ok');
    expect(waits).toEqual([1420, 1420]);
  });

  it('throws any other error at once, and a 429 after the last retry', async () => {
    let calls = 0;
    await expect(withQuotaRetry(async () => { calls++; throw new Error('400 bad'); }, async () => {})).rejects.toThrow('400 bad');
    expect(calls).toBe(1);
    calls = 0;
    await expect(withQuotaRetry(async () => { calls++; throw quotaError; }, async () => {})).rejects.toThrow('429');
    expect(calls).toBe(3);
  });
});
