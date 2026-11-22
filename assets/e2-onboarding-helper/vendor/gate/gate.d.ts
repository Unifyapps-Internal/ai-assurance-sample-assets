import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { Telemetry } from './telemetry.js';
import type { Decision, GateRequest, GateResponse, GateStatus, Policy, PolicyStore, Retention } from './types.js';
export declare const GATE_VERSION = "1.0.0";
export declare const REFRESH_INTERVAL_MS = 5000;
export interface GateOptions {
    assetId: string;
    store: PolicyStore;
    /** ASSURANCE_GATE_SECRET. Without it the gate still enforces its policy but refuses every push with 503. */
    secret?: string;
    collectorEndpoint?: string;
    collectorApiKey?: string;
    /** The asset's built-in policy (gate.default.json), in force until the hub pushes one. */
    defaultPolicy: unknown;
    /** Where gate.log writes; the console by default. */
    sink?: (line: string) => void;
    /** Test seams. */
    now?: () => number;
    spanExporter?: SpanExporter;
}
export interface MaskOptions {
    role?: string;
}
export declare class Gate {
    readonly assetId: string;
    readonly trace: Telemetry;
    private readonly store;
    private readonly secret;
    private readonly now;
    private readonly sink;
    private current;
    private previous;
    private source;
    private lastAttempt;
    private lastRefresh;
    private storeError;
    private compiledFor;
    private compiled;
    constructor(options: GateOptions);
    /** The policy in force. Re-reads the store at most every five seconds; call it once at the start of a request. */
    policy(): Promise<Policy>;
    /**
     * Fail-safe refresh: a store that cannot be read, is empty, or holds an older version than the one in memory
     * never replaces the policy in memory.
     */
    private refresh;
    private applyPatterns;
    private logPatterns;
    private masks;
    /** Replaces every match of the policy's patterns, unless masking is off or the role is listed as unmasked. */
    maskText(text: string, options?: MaskOptions): string;
    /** maskText over every string inside a JSON-like value (object keys are left alone). */
    maskDeep<T>(value: T, options?: MaskOptions): T;
    /** Refuses prompt injection (when the policy says so) and any denied topic. */
    checkInput(text: string): Decision;
    /** The text an asset answers with when checkInput refuses. */
    refusal(): string;
    /** The AI label to show with generated content, or null when the policy does not ask for one. */
    label(): string | null;
    /** Role check against the policy's path map; the longest matching path prefix decides. */
    authorize(path: string, role: string | undefined): Decision;
    /** Writes one log line through the sink, masked when the policy asks for it. Returns what was written. */
    log(line: string): string;
    retention(): Retention;
    status(): Promise<GateStatus>;
    /**
     * Checks secret, freshness and either the body signature or a bearer token; returns the refusal, or null when the
     * request is authentic. The bearer form lets a caller keep the secret in an encrypted connection header instead of
     * computing a signature in a step whose inputs are logged (a UnifyApps workflow, platform-shapes section 5). Both
     * forms need a fresh ts, and a push or rollback is single-use through its version either way.
     */
    private authenticate;
    private commit;
    private push;
    /**
     * Body { policy: { rollback: true, assetId, version: <current policy version> }, ts, signature }, signed like a
     * push. Naming the current version makes the request single-use, and a captured push cannot be replayed here.
     */
    private rollback;
    /** Answers the /_assurance/* routes; returns null for any other path so the asset can carry on routing. */
    handle(request: GateRequest): Promise<GateResponse | null>;
}
export declare function createGate(options: GateOptions): Gate;
