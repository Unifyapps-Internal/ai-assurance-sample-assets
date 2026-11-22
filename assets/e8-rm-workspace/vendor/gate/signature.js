import { createHmac, timingSafeEqual } from 'node:crypto';
export const MAX_SKEW_MS = 5 * 60 * 1000;
/** hex(HMAC_SHA256(secret, ts + "." + JSON.stringify(payload))) */
export function sign(secret, ts, payload) {
    return createHmac('sha256', secret).update(`${ts}.${JSON.stringify(payload)}`).digest('hex');
}
export function verifySignature(secret, ts, payload, signature) {
    if (typeof signature !== 'string')
        return false;
    const expected = Buffer.from(sign(secret, ts, payload), 'utf8');
    const given = Buffer.from(signature.toLowerCase(), 'utf8');
    return expected.length === given.length && timingSafeEqual(expected, given);
}
/** Accepts epoch milliseconds, epoch seconds or an ISO string; returns epoch milliseconds or null. */
export function parseTimestamp(ts) {
    if (typeof ts === 'number' && Number.isFinite(ts))
        return ts < 1e11 ? ts * 1000 : ts;
    if (typeof ts === 'string' && ts.trim() !== '') {
        if (/^\d+$/.test(ts))
            return parseTimestamp(Number(ts));
        const parsed = Date.parse(ts);
        return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
}
/** True when ts is within five minutes of now, in either direction. */
export function isFresh(ts, now) {
    const at = parseTimestamp(ts);
    return at !== null && Math.abs(now - at) <= MAX_SKEW_MS;
}
/** A bearer token equals the secret, compared in constant time. */
export function verifyBearer(secret, token) {
    const a = Buffer.from(secret, 'utf8');
    const b = Buffer.from(token, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
}
