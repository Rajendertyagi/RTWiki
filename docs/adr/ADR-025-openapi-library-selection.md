# ADR-025: OpenAPI Library Selection for the External-AI Capability Surface

| Field | Value |
|-------|-------|
| **Status** | **Accepted** — Phase 0 library selection (`hono-openapi` 1.6.0) accepted by the owner. Acceptance covers the library choice only; it does **not** authorise Phase 2 integration, a `package.json`/`bun.lock` change, route annotation, or CI/build changes. |
| **Date** | 2026-11-26 |
| **Related** | [Plan — External AI Integration](../PLAN_EXTERNAL_AI_INTEGRATION.md) §5 (Phase 0), §7.1 (tool-manifest derivation), [ADR-002](ADR-002-bun-hono-sqlite.md), [ADR-003](ADR-003-react-blocknote-mantine.md), [AGENTS.md](../../AGENTS.md) §5, §6, §9 |

## Context

The external-AI plan derives the AI tool surface from OpenAPI operation tags rather than a
hand-maintained allowlist (plan §7.1). Phase 0 is a hard gate: before any dependency is added to
RTWiki or any route is annotated, the two candidate libraries must be measured against the actual
pinned stack and against RTWiki's real middleware/error-handling patterns. The plan's decision rule
is explicit: if `hono-openapi` passes all ten assertions, adopt it; if it fails and
`@hono/zod-openapi` passes, adopt the latter **only with explicit owner approval**; if neither
passes, stop and report.

This ADR records the measured result of that probe. Its **Status is Accepted** for the Phase 0
library selection only. Acceptance does **not** authorise a dependency change, a route migration,
or any production code change. Those belong to Phase 2 and, for the root app conversion, to a
separate owner decision.

## Probe setup (measured, not assumed)

