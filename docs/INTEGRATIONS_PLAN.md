# Open-Source Integrations Plan

Status: planning only — no code changes in this pass. Written after reading the actual
call paths this plan touches (files cited throughout); nothing here is guessed from the
tool's README alone.

Scope: five candidate integrations plus one deliberately deferred seam. Ordered by value
per the stated priority (LiteLLM first — it unlocks the top requirement), not by list order.

---

## 1. LiteLLM — provider-agnostic LLM layer

**What it is:** a Python SDK + optional proxy server that normalizes ~100 LLM providers
(Anthropic, OpenAI, Gemini, Ollama, Bedrock, Azure, etc.) behind one OpenAI-style
`completion()`/`acompletion()` call, selected by a model-name string or a routing config
file. Self-hostable (it's a pip package plus an optional Docker proxy image; nothing
calls home).

**Why it fits:** the product's stated requirement is "provider-agnostic, possibly Gemini,
run in-house." Today the entire LLM surface is a single hand-rolled `httpx` call to
Anthropic's raw Messages API, hardcoded — swapping providers today means rewriting the
request/response shape by hand in one file. LiteLLM absorbs exactly that shape-translation
work.

**Current state (read in full):**
- `btx_platform/llm.py` — one function, `call_anthropic(payload, settings)` (line 22).
  No Anthropic SDK is used despite `anthropic>=0.50` being declared in `pyproject.toml`
  line 15 (dead dependency — zero `import anthropic` anywhere). It's a raw
  `httpx.AsyncClient` POST to `settings.anthropic_base_url`, with Anthropic-specific
  headers (`x-api-key`, `anthropic-version`) and Anthropic's `content: [{type, text}]`
  response envelope parsed by hand (lines 27–68).
- `btx_platform/api.py`'s `/llm` route (lines ~460–480) — validates `LlmProxyRequest`,
  calls `call_anthropic`, returns `{"text": ...}`. Fully protected: not in `PUBLIC_PATHS`
  (`api.py:57`), goes through Clerk auth + `MUTATING_ROUTE_MIN_ROLE="analyst"` + the
  shared per-user `RateLimiter` like every other mutating route (`api.py:59-60`,
  `config.py:60-61`). No special-casing needed for LiteLLM to preserve.
- `btx_platform/config.py` — `anthropic_api_key`, `anthropic_base_url`,
  `anthropic_version`, `llm_timeout_seconds` (45s), `llm_max_body_bytes` (512 KiB).
- Every downstream caller talks to the backend, never to a provider SDK directly:
  `frontend/src/brain/llmRouter.ts` (intent/routing classification), `frontend/src/agents/llmCompose.ts`
  (deliverable prose composition + critique pass), `frontend/src/brain/jarvis.ts` (Chatpil
  chat), `frontend/src/ui/deliverables/DocumentViewer.tsx` (section rewrite). All of them
  send `{model, system, messages}` and expect `{text}` back — **this contract does not
  need to change** for any frontend file if the swap happens entirely inside `llm.py`.

**Exact integration point:** replace the body of `call_anthropic` (or add a new
`call_llm(payload, settings)` that supersedes it) with `litellm.acompletion(model=...,
messages=[{"role":"system",...}, *payload.messages], api_key=..., ...)`, keep the same
function signature and same `LlmProviderError` exception shape so `api.py`'s route logic
is untouched. Model selection becomes a config-driven string (`"claude-haiku-4-5-20251001"`,
`"gemini/gemini-2.0-flash"`, `"ollama/llama3.1"`) instead of a hardcoded Anthropic model id
— `btx_platform/config.py` gains a `default_llm_model: str` setting and per-provider key
settings (`gemini_api_key`, etc.) alongside the existing `anthropic_api_key`.

**New dependencies:** `litellm` (pip). It depends on `httpx` (already a dependency,
`pyproject.toml:33`) and `pydantic` (already required) — low transitive footprint. Also:
finally either remove the unused `anthropic>=0.50` pin or actually adopt LiteLLM's
Anthropic passthrough so it does something.

**Effort: S.** One file's internals change (`llm.py`), one settings addition
(`config.py`), zero frontend changes, one backend test updated (see below).

