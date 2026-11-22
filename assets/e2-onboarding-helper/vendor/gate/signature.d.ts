export declare const MAX_SKEW_MS: number;
/** hex(HMAC_SHA256(secret, ts + "." + JSON.stringify(payload))) */
export declare function sign(secret: string, ts: string | number, payload: unknown): string;
export declare function verifySignature(secret: string, ts: string | number, payload: unknown, signature: unknown): boolean;
/** Accepts epoch milliseconds, epoch seconds or an ISO string; returns epoch milliseconds or null. */
export declare function parseTimestamp(ts: unknown): number | null;
/** True when ts is within five minutes of now, in either direction. */
export declare function isFresh(ts: unknown, now: number): boolean;
/** A bearer token equals the secret, compared in constant time. */
export declare function verifyBearer(secret: string, token: string): boolean;
