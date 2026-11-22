import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { detectInjection, normaliseText } from './injection.js';
import { BUILT_IN_PATTERNS, PolicyError, normalisePolicy } from './policy.js';
import { isFresh, verifyBearer, verifySignature } from './signature.js';
import { Telemetry } from './telemetry.js';
import type { Decision, GateRequest, GateResponse, GateStatus, MaskPattern, Policy, PolicyStore, Retention } from './types.js';

export const GATE_VERSION = '1.0.0';
export const REFRESH_INTERVAL_MS = 5000;

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

export class Gate {
  readonly assetId: string;
  readonly trace: Telemetry;
  private readonly store: PolicyStore;
  private readonly secret: string | undefined;
  private readonly now: () => number;
  private readonly sink: (line: string) => void;
  private current: Policy;
  private previous: Policy | null = null;
  private source: GateStatus['policySource'] = 'default';
  private lastAttempt = Number.NEGATIVE_INFINITY;
  private lastRefresh: string | null = null;
  private storeError: string | null = null;
  private compiledFor: MaskPattern[] | null = null;
  private compiled: { pattern: RegExp; replace: string }[] = [];

  constructor(options: GateOptions) {
    this.assetId = options.assetId;
    this.store = options.store;
    this.secret = options.secret || undefined;
    this.now = options.now ?? Date.now;
    this.sink = options.sink ?? ((line) => console.log(line));
    this.current = normalisePolicy(options.defaultPolicy, options.assetId);
    this.trace = new Telemetry({
      assetId: options.assetId,
      collectorEndpoint: options.collectorEndpoint || undefined,
      collectorApiKey: options.collectorApiKey || undefined,
      spanExporter: options.spanExporter,
      enabled: () => this.current.telemetry.enabled,
      mask: (text) => (this.current.logging.maskPersonalData ? this.applyPatterns(text, this.logPatterns()) : text),
    });
  }

  /** The policy in force. Re-reads the store at most every five seconds; call it once at the start of a request. */
  async policy(): Promise<Policy> {
    if (this.now() - this.lastAttempt >= REFRESH_INTERVAL_MS) await this.refresh();
    return this.current;
  }

  /**
   * Fail-safe refresh: a store that cannot be read, is empty, or holds an older version than the one in memory
   * never replaces the policy in memory.
   */
  private async refresh(): Promise<void> {
    this.lastAttempt = this.now();
    try {
      const stored = await this.store.read();
      this.storeError = null;
      this.lastRefresh = new Date(this.now()).toISOString();
      if (!stored) return;
      const incoming = normalisePolicy(stored.current, this.assetId);
      if (incoming.version <= this.current.version) return;
      this.current = incoming;
      this.previous = stored.previous ? normalisePolicy(stored.previous, this.assetId) : null;
      this.source = 'store';
    } catch (error) {
      this.storeError = error instanceof Error ? error.message : String(error);
      if (this.source === 'store') this.source = 'memory';
    }
  }

  // ------------------------------------------------------------------ enforcement (synchronous, on the cached policy)

  private applyPatterns(text: string, patterns: MaskPattern[]): string {
    if (this.compiledFor !== patterns) {
      this.compiled = patterns.map((p) => ({ pattern: new RegExp(p.regex, 'g'), replace: p.replace }));
      this.compiledFor = patterns;
    }
    return this.compiled.reduce((out, { pattern, replace }) => out.replace(pattern, () => replace), text);
  }

  private logPatterns(): MaskPattern[] {
    return this.current.masking.patterns.length > 0 ? this.current.masking.patterns : BUILT_IN_PATTERNS;
  }

  private masks(role: string | undefined): boolean {
    const { enabled, unmaskedRoles } = this.current.masking;
    return enabled && !(role !== undefined && unmaskedRoles.includes(role));
  }

  /** Replaces every match of the policy's patterns, unless masking is off or the role is listed as unmasked. */
  maskText(text: string, options: MaskOptions = {}): string {
    return this.masks(options.role) ? this.applyPatterns(text, this.current.masking.patterns) : text;
  }

  /** maskText over every string inside a JSON-like value (object keys are left alone). */
  maskDeep<T>(value: T, options: MaskOptions = {}): T {
    if (!this.masks(options.role)) return value;
    const walk = (v: unknown): unknown => {
      if (typeof v === 'string') return this.applyPatterns(v, this.current.masking.patterns);
      if (Array.isArray(v)) return v.map(walk);
      if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
      return v;
    };
    return walk(value) as T;
  }

  /** Refuses prompt injection (when the policy says so) and any denied topic. */
  checkInput(text: string): Decision {
    const { refuseInjection, deniedTopics } = this.current.input;
    if (refuseInjection) {
      const rule = detectInjection(text);
      if (rule) return { allowed: false, reason: `prompt injection: ${rule}` };
    }
    const normalised = normaliseText(text);
    for (const topic of deniedTopics) {
      if (topic.phrases.some((phrase) => phrase.trim() !== '' && normalised.includes(normaliseText(phrase)))) {
        return { allowed: false, reason: `denied topic: ${topic.name}` };
      }
    }
    return { allowed: true, reason: null };
  }

  /** The text an asset answers with when checkInput refuses. */
  refusal(): string {
    return this.current.input.refusal;
  }

  /** The AI label to show with generated content, or null when the policy does not ask for one. */
  label(): string | null {
    return this.current.aiLabel.enabled ? this.current.aiLabel.text : null;
  }