**Risks:**
- `tests/test_platform_tier1.py::test_llm_route_matches_proxy_contract` mocks
  `btx_platform.llm.httpx.AsyncClient` directly and asserts on Anthropic's exact wire
  shape (`anthropic_base_url`, `x-api-key` header, `content:[{type,text}]` response).
  This test must be rewritten to mock `litellm.acompletion` and assert against LiteLLM's
  OpenAI-style `choices[0].message.content` shape instead — a real, known-size test
  change, not a hidden risk.
- LiteLLM's error taxonomy differs from raw `httpx` exceptions; `LlmProviderError`'s
  catch clauses in `llm.py` need re-mapping (LiteLLM raises typed exceptions per failure
  class — auth, rate limit, timeout — which is actually an improvement over today's
  generic `httpx.HTTPError` catch-all).
- LiteLLM is a moderately large dependency surface (many optional provider SDKs); pin it
  and vendor only what's needed — it lazy-imports provider SDKs so this is mostly a
  non-issue, but worth a smoke test that `pip install litellm` doesn't balloon the
  container image unexpectedly.

**Self-hosting / on-prem:** Yes, fully. LiteLLM itself is a Python library with no
network dependency of its own — it just routes to whichever provider endpoint you
configure, including a fully local one (Ollama, vLLM, or an on-prem OpenAI-compatible
endpoint). This is what makes the Ollama item (below) possible at all.