The probe lived entirely outside the repository at
`D:\Coding\OpenCode\user\tmp\opencode\openapi-fit\`. It was a disposable Bun project with **exact
pinned versions**, verified by reading each installed `node_modules/<pkg>/package.json`:

| Package | Exact installed version |
|---------|-------------------------|
| `hono` | `4.13.19` |
| `zod` | `4.6.7` |
| `typescript` | `7.0.2` |
| `hono-openapi` | `1.6.0` |
| `@hono/zod-openapi` | `1.6.3` |
| `bun-types` (dev only, for strict typecheck) | `1.4.5` |
| Bun runtime | `1.4.5` (Windows x64) |

> **Pinned Hono target — updated 2026-11-27:** the owner authorised a Phase 1 dependency bump to
> `hono@4.13.23`. The table above records the **original Phase 0 probe**, measured on
> `hono@4.13.19`; that evidence is preserved verbatim and is **not** restated as 4.13.23 results.
> A separate agent re-runs all ten assertions with `hono@4.13.23` and the selected
> `hono-openapi@1.6.0`, and **appends** the new measured results in the section below. Until those
> results are appended, every `PASS`/`FAIL` in this ADR refers to 4.13.19 only. `hono-openapi` is
> **not** installed into the production project during Phase 1.

The probe app reproduced the patterns read from `src/server/app.ts`: a custom header middleware,
`secureHeaders()` with an explicit CSP, `app.route()` mounting of a child app, an `app.onError`
that maps **every** thrown error to `{error:'Internal server error'}` 500, and `app.notFound`
returning `{error:'Not found'}` 404. It also included a stand-in service object, a Zod-validated
parent route tagged `ai-safe`, a tagged child route, an unannotated route with manual validation,
a multipart `File` upload route, and a `GET /openapi.json` route serving a deterministically cached
spec. Every assertion was exercised with **real HTTP requests** against a running server, both
under Bun and against an actually compiled `bun build --compile` binary.

The probe did **not** reproduce the Host allowlist / `isSameOrigin` guards
(`src/server/app.ts:203-219`), the `/api/*` Cache-Control gap-fill (`:180-185`), the nonce-based CSP
(`:65-88`), or the per-route body/media-type limits. Those controls are outside the ten plan
assertions; their coexistence with OpenAPI middleware remains to be verified in Phase 2 and is not
claimed here.

## Decision

**Select `hono-openapi` (pinned `1.6.0`)** for the incremental OpenAPI adoption described in the
plan. It passed all ten assertions under Bun and under the compiled binary. Per the plan's decision
rule, no owner approval was required for the library choice itself, and the owner has now accepted
the Phase 0 gate. Acceptance is of the library selection only — it does **not** authorise a
dependency change, route migration, or production code change; those are Phase 2 work.

Adoption is conditional on three measured integration requirements, all of which are probe code
today and must be carried into the real implementation as shared, single-sourced helpers:

1. **A shared validation hook** that rewrites the library's raw 400 body into RTWiki's
   `{error: string}` shape. `hono-openapi`'s `validator()` returns 400 directly; it does not throw,
   so RTWiki's `onError` never sees it — but the raw body is `{data, error:[issues], success:false}`,
   which is not RTWiki's shape.
2. **A shared JSON media-type gate** returning 415 with the `{error}` shape. `hono-openapi` has no
   built-in media-type rejection: with no gate, a `text/plain` body is parsed as JSON and fails
   schema validation with 400 (measured, see evidence). The gate mirrors RTWiki's existing
   `readJson`/import-route behaviour and must be defined once, not repeated per route.
3. **A compile flag**: `bun build --compile --external zod-to-json-schema ...`. A plain compile
   fails because `@standard-community/standard-json` contains a guarded optional dynamic import of
   `zod-to-json-schema` that Bun's bundler tries to resolve statically (measured, see evidence).

`@hono/zod-openapi` also passed all ten assertions, but only with two adapters of its own (a
`defaultHook` for validation errors and an `onError` branch that preserves `HTTPException` status).
Adopting it would require converting the root app from `Hono` to `OpenAPIHono` and the route modules
to `openapi()` — the owner-approval path in the plan's decision rule. (The module count is a
plan/architecture claim, not measured by this probe.) It is **not** adopted by this ADR.

## Measured results — all ten assertions

`PASS`/`FAIL` below are the actual results recorded in `evidence/results.json`. Full bodies,
headers and spec fragments are in `evidence/http-responses.json` and `evidence/specs.json`.

| # | Assertion | `hono-openapi` Bun | `hono-openapi` binary | `@hono/zod-openapi` Bun | `@hono/zod-openapi` binary |
|---|-----------|--------------------|-----------------------|------------------------|----------------------------|
| 1 | Custom header survives + `secureHeaders` output | **PASS** — `X-RTWiki-Probe: present`, `X-Content-Type-Options: nosniff`, CSP present | **PASS** — identical | **PASS** — identical | **PASS** — identical |
| 2 | Existing service object called unchanged | **PASS** — `200`, `{"ok":true,"service":{"token":"rtwiki-service-called-v1","title":"Probe page"}}` | **PASS** | **PASS** | **PASS** |
| 3 | Invalid input → `{error}` 400, not 500 | **PASS** — `400`, `{"error":"Invalid input: expected string, received number"}` | **PASS** | **PASS** — `400`, same `{error}` shape | **PASS** |
| 4 | Multipart `File` upload validates and reaches handler | **PASS** — `200`, `{"ok":true,"fileName":"probe.txt","size":11}` | **PASS** | **PASS** | **PASS** |
| 5 | Wrong media type rejected | **PASS** — `415`, `{"error":"This endpoint accepts application/json."}` (explicit gate) | **PASS** | **PASS** — `415`, `{"error":"Unsupported Media Type"}` (adapter preserves `HTTPException`) | **PASS** |
| 6 | One spec contains parent + `app.route()` child | **PASS** — paths `/api/ai/pages`, `/api/ai/child/notes`, `/api/ai/upload` | **PASS** | **PASS** — same three paths | **PASS** |
| 7 | Tags survive + deterministic cached read | **PASS** — both `tags:["ai-safe"]`, two reads identical (1469 bytes each) | **PASS** — identical | **PASS** — both `tags:["ai-safe"]`, two reads identical (1077 bytes each) | **PASS** |
| 8 | `tsc --noEmit` with TypeScript 7.0.2 | **PASS** — exit 0, no diagnostics | **PASS** | **PASS** — exit 0, no diagnostics | **PASS** |
| 9 | Compiled binary passes the same assertions | **PASS** — all core assertions pass in the binary | **PASS** | **PASS** | **PASS** |
| 10 | Unannotated routes unchanged | **PASS** — invalid `400` and valid `200` status and body identical to a plain Hono app with no OpenAPI middleware (headers not compared) | **PASS** | **PASS** — status/body identical | **PASS** |

Assertion 8 is the host `tsc --noEmit` result, not a separate typecheck inside the binary. Assertion
9 is derived from the compiled binary's results for assertions 1–7 and 10. The BIN rows therefore
reuse those two host-side results; the meaningful compiled-binary proof is the BUN #9
`compiledCoreResults` entry in `evidence/results.json`.

### The hard gate: tag introspection (assertion 7)

Tag introspection **works for both candidates**. No registration-time registry fallback was
needed, so none was implemented. The exact spec fragment from `hono-openapi` under Bun
(`evidence/spec-hono-openapi-bun.json`):

```json
"/api/ai/pages": {
  "post": {
    "operationId": "postApiAiPages",
    "tags": ["ai-safe"],
    "summary": "Create a page (AI-safe parent route)",
    "requestBody": { "required": true, "content": { "application/json": { "schema": { ... } } } }
  }
}
```

and the `app.route()`-mounted child in the same document:

```json
"/api/ai/child/notes": { "post": { "tags": ["ai-safe"], "summary": "Create a note (AI-safe child route)" } }
```

`@hono/zod-openapi` produced the equivalent tags in `evidence/spec--hono-zod-openapi-bun.json`
(`"tags":["ai-safe"]` on both operations). Two consecutive `GET /openapi.json` calls returned
byte-identical bodies for each candidate, confirming the cached read is deterministic. This is the
measured evidence that makes plan §7.1's derived tool manifest viable: **the capability surface can
be derived from tags; no hardcoded list and no registry fallback are required.**

### Raw behaviour that the adapters correct (measured with `adapter:false`)

These are the risk measurements the plan explicitly required, not assumptions about library
internals:

| Candidate | Invalid input, no adapter | Wrong media type, no adapter |
|-----------|---------------------------|------------------------------|
| `hono-openapi` | **400 directly** (not thrown, so no 500): `{"data":{"title":123},"error":[{"expected":"string","code":"invalid_type","path":["title"],"message":"Invalid input: expected string, received number"}],"success":false}`. Wrong shape → needs a hook. | With the probe's explicit gate: **415** `{"error":"This endpoint accepts application/json."}`. With the gate removed (control route): **400** `{"data":{},"error":[{"expected":"string","code":"invalid_type","path":["title"],"message":"Invalid input: expected string, received undefined"}],"success":false}` — the library has **no** media-type rejection of its own. |
| `@hono/zod-openapi` | **400 directly** (not thrown): `{"success":false,"error":{"name":"ZodError","message":"..."}}`. Wrong shape → needs `defaultHook`. | **500** `{"error":"Internal server error"}` — the library **throws** `HTTPException(415)`, which RTWiki's `onError` flattens to 500. Needs an `onError` branch preserving the original status. |

The `onError` fallback at `src/server/app.ts:329-332` is therefore a real hazard for
`@hono/zod-openapi` and a non-issue for `hono-openapi`'s validation path. This is the principal
technical reason the decision rule's preferred candidate is safe to adopt.

### Compiled-binary caveat (measured)

| Candidate | Plain `bun build --compile` | With `--external zod-to-json-schema` |
|-----------|-----------------------------|--------------------------------------|
| `hono-openapi` | **FAIL** (exit 1): `error: Could not resolve: "zod-to-json-schema"` from `@standard-community/standard-json/dist/zod-1aXHhzFQ.js:25` | **PASS** (exit 0), binary served all assertions |
| `@hono/zod-openapi` | **PASS** (exit 0) | **PASS** (exit 0) |

The failing import is guarded by `try/catch` at runtime, so the externalised module is never needed
with Zod 4; the compiled binary passed every assertion. The alternative mitigation — installing
`zod-to-json-schema` as a pinned dependency — was **not measured** and is not claimed here.

## Consequences

**Positive**

- The root app can stay a plain `Hono` instance; no conversion to `OpenAPIHono` is required.
- Existing Zod schemas in `src/shared/schemas/` are reused directly through `resolver()`; no
  parallel schema definitions are needed.
- `app.route()` mounting is preserved, and a child route's `ai-safe` tag reaches the same combined
  document as its parent — the basis for a single derived tool manifest in Phase 2.
- Unannotated routes are unaffected: their responses were byte-identical to a plain Hono app.
- The compiled Windows executable remains viable with one documented build flag.

**Negative / accepted costs**

- Two shared helpers are new integration surface: a validation-error hook and a JSON media-type
  gate. Per AGENTS.md §5 they must be defined once and reused; duplicating them per route would be a
  defect.
- The compile command needs `--external zod-to-json-schema`. This must be carried into the CI build
  script when OpenAPI adoption lands, or the Windows artifact will not build.
- `generateSpecs()` is asynchronous and must run after all routes are mounted. The spec must be
  generated once and cached; regenerating per request would break the deterministic-read property
  that Phase 2's manifest depends on.
- A multipart `File` schema needed explicit `.openapi({type:'string',format:'binary'})` metadata for
  `@hono/zod-openapi`'s generator. The probe used that metadata for both candidates; a future
  implementation should keep it so either library remains viable.

## Alternatives Considered

- **`@hono/zod-openapi`** — passed all ten assertions, but requires `OpenAPIHono` as the root app,
  `openapi()` on all ten route modules, a `defaultHook`, and an `onError` branch to stop
  `HTTPException(415)` becoming a 500. Under the plan's decision rule this path needs explicit
  owner approval. Not adopted here.
- **Registration-time registry fallback** (plan §5/§7.1) — not implemented because assertion 7
  passed for both candidates. It remains the documented fallback if a future version breaks tag
  introspection; it is not needed now.
- **A hardcoded AI tool list** — rejected by plan §7.1 and AGENTS.md §5; tag introspection makes it
  unnecessary.
- **Installing `zod-to-json-schema` to avoid the compile flag** — not measured; recorded only as an
  untested option, not a decision.

## Risks

- The probe used a stand-in service and simplified schemas. Real route modules carry more complex
  Zod shapes (BlockNote JSON, discriminated unions); `resolver()` must be exercised against those in
  Phase 2, not assumed to work from this probe.
- The `--external` compile flag is verified only on Bun 1.4.5 / Windows x64. A Bun upgrade could
  change dynamic-import bundling; the compiled-E2E gate must keep covering it.
- Tag introspection is verified for `describeRoute` tags on a parent and one `app.route()` child.
  Ten real route modules and deeper nesting are not covered by this probe.
- This ADR is **Accepted** for the Phase 0 library selection only. It records a measured library
  choice and owner acceptance of that choice; it does **not** authorise changes to `package.json`,
  `bun.lock`, routes, or CI, which remain Phase 2 work.

## Revisit Conditions

- The owner rejects the Phase 0 gate or requires the `@hono/zod-openapi` path instead; that would
  need a new ADR recording the owner's approval of the root-app conversion.
- A pinned-version bump of `hono`, `hono-openapi`, or Bun changes any of the ten measured results —
  in particular tag introspection, the 400 error shape, or the compiled-binary build. The authorised
  bump to `hono@4.13.23` is being handled by the appended re-test below; if any result changes, this
  ADR must be revisited before Phase 2.
- `generateSpecs()` stops including `app.route()`-mounted child routes, or tags stop surviving into
  the document; then the registration-time registry fallback in plan §7.1 must be implemented and
  measured before Phase 2 proceeds.
- A real route schema proves incompatible with `resolver()` or with the shared validation hook.

## Re-test on `hono@4.13.23` (Phase 1 — appended by a separate agent)

Owner-authorised 2026-11-27. The Phase 0 evidence above was measured on `hono@4.13.19` and is
preserved unchanged under `evidence/hono-4.13.19/`. All ten assertions from plan §5 were re-run with
`hono@4.13.23` and the selected `hono-openapi@1.6.0`, under Bun and the compiled binary. The new
`evidence/results.json` carries `honoVersion: "4.13.23"` and `generatedAt
2026-11-27T02:46:07.331Z`.

| # | Assertion | Bun (4.13.23) | Binary (4.13.23) |
|---|-----------|---------------|------------------|
| 1 | Custom header + secureHeaders | PASS | PASS |
| 2 | Existing service object called unchanged | PASS | PASS |
| 3 | Invalid input → `{error}` 400, not 500 | PASS | PASS |
| 4 | Multipart `File` upload | PASS | PASS |
| 5 | Wrong media type rejected (415) | PASS | PASS |
| 6 | One spec contains parent + `app.route()` child | PASS | PASS |
| 7 | Tags survive + deterministic cached read | PASS | PASS |
| 8 | `tsc --noEmit` (TS 7.0.2) | PASS | PASS |
| 9 | Compiled binary passes the same assertions | PASS | PASS |
| 10 | Unannotated routes unchanged | PASS | PASS |

All ten still pass on both runtimes. Assertion 7 again measured `tagsSurvive:true`,
`deterministic:true`, `identicalBytes:true` with 1469/1469-byte spec reads. The non-selected
`@hono/zod-openapi` candidate also measured 10/10 on both runtimes. The compiled
external-dependency packaging question remains a Phase 2 gate; `hono-openapi` is not installed into
the production project during Phase 1.

## Evidence files

All paths are under `D:\Coding\OpenCode\user\tmp\opencode\openapi-fit\evidence\`:

- `results.json` — machine-readable per-assertion pass/fail for both candidates under Bun and the
  compiled binary, plus raw measurements and command records.
- `http-responses.json` — every captured HTTP response (status, headers, body) used by the assertions.
- `specs.json`, `spec-hono-openapi-bun.json`, `spec-hono-openapi-compiled.json`,
  `spec--hono-zod-openapi-bun.json`, `spec--hono-zod-openapi-compiled.json` — generated OpenAPI
  documents from each candidate and runtime.
- `summary.txt` — console summary of all ten assertions × both candidates × both runtimes.
- `commands.txt` — exact commands, exit codes, stdout and stderr.
- `typecheck.txt` — `tsc --noEmit` output with TypeScript 7.0.2.
- `compile-hono-openapi.txt`, `compile--hono-zod-openapi.txt` — plain and `--external` compile
  attempts with full output.
- `bin-hono-openapi.exe`, `bin-zod-openapi.exe` — the actually compiled binaries that were run.

The probe source itself is under `D:\Coding\OpenCode\user\tmp\opencode\openapi-fit\src\` and the
exact dependency set is pinned in that directory's `package.json` and `bun.lock`.
