> **Public copy for testing an AI assurance hub.** The eight sample assets the hub assesses from outside. Every
> person, company, ID, IBAN and phone number here is fabricated. The answer key, the planted-data list and the
> sign-in fixtures are left out of this copy; the hub keeps its own key.

# Assurance fleet: eight external test assets and the Assurance Gate

**Test asset.** Everything here is fabricated: the SMEs, the people, the national ids, the IBANs, the phone
numbers. No real person or company appears. The fleet exists so an AI governance hub has real, running external
workloads to assess from outside (HTTP, a headless browser, a repository scan), to fix live through a signed
policy push, and to fix by repository change.

Each asset has a designed compliance posture. The faults are planted on purpose, they are real (each one can be
observed or exploited), and they are listed in `answer-key.json`. The hub uses that file only to score its own
detection.

## Layout

```
package.json              npm workspaces (node >= 20), vitest
pyproject.toml            pytest and ruff settings for the Python side
answer-key.json           planted conditions per asset and in the data (written by scripts/answer-key.mjs)
packages/
  gate-node/              Assurance Gate for Node (TypeScript)
  gate-py/                Assurance Gate for Python, same contract
  gate-vectors.json       test vectors both gates assert against (written by scripts/gate-vectors.mjs)
  shared-data/            the fabricated dataset: generate.mjs (seeded) and its committed output in data/
assets/
  e1-collections-assistant/      agent, Python, LangChain + Gemini, gate (strict), traced
  e2-onboarding-helper/          agent, Node, Gemini, gate (empty default policy), traced
  e3-sector-research/            agent, Node, Gemini, no gate, no manifest, no traces
  e4-application-scoring/        workflow service, Python
  e5-statement-reconciliation/   workflow job, Node, no model
  e6-sme-onboarding-portal/      web application, no gate
  e7-guarantee-tracker/          web application, gate (strict)
  e8-rm-workspace/               web application, gate
scripts/
  smoke.mjs  vendor.mjs  answer-key.mjs  gate-vectors.mjs  pytest.mjs  fleet.test.ts
```

## The eight assets

| Asset | Port | Posture | What it does | Planted |
|---|---|---|---|---|
| E1 Collections Assistant | 4101 | Compliant | Answers questions about an SME, a loan's repayments and guarantees. Masking, injection refusal, AI label, retention, traces. | none |
| E2 Onboarding Helper | 4102 | Not compliant | Answers questions about an SME's onboarding record, applications and guarantees. | injection succeeds; QID and IBAN in answers; manifest omits model and sub-processors; no retention; no AI label |
| E3 Sector Research | 4103 | Not demonstrated | Answers sector questions from aggregates. | no manifest, no gate, no telemetry, no documents |
| E4 Application Scoring | 4104 | Not compliant | Validates, scores and explains loan applications; daily schedule. | personal data in logs; no retention; invalid sector codes accepted; undeclared FX host |
| E5 Statement Reconciliation | 4105 | Compliant | Matches statement lines to repayments deterministically; daily schedule; no model. | none |
| E6 SME Onboarding Portal | 4106 | Not compliant | SME list, record, reports, admin, AI summary. | no security headers; admin open to every role; no AI label; QID in clear; English-only search; undeclared script host |
| E7 Guarantee Tracker | 4107 | Compliant | Guarantee list, record, reports, admin, AI summary. | none |
| E8 RM Workspace | 4108 | With conditions | SMEs with their loans, reports, admin, AI summary. | analyst sees QID and IBAN unmasked; undeclared font host |

Two facts are true of the fleet and not planted: hosting is outside Qatar, and the model runs on the provider's
free tier.

## Run

```
npm install                         # once, at the root
py -3 -m venv .venv                 # once (python3 elsewhere); then:
.venv/Scripts/python -m pip install -r requirements-dev.txt

npm test                            # every Node package and asset, plus the repository checks
npm run test:py                     # pytest (gate-py, E1, E4), ruff check, ruff format --check
npm run typecheck                   # TypeScript strict, every Node workspace
npm run smoke                       # starts all eight with the stub model and prints a table
```

One asset on its own, from its folder:

| Asset | Command |
|---|---|
| E1, E4 | `../../.venv/Scripts/python -m collections_assistant` / `-m application_scoring` |
| E2, E3, E5 | `npm run dev` (`tsx src/server.ts`) |
| E6, E7, E8 | `npm run dev` (`vite build && tsx server/server.ts`: the built client and the API on one port) |

`PORT` overrides the port. The local servers apply the `headers` rules of the asset's `vercel.json`, so a local
probe sees the headers the deployment would send (and, for E6, their absence).

### Model

- `GEMINI_API_KEY` and `GEMINI_MODEL` (default `gemini-2.5-flash`). Node assets use `@google/genai`, Python assets
  `langchain-google-genai`.
- Without a key: the agents and the AI summary answer 503 `{"error":"model key not configured"}`; E4 skips its
  rationale step and the run still completes.