  /** Role check against the policy's path map; the longest matching path prefix decides. */
  authorize(path: string, role: string | undefined): Decision {
    const { enforce, map } = this.current.roles;
    if (!enforce) return { allowed: true, reason: null };
    const clean = path.split('?')[0] ?? path;
    const prefix = Object.keys(map)
      .filter((p) => clean === p || clean.startsWith(p.endsWith('/') ? p : `${p}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (prefix === undefined) return { allowed: true, reason: null };
    const allowed = role !== undefined && (map[prefix] ?? []).includes(role);
    return allowed ? { allowed, reason: null } : { allowed, reason: `role ${role ?? 'none'} may not open ${prefix}` };
  }

  /** Writes one log line through the sink, masked when the policy asks for it. Returns what was written. */
  log(line: string): string {
    const written = this.current.logging.maskPersonalData ? this.applyPatterns(line, this.logPatterns()) : line;
    this.sink(written);
    return written;
  }

  retention(): Retention {
    return { ...this.current.retention };
  }

  // ------------------------------------------------------------------ HTTP

  async status(): Promise<GateStatus> {
    const policy = await this.policy();
    return {
      assetId: this.assetId,
      gateVersion: GATE_VERSION,
      policyVersion: policy.version,
      issuedAt: policy.issuedAt,
      policy: structuredClone(policy),
      storeKind: this.store.kind,
      lastRefresh: this.lastRefresh,
      policySource: this.source,
      storeError: this.storeError,
      acceptsPushes: this.secret !== undefined,
    };
  }

  /**
   * Checks secret, freshness and either the body signature or a bearer token; returns the refusal, or null when the
   * request is authentic. The bearer form lets a caller keep the secret in an encrypted connection header instead of
   * computing a signature in a step whose inputs are logged (a UnifyApps workflow, platform-shapes section 5). Both
   * forms need a fresh ts, and a push or rollback is single-use through its version either way.
   */
  private authenticate(body: Record<string, unknown>, authorization?: string): GateResponse | null {
    if (!this.secret) return { status: 503, body: { error: 'ASSURANCE_GATE_SECRET is not configured; pushes are rejected' } };
    const { ts, signature, policy } = body;
    if ((typeof ts !== 'string' && typeof ts !== 'number') || !isFresh(ts, this.now())) {
      return { status: 401, body: { error: 'ts is missing or more than five minutes from now' } };
    }
    const bearer = /^Bearer\s+(.+)$/i.exec((authorization ?? '').trim())?.[1];
    if (bearer !== undefined) return verifyBearer(this.secret, bearer) ? null : { status: 401, body: { error: 'bad token' } };
    if (!verifySignature(this.secret, ts, policy, signature)) return { status: 401, body: { error: 'bad signature' } };
    return null;
  }

  private async commit(next: Policy): Promise<GateResponse> {
    const replaced = this.current;
    try {
      await this.store.write({ current: next, previous: replaced });
    } catch (error) {
      this.storeError = error instanceof Error ? error.message : String(error);
      return { status: 503, body: { error: 'policy store unavailable; nothing was applied' } };
    }
    this.current = next;
    this.previous = replaced;
    this.source = 'store';
    this.storeError = null;
    this.lastAttempt = this.now();
    this.lastRefresh = new Date(this.now()).toISOString();
    return { status: 200, body: { applied: true, version: next.version, previousVersion: replaced.version } };
  }

  private async push(body: Record<string, unknown>, authorization?: string): Promise<GateResponse> {
    const refused = this.authenticate(body, authorization);
    if (refused) return refused;
    let next: Policy;
    try {
      if (typeof body.policy === 'object' && body.policy !== null && 'rollback' in body.policy) throw new PolicyError('a rollback request is not a policy');
      next = normalisePolicy(body.policy, this.assetId);
    } catch (error) {
      return { status: 400, body: { error: error instanceof PolicyError ? error.message : 'invalid policy' } };
    }
    await this.refresh();
    if (next.version <= this.current.version) {
      return { status: 409, body: { error: 'version is not greater than the current one', currentVersion: this.current.version } };
    }
    return this.commit(next);
  }

  /**
   * Body { policy: { rollback: true, assetId, version: <current policy version> }, ts, signature }, signed like a
   * push. Naming the current version makes the request single-use, and a captured push cannot be replayed here.
   */
  private async rollback(body: Record<string, unknown>, authorization?: string): Promise<GateResponse> {
    const refused = this.authenticate(body, authorization);
    if (refused) return refused;
    const request = (typeof body.policy === 'object' && body.policy !== null ? body.policy : {}) as Record<string, unknown>;
    if (request.rollback !== true || request.assetId !== this.assetId) {
      return { status: 400, body: { error: 'policy must be { rollback: true, assetId, version }' } };
    }
    await this.refresh();
    if (request.version !== this.current.version) {
      return { status: 409, body: { error: 'version is not the current one', currentVersion: this.current.version } };
    }
    if (!this.previous) return { status: 409, body: { error: 'no previous policy to restore' } };
    const restored: Policy = { ...this.previous, version: this.current.version + 1, issuedAt: new Date(this.now()).toISOString() };
    const result = await this.commit(restored);
    return result.status === 200 ? { status: 200, body: { ...result.body, rolledBack: true } } : result;
  }

  /** Answers the /_assurance/* routes; returns null for any other path so the asset can carry on routing. */
  async handle(request: GateRequest): Promise<GateResponse | null> {
    const path = (request.path.split('?')[0] ?? '').replace(/\/+$/, '');
    if (!path.startsWith('/_assurance/')) return null;
    const method = request.method.toUpperCase();
    const body = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as Record<string, unknown>;
    if (path === '/_assurance/status' && method === 'GET') return { status: 200, body: { ...(await this.status()) } };
    if (path === '/_assurance/policy' && method === 'POST') return this.push(body, request.authorization);
    if (path === '/_assurance/rollback' && method === 'POST') return this.rollback(body, request.authorization);
    return { status: 404, body: { error: 'not found' } };
  }
}

export function createGate(options: GateOptions): Gate {
  return new Gate(options);
}
