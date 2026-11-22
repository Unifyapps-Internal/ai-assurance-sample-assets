export interface MaskPattern {
  name: string;
  regex: string;
  replace: string;
}

export interface DeniedTopic {
  name: string;
  phrases: string[];
}

export interface Retention {
  conversationsDays: number | null;
  logsDays: number | null;
}

/** The policy document the hub pushes. Every section is always present after normalisation. */
export interface Policy {
  version: number;
  issuedAt: string;
  assetId: string;
  masking: { enabled: boolean; patterns: MaskPattern[]; unmaskedRoles: string[] };
  input: { refuseInjection: boolean; deniedTopics: DeniedTopic[]; refusal: string };
  aiLabel: { enabled: boolean; text: string };
  roles: { enforce: boolean; map: Record<string, string[]> };
  retention: Retention;
  logging: { maskPersonalData: boolean };
  telemetry: { enabled: boolean };
}

export interface StoredPolicies {
  current: Policy;
  previous: Policy | null;
}

export interface PolicyStore {
  readonly kind: string;
  read(): Promise<StoredPolicies | null>;
  write(state: StoredPolicies): Promise<void>;
}

export interface Decision {
  allowed: boolean;
  reason: string | null;
}

export interface GateStatus {
  assetId: string;
  gateVersion: string;
  policyVersion: number;
  issuedAt: string;
  /** The policy in force, whole. A policy is configuration and holds no secret. */
  policy: Policy;
  storeKind: string;
  lastRefresh: string | null;
  policySource: 'default' | 'store' | 'memory';
  storeError: string | null;
  acceptsPushes: boolean;
}

export interface GateRequest {
  method: string;
  path: string;
  body?: unknown;
  /** The request's Authorization header: "Bearer <secret>" authenticates a push in place of the body signature. */
  authorization?: string;
}

export interface GateResponse {
  status: number;
  body: Record<string, unknown>;
}