- `FLEET_MODEL=stub` selects a built-in deterministic stub model. It is for local smoke runs; tests inject the
  stub by dependency and never touch the network. Do not set it in a deployment.

### Sign-in (web applications)

Three fixture users per application, one per role. Usernames: `officer.test`, `manager.test`, `admin.test` (E6,
E7); `rm.test`, `analyst.test`, `admin.test` (E8). The test passwords are in each `fixtures/users.json` (test-only
credentials, there for the hub's probe connection); the server reads only scrypt hashes from `data/users.json`.
`npm run users` rebuilds the hashes from the fixtures. The session cookie is `HttpOnly; Secure; SameSite=Lax`,
signed with `SESSION_SECRET` (random per process when absent, so set it in a deployment).

## Contracts

- Manifest: `assurance.json` at the asset root, served at `GET /assurance.json` (E3 has none: 404).
- Every asset: `GET /api/health` → `{ ok, asset, version, gate: { installed, policyVersion } }`.
- Agents (E1, E2, E3): `POST /api/chat { message, sessionId?, userId?, role? }` →
  `{ answer, sessionId, model, toolCalls: [{ name, input, output }], blocked?: { by, reason }, notice }`.
  502 `{ error }` when the model fails or does not answer in time.
- Workflows (E4, E5): `POST /api/run { trigger: "manual" | "schedule", input? }`, `GET /api/runs`,
  `GET /api/runs/:id`, `GET /api/definition`, `GET /api/logs?runId=`. The daily cron of `vercel.json` arrives as
  `GET /api/run` (Vercel crons send GET); when `CRON_SECRET` is set it must carry `Authorization: Bearer <it>`.
- Web applications (E6, E7, E8): `POST /api/login`, `POST /api/logout`, `GET /api/me`, `GET /api/records?q=&page=`
  (`{ items, total, page, pages }`), `GET /api/records/:id`, `GET /api/reports`, `GET /api/admin/users`,
  `POST /api/ai/summary { id }` → `{ id, summary, label, model, notice }`.
- Every payload that shows data carries `"notice": "Test asset. All data is fabricated."`; every screen shows a
  "Test asset" badge.

## The Assurance Gate

One contract, two implementations (`packages/gate-node`, `packages/gate-py`), proven identical against
`packages/gate-vectors.json`. Installed in E1 (Python), E2, E7, E8 (Node).

```
createGate({ assetId, store, secret, collectorEndpoint?, defaultPolicy })        create_gate(asset_id, store, secret, default_policy, ...)
await gate.policy()         current policy; re-reads the store at most every 5 s; call once per request
gate.maskText(text, { role })   gate.maskDeep(value, { role })   gate.checkInput(text) → { allowed, reason }
gate.refusal()   gate.label()   gate.authorize(path, role) → { allowed, reason }   gate.log(line)   gate.retention()
gate.trace.turn / .model / .tool     OpenInference-shaped OTLP spans when a collector endpoint is set
gate.handle({ method, path, body })  answers /_assurance/*, returns null for any other path
```

HTTP, mounted by the asset:

- `POST /_assurance/policy` body `{ policy, ts, signature }`,
  `signature = hex(HMAC_SHA256(secret, ts + "." + JSON.stringify(policy)))`.
  401 bad signature; 401 `ts` more than five minutes from now (epoch milliseconds, epoch seconds or an ISO string,
  signed exactly as sent); 409 `version` not greater than the current one; 400 invalid policy, another asset's
  `assetId`, or a masking regex that does not compile; 503 when `ASSURANCE_GATE_SECRET` is absent or the store
  cannot be written. Answers `{ applied: true, version, previousVersion }`.
- `GET /_assurance/status` → `{ assetId, gateVersion, policyVersion, issuedAt, policy, storeKind, lastRefresh,
  policySource, storeError, acceptsPushes }`. `policy` is the policy in force, whole (the default before any push,
  the restored one after a rollback, the one kept in memory when the store cannot be read), so the hub can compose
  the next version from it. A policy is configuration; the answer holds no secret and nothing derived from one.
- `POST /_assurance/rollback` body `{ policy: { rollback: true, assetId, version: <current policy version> }, ts,
  signature }`, signed the same way. Restores the previous policy as version current + 1 and answers
  `{ applied: true, version, previousVersion, rolledBack: true }`. Naming the current version makes the request
  single-use, and a captured policy push cannot be replayed as a rollback.

Rules worth knowing when writing a policy:

- A section absent from a pushed policy is off. The gate never invents a stricter or looser value.
- `masking.patterns[].replace` is literal text (no `$1`). Patterns are compiled with the global flag; in Python
  with `re.ASCII`, so `\b` and `\d` mean what they mean in JavaScript.
- `masking.unmaskedRoles` is honoured for the role the asset passes. In the web applications that is the role of
  the signed-in session. In the agents it is the `role` field of the chat body, which is a claim, not a proof: E1's
  default policy therefore lists no unmasked role.
- `roles.map` is matched by path prefix, longest first; a path under no prefix is allowed.
- `logging.maskPersonalData` masks `gate.log` lines and trace attributes, with the policy's patterns or, when it
  has none, built-in ones for QID, IBAN, phone and email.
- Stores: `MemoryStore` (tests), `FileStore` (`.gate/policy.json`, local), `BlobStore` (Vercel Blob, chosen when
  `BLOB_READ_WRITE_TOKEN` exists; `ASSURANCE_BLOB_ACCESS` is `private` by default or `public`, to match the store).
- Fail-safe: a store that cannot be read, comes back empty, or holds an older version never replaces the policy in
  memory; `/status` reports `policySource: "memory"` and the `storeError`. Before any push the gate runs on the
  asset's `gate.default.json`: strict in E1 and E7, everything off (traces on) in E2, masking on with `analyst`
  wrongly unmasked in E8.

## Observability

When `UNIFYAPPS_COLLECTOR_ENDPOINT` is set (`UNIFYAPPS_API_KEY` optional, sent as the `authorization` header),
traces go there by OTLP/HTTP: one root span per turn, a child span per model call (model name, token counts) and
per tool call (name, input, output), `session.id` and `user.id` on each.

- E1 uses `unifyapps-otel` 0.1.0 (it installs from PyPI) with `openinference-instrumentation-langchain`:
  `register(auto_instrument=True)` once, before any chain is built; `using_session` and `using_user` per turn. No
  fallback to the plain OpenTelemetry SDK was needed.
- E2, E7 and E8 use the standard OpenTelemetry JS SDK through `gate.trace`.
- E3 sends nothing.

## Shared data

`node packages/shared-data/generate.mjs` (seed 20261113, as-of date 2026-06-30) writes `data/`: 400 SMEs, 900
loan applications, 600 guarantees, 5,000 repayments, 300 statement lines, 500 contacts, and the reference lists
`sectors.json`, `regions.json`, `currencies.json`. The output is deterministic and committed.

Planted in the data, with record ids in `data/planted.json` and `answer-key.json`: 15 duplicate SME pairs (exact,
Arabic-English variant, transliteration, Arabic orthography, legal suffix); 25 quality defects over completeness,
validity, consistency and timeliness; 12 invalid sector or region codes; 20 personal-data fields, four of them
with misleading names (`ref2` and `legacy_key` hold a QID, `notes` and `aux_code` a phone); 10 decoy fields that
look sensitive and are not. No two people share a full name (a duplicate SME record repeats its own owner).

## Deploying to Vercel

Nothing has been deployed. Each asset folder is meant to be its own Vercel project with **Root Directory**
`assets/<asset>`.

- **Vendoring.** A per-folder deployment cannot rely on the workspace, so the gate and the data each asset reads
  are copied into `assets/<asset>/vendor/` and committed: the built gate (`vendor/gate/*.js` and `.d.ts`) for E2,
  E7, E8, the Python package (`vendor/assurance_gate/`) for E1, and the shared-data JSON files it uses for every
  asset. After changing a gate or the data run `npm run vendor`; `npm test` fails when a vendored copy drifts.
- **Node assets** have `api/index.ts` and a `vercel.json` that rewrites the asset's routes to it and lists the
  files the function reads (`includeFiles`). The web applications also build the client with `vite build` into
  `dist`.
- **Python assets** have `api/index.py` exposing the FastAPI `app`, `requirements.txt` (pinned) and a catch-all
  rewrite.
- **Environment per project:** `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) for all but E5;
  `ASSURANCE_GATE_SECRET` and `BLOB_READ_WRITE_TOKEN` for E1, E2, E7, E8 (the function file system is read-only,
  so without a Blob store a policy push answers 503 and the gate stays on its default policy);
  `SESSION_SECRET` for E6, E7, E8; `CRON_SECRET` for E4, E5; `UNIFYAPPS_COLLECTOR_ENDPOINT` (and
  `UNIFYAPPS_API_KEY`) for E1, E2, E7, E8. Each asset's `.env.example` names every variable it reads.

Not verified, because nothing was deployed and no key was available: the Vercel builds and rewrites, the Python
runtime and its bundle size, the cron invocation, the Blob store (the Node client uses `@vercel/blob`, the Python
client the Blob REST interface; both are tested only through an injected client), a real Gemini call, and export
to a real collector.

## Notes

- No secrets are committed. `.env`, `.vercel`, `dist`, `.gate` and `node_modules` are ignored.
- The planted faults carry no hint of their fix in code or comments; `answer-key.json` gives each one's location.
- E4's FX step really calls `open.er-api.com` (that is its planted undeclared host). It sends no data, times out
  after three seconds and falls back to the fixed peg, so a run never depends on it.
- E6 and E8 pages load a file from a public CDN and a public font host (their planted undeclared hosts).