**Interaction with existing code:** additive at the seam, not a rewrite — `call_anthropic`
is used from exactly one call site (`api.py`'s `/llm` route). No other file imports
`btx_platform.llm` (confirmed by grep). This is about as clean a swap point as a codebase
offers.

---

## 2. Ollama — local model runtime (on-prem / controlled-data case)

**What it is:** a local inference server (llama.cpp under the hood) that runs open-weight
models (Llama, Mistral, Qwen, etc.) on a single machine/container, exposing an
OpenAI-compatible HTTP API.

**Why it fits:** the "on-prem / controlled-data" requirement — some BTX data (ITAR-adjacent
defense signals, real customer names) may need to never leave a customer's network. LiteLLM
already lists Ollama as a first-class provider string (`ollama/<model>`), so this is not a
second integration effort — it's a config value once item 1 lands.

**Exact integration point:** none beyond LiteLLM. Once `llm.py` calls
`litellm.acompletion(model=settings.default_llm_model, ...)`, pointing at Ollama is
`BTX_DEFAULT_LLM_MODEL=ollama/llama3.1` plus `BTX_OLLAMA_BASE_URL=http://ollama:11434`
(LiteLLM reads `OLLAMA_BASE_URL` or an explicit `api_base` kwarg). No new backend code path.

**New dependencies:** none beyond LiteLLM. Ollama itself is a separate deployed service
(a container next to `btx_platform`, e.g. `ollama/ollama` official image), not a Python
package.

**Effort: S** (given item 1 is done) — otherwise not meaningfully attemptable standalone.

**Hardware implication (real, worth flagging explicitly):** Ollama needs either a GPU
(strongly recommended — CPU inference on a 7–8B model is usable but slow, multi-second
per response, which will feel bad in Chatpil's synchronous request/response UX) or
acceptance of materially slower responses. This is an infra/cost decision, not a code
decision — a Fly.io GPU machine or a customer's own GPU box. Model choice also matters:
a smaller model (Llama 3.1 8B, Mistral 7B) is realistic on modest hardware; anything
requiring multi-GPU is out of scope for "run in-house" as a lightweight option.

**Risks:**
- Quality gap vs. Claude/GPT-4-class models on the nuanced grounding/critique work
  `llmCompose.ts` does (its `passesGrounding` check rejects any invented number/name —
  a weaker local model may fail this check more often, meaning more silent fallbacks to
  the deterministic template, which is safe but degrades the "LLM-composed" value prop).
- Ollama has no built-in multi-tenant auth — it must sit behind the existing Clerk-gated
  `/llm` route (already true architecturally) and never be exposed directly.

**Self-hosting / on-prem:** Yes — this is the entire point of the item. Fully airgappable
if the model weights are pre-downloaded.

**Sequencing note:** genuinely blocked on item 1 landing first; there is no standalone
Ollama integration path that doesn't go through the provider-agnostic layer (doing it
directly would mean hand-rolling yet another provider-specific branch in `llm.py`, which
defeats the purpose).

---

## 3. Splink — explainable entity resolution

**What it is:** a Python probabilistic record-linkage library (Fellegi-Sunter model) that
learns match weights from data volume and produces a match probability plus an
explainable "why this pair matched" breakdown per comparison (name similarity, address
overlap, etc.).

**Why it's asked for:** strengthening canonical account matching beyond the current
deterministic cascade, while staying explainable — the product's core design principle
(CLAUDE.md) is that every account link must show its evidence, never be an opaque score.

**Current state (read in full):**
- `frontend/src/identity/canonicalAccounts.ts` — a 289-line, **fully deterministic**
  cascade, tried in strict order per (account, entity) pair: `exact_domain` (0.98) →
  `cage_uei` (0.96) → `alias` (0.90) → `program` (0.82) → `name_fuzzy` via Jaccard
  token-set similarity, accepted only if ≥0.82 (raw score used as confidence) → else
  unmatched. `RELATIONSHIP_CONFIDENCE_FLOOR = 0.72` gates the final result
  (`resolveSignalRelationships`, lines 273–288). Every match produces a
  `SignalRelationship` record — `{canonical_account_id, source_entity_name, match_method,
  evidence, confidence, review_status, creation_source, last_validated_at}`
  (`frontend/src/engine/signals/contract.ts:40-49`) — with a **human-readable evidence
  string** per match (`domain:boeing.com`, `cage:81205`, `token_similarity:0.86`).
- Backend `CanonicalAccount` model (`btx_platform/models.py:129-150`) stores the resolved
  identity (domains, aliases, CAGE, UEI, parent/subsidiary) but does **no matching itself**
  — `_sync_canonical_accounts` (`api.py:249-277`) is a pure upsert keyed on IDs the
  frontend/HubSpot mapping already assigned. All resolution logic lives client-side, in TS.
- Reference data: `clients/btx/data/defense_primes_enrichment.json` — 17 hand-curated
  defense-prime accounts, each identifier (CAGE/UEI) individually tagged `verified: bool`
  + `source` — i.e. already provenance-tagged reference data, which is exactly the shape
  Splink would also need as its comparison/blocking data.
- Test coverage (`frontend/tools/test-canonical-identity.ts`) explicitly asserts a
  **weak-match rejection** case (similar-sounding but wrong company must NOT match) and
  an **unconfirmed-identifier** case (an unverified CAGE match must carry
  `review_status: "unconfirmed"`) — the explainability bar is already enforced by tests
  today, which is the bar Splink must also clear.

**Where it would slot in vs. what exists:** Splink would sit *before* the deterministic
cascade, not replace it — as a candidate-generation/blocking step for messy incoming
records (e.g., a CSV import or a new data source with noisy company names/addresses) that
produces a shortlist of probable matches, which the *existing* deterministic cascade then
confirms or rejects using its exact-identifier rules. Splink's own match weights and
comparison vectors are inspectable per-pair (`splink`'s `predict()` returns a full
breakdown), so this can still surface an "evidence" string in the same
`SignalRelationship.evidence` field — e.g. `splink_prediction:0.94 (name+address+domain
partial match)`.

**Scale reality check (a real finding, not a minor caveat):** demo data is 25 companies,
84 signals, 17 reference entities. Splink is designed for datasets where deterministic
rules break down from noise at volume — tens of thousands to millions of records. At
today's scale, there is no volume to train reliable Fellegi-Sunter match weights, and the
existing exact-identifier cascade (CAGE/UEI are unique government-issued IDs; domains are
unique) already covers the identifier space cleanly. **Introducing Splink today would be
premature machinery for a problem the current code doesn't have yet.**

**Exact integration point (when it becomes proportionate):** a new Python
service/job — Splink is Python-only with no JS/TS bindings, and there is no existing
Python matching code anywhere in this repo to extend (`monitor_engine/`'s "dedup"
functions — `archive/core.py`, `grouping.py` — all dedupe articles/mentions, not company
identities; confirmed via direct read, zero overlap). It would run as a batch/async job
(reusing the already-built Celery worker infra from `btx_platform/workers/`) triggered
when a new bulk data source is ingested (see item 6), writing candidate matches into a
new `pending_relationship_candidates` table for human/deterministic-cascade confirmation
— never auto-confirming a link on its own, to preserve the explainability requirement.

**New dependencies:** `splink` (pip; pulls in DuckDB by default as its comparison
backend — lightweight, embedded, no separate service needed for the data volumes this
product would plausibly see even at real-customer scale).

**Effort: L** (when justified) — new Python service, new table, new job wiring, and
non-trivial calibration work to get match weights right without a large labeled dataset
to train against (a cold-start problem Splink itself doesn't solve).

**Risks:** the biggest risk is scope/timing, not technical — building this now, before
there's a real messy-data ingestion source (item 6 is still blocked on knowing the real
source systems), means calibrating match weights against synthetic/demo data that won't
reflect real-world name/address noise.

**Self-hosting / on-prem:** Yes — Splink runs fully locally (DuckDB backend needs no
external service; Spark/Postgres backends are also available for larger scale, both
self-hostable).

**Recommendation: defer.** Not "reject" — the architecture question ("where does it slot
in, does it replace anything") has a clean answer, but doing it now is solving a problem
that doesn't exist at current data volume. Revisit alongside item 6 (real ingestion)
once an actual messy/noisy external data source is identified.

---

## 4. react-force-graph — situation-board relationship graph

**What it is:** a canvas/WebGL force-directed graph component for React. Use
**`react-force-graph-2d`** specifically (not the default package, which bundles 3D/VR via
three.js/A-Frame) — this is a business dashboard, not a 3D showcase, and 2D mode avoids
the heavy three.js dependency entirely.

**Reference image note:** `design/reference/BTX_Situation_Board.png` does not exist
anywhere in the repo (checked directly, and confirmed independently in the earlier
design-system-restyle audit). This plan proceeds on the existing `RelationshipGraph`
component's intent, not a mockup that doesn't exist — flag to the requester if a specific
visual reference is expected to be supplied later.

**Current state (read in full):**
- `frontend/src/ui/graph/RelationshipGraph.tsx` (120 lines) **already exists** but is
  **orphaned dead code** — confirmed via grep, it is imported and rendered nowhere (`App.tsx`'s
  surface switch has no `graph`/`relationships` case, and `<RelationshipGraph` appears in
  no other file). It currently wraps `@xyflow/react` (already an installed dependency,
  `frontend/package.json`), rendering a hub-and-spoke star (every company gets exactly
  one edge back to "self" — not a general graph), with node border colors from
  `uiTokens.color.{success,accent,warning,danger}` keyed by `relationship` type, click →
  `setState({activeCompanyId})` opens the dossier, dragging disabled.
- `frontend/src/ui/map/ProspectMap.tsx` — Leaflet-based, pins only, **no relationship
  edges at all** (no parent/subsidiary or supplier-chain lines drawn between pins).
- Relationship/edge data already exists in two forms ready to become graph edges:
  `CanonicalAccount.parent_id` / `subsidiary_ids` (`btx_platform/models.py:144-145`, mirrored
  in `frontend/src/engine/brain/entities.ts`'s `Company` type) for structural org-chart
  edges, and `SignalRelationship {canonical_account_id, match_method, confidence,
  evidence}` (`frontend/src/engine/signals/contract.ts:40-49`, produced by
  `resolveSignalRelationships`) for evidence-backed signal-to-account edges — confidence
  maps cleanly to edge weight/opacity, `match_method` to a tooltip/label.
- No `AccountToken`/status-ring component exists in this codebase snapshot for
  risk-derived node styling (confirmed via grep — no `growing`/`at-risk`/`churned`
  derivation anywhere). Any such component referenced in other planning docs has not
  landed in the code this plan read; treat node status styling as net-new work here,
  reusing `uiTokens.color.{success,warning,danger}` directly rather than assuming a
  ready-made component.
- Lazy-loading precedent is established and should be followed exactly:
  `ProspectMap` is `lazy(() => import(...))` wrapped in `<Suspense>` (`App.tsx:26`,
  `85-87`) — the same pattern for a new force-graph surface.

**Exact integration point:** two real options, not one — worth a decision before starting:
1. **Replace** `RelationshipGraph.tsx`'s internals (keep the file/component name, same
   props `{world: World}`) — swap `@xyflow/react` for `react-force-graph-2d`, expand
   beyond the hub-and-spoke shape to a real multi-edge graph using `parent_id`/
   `subsidiary_ids` (structural) and `SignalRelationship` (evidence-backed) as two
   distinct edge types, styled differently (solid/teal for structural or high-confidence,
   dashed/muted for low-confidence — matching the confidence-gradient visual language
   already established elsewhere in the design system for provenance).
2. **Keep both** — `@xyflow/react` is already paid for in bundle size and does flowchart-
   style layouts well; react-force-graph does organic physics-based clustering well.
   Cheaper to just replace, since the current component has zero callers to migrate.

Recommend option 1 (replace) — `@xyflow/react` has no other consumer in the codebase, so
keeping it around after adding a second graph library would be pure bundle-size waste for
zero benefit.

Then: wire it as a reachable surface — add a `SurfaceId` entry (`frontend/src/app/surfaces.ts`),
a case in `App.tsx`'s surface switch, and a rail nav entry — since today it is unreachable
from the running app regardless of what renders inside it.

**New dependencies:** `react-force-graph-2d` (pulls in `d3-force` for physics simulation,
`three.js` is NOT pulled in by the 2D-only subpackage — confirmed this is the point of
using `-2d` specifically rather than the umbrella package). Net bundle delta should be
modest; verify with a build-size check once wired (this repo already tracks chunk sizes
in its Vite build output and has a documented 500 kB chunk-size concern from prior work —
worth checking against that budget).

**Effort: M.** The component shell exists; the real work is (a) expanding edge modeling
beyond hub-and-spoke, (b) wiring it as a reachable surface (currently isn't one), (c) a
first pass at node status styling since no ready-made token component was found for it.

**Risks:**
- Physics-based force layouts can be visually unstable/jittery with frequent re-renders;
  needs a stable `world`-derived key (same pattern `ProspectMap` already uses for its
  Leaflet `key={world.city}` remount strategy) to avoid the graph re-simulating on every
  unrelated state change.
- Mobile/touch interaction with a force graph (pinch-zoom, drag) is meaningfully harder to
  get right than Leaflet's mature touch handling — budget real device-testing time, not
  just a desktop check.

**Self-hosting / on-prem:** N/A — this is a client-side rendering library with no
network/service dependency, not an infra decision.

---

## 5. anti-ai-slop-writing — copy-quality rubric

**What it is:** per the task, a "skill install plus a composition-layer step" — i.e., two
distinct things, not one:
(a) a Claude Code skill (author-time — helps *this assistant* write better copy when
    editing files in this repo), and
(b) a runtime rubric the *app itself* enforces when the LLM composes deliverable prose,
    independent of whether a coding assistant is involved at all.

**Precedent for (a) already in this repo:** `.claude/skills/hallmark` exists (a symlink
to `.agents/skills/hallmark/SKILL.md` — confirmed via direct inspection) — an "anti-AI-slop
design skill" already installed the same way. Installing `anti-ai-slop-writing` alongside
it is a same-shape, low-effort action (a skill install, not a code change) — this is the
part of item 5 that's essentially free.

**Current state for (b) (read in full):**
- Every deliverable agent (`weeklyMemoAgent.ts`, `meetingBriefAgent.ts`, `outreachAgent.ts`,
  `boardDeckAgent.ts`, `salesPitchAgent.ts`, `capabilitiesAssessmentAgent.ts`,
  `itineraryAgent.ts`, `analysisAnnotationAgent.ts`) implements the shared
  `DeliverableAgent` contract (`frontend/src/agents/contract.ts:20-30`): a deterministic
  `compose()` builds a template, then `runAgent.ts` optionally hands it to
  `llmCompose.ts`'s `maybeComposeWithLlm` for LLM-generated prose, then re-validates.
- `llmCompose.ts`'s system prompts (`composeOnce` lines 43–54, critique pass lines 88–91)
  already enforce: only use provided facts, never invent numbers/names, no generic filler,
  answer-first, evidenced claims — **but nothing about writing mechanics** (no em-dash
  ban, no hedge-phrase ban, no banned-opener list like "In today's fast-paced world").
- The **only** existing style-mechanics enforcement is `frontend/src/deliverables/designTokens.ts`'s
  `stripEmDashes()`/`assertNoEmDash()` — and it runs at **render time**, inside the
  Steel & Signal PPTX/PDF/HTML template layer (`steelSignalTemplates.tsx`, `deck/pptx.ts`),
  *after* the LLM has already generated prose — meaning today an em-dash-heavy draft gets
  silently mechanically stripped/replaced rather than the LLM being told not to produce
  one in the first place. That's a band-aid, not a prompt-level fix.
- Separately, `frontend/src/agents/contract.ts` already has banned-*vocabulary* lists
  (`PROSPECT_BANNED`, `INTERNAL_BANNED` — internal jargon like "signal," "fit %,"
  "provenance") enforced in `validateAudienceAndForm` — this is audience-appropriateness
  enforcement, a different concern from writing-quality/AI-tell enforcement, and a good
  precedent for where a new check would slot in structurally.
- `frontend/src/ui/deliverables/DocumentViewer.tsx`'s section-rewrite path
  (`editorAssistant.ts`'s `requestSectionRevision`) is a **second, independent** prompt
  injection point with weaker guardrails than `llmCompose.ts` — its system prompt
  references "banned vocabulary" by name but doesn't actually pass the list in the
  request payload. Any writing-quality rubric needs to reach both call sites, not just one.
- `frontend/src/app/promptContract.ts`'s `GROUNDING_CONTRACT` governs the separate
  Chatpil chat surface (`jarvis.ts`), not deliverable composition — a sibling location,
  not a shared one; a writing-quality rubric constant belongs in `llmCompose.ts` directly
  (or a new shared file both `llmCompose.ts` and `editorAssistant.ts` import) since that's
  the actual generation call site, not the chat-prompt file.
- Settings has a "Prompts & rubrics" section already scaffolded as an explicit placeholder
  (`settingsSections.ts:26-29`, `SettingsWorkspace.tsx:118-122`) with copy stating rubric
  editors "land here after engine settings are wired" — i.e., this is the *intended*
  future home for an editable rubric, but nothing is wired yet.

**Exact integration point:**
1. Skill install: add `anti-ai-slop-writing` under `.claude/skills/`, same mechanism as
   `hallmark` — zero app code touched.
2. Runtime rubric: new `WRITING_QUALITY_RUBRIC` constant (new file
   `frontend/src/agents/writingQuality.ts`, or inline in `llmCompose.ts`) — a short,
   explicit list of banned AI-tell patterns (generic openers, hedge phrases, em-dash
   overuse, "it's important to note," etc.) — threaded into `composeOnce`'s and
   `critiqueAndRevise`'s system prompts (`llmCompose.ts:43-54`, `88-91`) AND into
   `editorAssistant.ts`'s `requestSectionRevision` system prompt (currently missing the
   actual banned list despite referencing it), so both generation paths are covered.
3. Optional but recommended: promote `stripEmDashes`/`assertNoEmDash` from a
   render-time-only guard to also being explicitly stated in the prompt rubric (belt and
   suspenders — the prompt should try to avoid it, the render layer should still catch
   what slips through).
4. Do **not** build the Settings "Prompts & rubrics" editor UI as part of this — that's a
   separate, already-flagged-as-future-work item; ship the rubric as a fixed constant
   first (matches how `GROUNDING_CONTRACT` and `AGENT_RUBRICS` already ship today).

**New dependencies:** none — this is prompt text plus one skill install, not a library.

**Effort: S.**

**Risks:** a copy-quality rubric this explicit runs a small risk of the LLM over-correcting
into stilted, checklist-driven prose if the banned-phrase list is too aggressive or too
literal — validate with a few real generations across at least the three named surfaces
(brief, newsletter, outreach) before considering it done, not just a prompt diff review.

**Self-hosting / on-prem:** N/A — this is prompt engineering, not infrastructure. It
travels automatically with whichever LLM provider is configured via item 1.

---

## 6. Data ingestion seam (DEFERRED — plan the seam only, no tool choice)

**Explicitly blocked** on knowing the real source systems (per the task). This section
plans only where an ingestion layer will attach, using what's already built.

**What already exists (a real, working generic ingestion seam — not a gap to fill from
scratch):**
- `POST /webhooks/{connection_id}` (`btx_platform/api.py:1037-1038`) — exempt from Clerk
  auth (machine-to-machine, not a user session) but authenticated by its own per-connection
  HMAC signature (`WEBHOOK_PATH_PREFIX` exclusion, `api.py:61-63`).
- `btx_platform/ingest.py`'s `ingest()` function — a clean, fully unit-tested pipeline
  independent of HTTP: verify HMAC signature (constant-time, encrypted-at-rest secret via
  `decrypt_if_encrypted`) → parse + strictly validate against `WebhookEnvelope`
  (`btx_platform/schemas.py:14-28`, `extra="forbid"` so unexpected fields fail fast) →
  idempotency dedupe (header → envelope key → external_id precedence) → persist raw
  payload verbatim to an `Event` row → enqueue for background forwarding. Returns a typed
  `IngestOutcome`.
- `WebhookEnvelope`'s shape is already deliberately generic: `{event_type: str, data:
  dict, external_id?: str, idempotency_key?: str}` — i.e., **any** source system that can
  be mapped to this envelope shape already has a working ingestion path today, with
  signature verification, dedup, encrypted-secret storage, and durable audit (`Event`
  table) for free.
- `Connection` model (`btx_platform/models.py:47-59`) already models both inbound sources
  and outbound destinations generically (`direction: inbound|outbound`,
  `destination_url` for forwarding), with per-tenant scoping already wired.
- The worker side (`btx_platform/workers/forward.py`) already retries with backoff and
  dead-letters after `max_attempts`, writing an `OutboundLog` row per attempt — this is
  the same path that would forward a mapped record onward to HubSpot once ingested.
- `_sync_canonical_accounts` (`api.py:249-277`) is the exact seam where an ingested,
  externally-sourced record — once mapped to a `canonical_account_id` (by the existing
  deterministic cascade in `canonicalAccounts.ts`, or eventually Splink's candidate
  generation per item 3) — gets upserted into `CanonicalAccount`.

**The actual seam for a future ingestion layer:** a new adapter that (a) receives or
polls an arbitrary source system, (b) maps its records into `WebhookEnvelope`'s
`{event_type, data, external_id}` shape, (c) POSTs to `/webhooks/{connection_id}` (or, for
a batch/non-webhook source, calls `ingest()` directly without the HTTP hop). No backend
plumbing needs to be built for this to work — the seam is the envelope-mapping function
per source type, which is exactly the part that's blocked on knowing what the source
systems actually are (a CRM export? a spreadsheet upload? a partner API? each implies a
different mapping function, polling vs. push, and auth model).

**What this plan explicitly does NOT decide:** which tool (Airbyte, Meltano, a bespoke
script, CSV upload UI) sits in front of the envelope-mapping step. That's the part
genuinely blocked on real source-system knowledge, per the task's own instruction.

**Effort to unblock:** not a coding task — a discovery conversation about what the real
source systems are (a CRM other than HubSpot? spreadsheets? a partner data feed?). Once
known, the mapping-function effort per source is typically S–M each, since the hard
infrastructure (auth, dedup, retry, audit, tenant scoping) is already built and tested.

---

## Recommended sequence

| Order | Item | Depends on | Effort | Status |
|---|---|---|---|---|
| 1 | **LiteLLM** | — | S | Ready to build now — highest value, unlocks the top requirement, cleanest single-file swap point in the codebase. |
| 2 | **Ollama** | LiteLLM (1) | S | Ready once (1) lands; pure config, no new code path. Confirm GPU/hardware plan before committing to it as a default. |
| 3 | **anti-ai-slop-writing** | — | S | Ready to build now, fully independent of the others. Do the skill install and the runtime rubric together; validate against real generations before calling it done. |
| 4 | **react-force-graph** | — | M | Ready to build now, independent of the others. The component shell exists but is disconnected — decide replace-vs-keep-@xyflow (recommend replace) before starting. |
| 5 | **Splink** | Item 6 (real ingestion source) | L | **Deferred, not blocked-forever** — revisit once a real messy/noisy data source exists. Building it against 25 demo companies would be premature machinery solving a problem the current cascade doesn't have. |
| 6 | **Data ingestion tool choice** | External: source-system discovery | — | **Blocked** on a product/business decision (which source systems), not a technical one. The seam is already built and tested; nothing to code until sources are named. |

**Build-vs-sell discipline flags:**
- Splink (item 3) is the one candidate this plan actively recommends *not* doing yet,
  despite being asked to plan it — the honest answer given the actual data volume is
  "defer," not "here's how to build it Monday." Planned anyway per the task's
  instructions, with the deferral reasoning made explicit rather than silently sized down.
- react-force-graph's node-status-styling sub-task assumed a ready-made design-system
  component in earlier framing of this work; direct code inspection found none — flagged
  above so effort isn't underestimated against a component that isn't actually there yet.
- LiteLLM and the writing-quality rubric are the two genuinely "just do it" items — small,
  isolated, no architecture risk, real value now.
