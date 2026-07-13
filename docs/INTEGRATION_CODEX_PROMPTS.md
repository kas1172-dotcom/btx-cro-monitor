# Integration Codex Prompts

Source: `docs/INTEGRATIONS_PLAN.md`. Prompts only — no implementation code in this doc.
Ordered by the plan's recommended sequence. Each prompt is self-contained and grounded in
the actual current code (file:line citations carried over from the plan).

**Paste the House Rules block (from `CODEX_EXECUTION_PLAYBOOK.md`) before every prompt
below, once per Codex session** — same convention as this repo's other work-package
prompts (see `design/reference/WP9_DELIVERABLE_TEMPLATES_SPEC.md`'s "paste after the
House Rules" instruction). Do not paste a prompt without it; the House Rules define the
branch/commit/verification discipline these prompts assume but don't restate in full.

Note on Splink: the plan's own recommendation is **defer**, not build — see the plan's
"Recommendation: defer" and "Build-vs-sell discipline flags" sections. No Codex prompt is
included for it here; producing one would contradict the plan's explicit recommendation
not to build it yet. It is planned to slot in alongside item 6 once a real messy-data
source exists (see the ingestion stub below).

---

## 1. LiteLLM — provider-agnostic LLM layer

```
# Task: WP-INT1 — swap the Anthropic-only LLM call for LiteLLM, provider-agnostic by config

Objective: replace btx_platform/llm.py's hand-rolled Anthropic-only httpx call with
litellm.acompletion(), so the model/provider is selectable by config (Anthropic, Gemini,
OpenAI, or a local model) instead of hardcoded. This is the WP10-style "provider-agnostic,
possibly Gemini, run in-house" requirement — see docs/INTEGRATIONS_PLAN.md section 1 for
the full research this prompt is based on.

Exact integration points (from the plan, verified against the code):
- btx_platform/llm.py: one function, call_anthropic(payload: LlmProxyRequest, settings:
  Settings) -> str (line 22). Raw httpx.AsyncClient POST to settings.anthropic_base_url,
  Anthropic-specific headers (x-api-key, anthropic-version), hand-parses Anthropic's
  content:[{type,text}] response envelope (lines 27-68). This is the ONLY place that talks
  to an LLM provider — confirmed by grep, no other file imports btx_platform.llm's
  provider-calling internals.
- btx_platform/api.py's POST /llm route (~lines 460-480): validates LlmProxyRequest, calls
  call_anthropic, returns {"text": ...}. Already fully protected by the existing auth
  middleware (Clerk + MUTATING_ROUTE_MIN_ROLE="analyst" + per-user RateLimiter) — do not
  add any auth/rate-limit special-casing for this route; it must keep going through the
  same middleware every other mutating route uses.
- btx_platform/config.py: currently has anthropic_api_key, anthropic_base_url,
  anthropic_version, llm_timeout_seconds (45.0), llm_max_body_bytes (524288).
- Frontend contract is NOT changing: frontend/src/brain/llmRouter.ts,
  frontend/src/agents/llmCompose.ts, frontend/src/brain/jarvis.ts, and
  frontend/src/ui/deliverables/DocumentViewer.tsx all send {model, system, messages} and
  expect {text} back from the backend. If the swap stays entirely inside llm.py, none of
  these four files need to change. Verify this remains true; if it doesn't, stop and
  reconsider before touching any frontend file.

Dependencies and order: none — this is the first item in the plan's recommended sequence
and has no blocking dependency. Branch from main (or whatever the current integration
branch tip is — confirm with the user which base to use before starting).

Implementation steps:
1. Add `litellm` to pyproject.toml's platform extra dependencies. Either remove the
   unused `anthropic>=0.50` pin (confirmed dead — zero `import anthropic` anywhere in
   btx_platform/) or leave a comment noting it's superseded by litellm's own Anthropic
   passthrough.
2. In btx_platform/config.py, add: `default_llm_model: str = "claude-haiku-4-5-20251001"`
   (or whatever the current default model id is — check llm.py's DEFAULT_MODEL constant
   and preserve it as the default), plus any additional provider key settings needed
   for the providers you wire in this pass (at minimum keep anthropic_api_key working;
   add gemini_api_key: str | None = None if Gemini is being wired now, per the "possibly
   Gemini" requirement — confirm with the user whether Gemini keys should be added now
   or left for a follow-up).
3. In btx_platform/llm.py, replace call_anthropic's body with a call to
   litellm.acompletion(model=..., messages=[...], timeout=settings.llm_timeout_seconds,
   api_key=...). Keep the exact same function signature
   (call_anthropic(payload, settings) -> str) so btx_platform/api.py's route code does
   not need to change, OR rename to call_llm and update the one import site in api.py —
   pick whichever the user prefers, but do not change the route's request/response
   handling either way.
4. Re-map error handling: litellm raises typed exceptions per failure class (auth error,
   rate limit, timeout, etc.) — catch these and re-raise as the existing
   LlmProviderError(detail, status_code) shape so api.py's `except LlmProviderError`
   handler (which returns {"code": "llm_provider_error", "detail": ...}) keeps working
   unchanged.
5. Parse litellm's OpenAI-style response (`response.choices[0].message.content`) instead
   of Anthropic's `content:[{type,text}]` blocks.
6. Update tests/test_platform_tier1.py::test_llm_route_matches_proxy_contract — it
   currently mocks btx_platform.llm.httpx.AsyncClient directly and asserts on Anthropic's
   exact wire shape (anthropic_base_url, x-api-key header, content:[{type,text}]
   response). Rewrite it to mock litellm.acompletion (or its underlying HTTP transport)
   and assert against the OpenAI-style response shape instead. This is a required test
   update, not optional cleanup — the plan flags it explicitly as "a real, known-size
   test change."
7. Confirm the /health route's `"llm": bool(settings.anthropic_api_key)` flag
   (btx_platform/api.py) and btx_platform/health.py's `integration_status("LLM", ...)`
   still reflect whether an LLM provider is actually configured — if the check should
   now be "is any provider key set" rather than only anthropic_api_key, update it, but
   do not silently drop the health check.

Tests required:
- Update the existing test_llm_route_matches_proxy_contract test (step 6 above) — this
  is a regression test for the exact same behavior (the /llm route proxies correctly),
  just against the new wire shape.
- New test: a provider-switch test proving that changing default_llm_model / the
  relevant provider API key setting actually changes which provider litellm.acompletion
  is invoked with (mock litellm.acompletion and assert on the `model=` kwarg passed).
- New test: confirm LlmProviderError is still raised with the correct status_code for
  an auth failure, a timeout, and a generic provider error — one test per failure class,
  mirroring the three failure modes call_anthropic used to handle by hand.
- Do not remove or weaken any existing auth/rate-limit test for the /llm route.

Manual steps only a human can do:
- Provide the actual API key(s) for whichever provider(s) are being wired now (Anthropic
  key already exists; a Gemini key if Gemini is in scope for this pass; do not fabricate
  a placeholder key in code or tests — use a fake test key in test fixtures only, as the
  existing test does with "anthropic-test-key").
- Confirm which model id(s) should be the default for each provider — do not guess a
  Gemini model string without the user confirming it.
- Decide whether to keep backward-compatible env var names (BTX_ANTHROPIC_API_KEY, etc.)
  or introduce a more generic naming scheme (BTX_DEFAULT_LLM_MODEL, BTX_GEMINI_API_KEY) —
  this affects the deploy runbook (docs/DEPLOY_BACKEND.md) and Fly secrets, which a human
  must update on the actual deployed environment; do not attempt to change live Fly
  secrets yourself.

Branch: feat/litellm-provider-agnostic

Verification (must be green before opening a PR):
```
cd frontend && npm ci && npm run typecheck && npm run build
npm run test:metrics && npm run test:rail && npm run test:settings
npm run test:flows && npm run test:tour
cd .. && python3 -m pytest -q
```
Do not skip test:flows or test:tour. If frontend/package.json has a check:design script
by the time this lands (from the design-system-restyle work, if merged), run it too —
this change touches no UI, so it should pass trivially, but confirm rather than assume.

Preserve existing functionality, auth, and provenance: the /llm route's auth/rate-limit
middleware, the frontend's {model,system,messages}->{text} contract, and every other
backend route are out of scope for this change — touch only btx_platform/llm.py,
btx_platform/config.py, btx_platform/api.py's LLM-related lines if the function is
renamed, pyproject.toml, and the one test file named above.

Open a PR into main. Do not merge.
```

---

## 2. Ollama — local model runtime behind LiteLLM

```
# Task: WP-INT2 — wire Ollama as a selectable LiteLLM provider for on-prem/controlled-data use

Objective: make it possible to point the existing /llm proxy at a locally-hosted Ollama
instance (open-weight model, e.g. Llama 3.1 or Mistral) purely by configuration, for the
on-prem / controlled-data deployment case. See docs/INTEGRATIONS_PLAN.md section 2.

Dependencies and order: HARD DEPENDENCY on WP-INT1 (LiteLLM) already merged. Do not start
this until btx_platform/llm.py calls litellm.acompletion(model=..., ...) with the model
selectable via settings.default_llm_model. There is no standalone Ollama integration path
that bypasses LiteLLM — attempting one means hand-rolling a second provider-specific
branch in llm.py, which defeats the point of WP-INT1. If WP-INT1 is not yet merged, stop
and do not proceed.

Exact integration point: none beyond configuration, once WP-INT1 is done. LiteLLM already
supports `model="ollama/<model-name>"` as a first-class provider string and reads
OLLAMA_BASE_URL (or an explicit api_base kwarg) to find the Ollama server.

Implementation steps:
1. In btx_platform/config.py, add `ollama_base_url: str | None = None` (e.g.
   "http://ollama:11434" for a sibling container, or a customer-provided URL for
   on-prem). Do not default this to a hardcoded localhost value that would silently
   break in production if unset — leave it None and let call_llm/call_anthropic's
   provider-dispatch fail closed with a clear "not configured" error if a caller
   requests model="ollama/..." without ollama_base_url set.
2. Ensure whatever function replaced call_anthropic in WP-INT1 passes
   api_base=settings.ollama_base_url through to litellm.acompletion when the model
   string starts with "ollama/" (LiteLLM's own routing may already do this via the
   OLLAMA_BASE_URL env var — confirm which mechanism you're using and be consistent,
   don't wire both an env var AND an explicit kwarg redundantly).
3. Add a docker-compose service (or equivalent local-dev instructions in
   docs/DEPLOY_BACKEND.md) for running Ollama locally: the official `ollama/ollama`
   image, with a documented `ollama pull <model>` step (this is a manual step, see below
   — do not attempt to script a model pull into an automated test or CI step, since it
   downloads multiple GB and requires either GPU or patience).
4. Update btx_platform/health.py / the /health route's integration-status reporting so
   an Ollama-backed deployment can report whether the configured model is actually
   reachable (a lightweight ping/list-models call), consistent with how the existing
   health check reports LLM/HubSpot configuration status today.

Tests required:
- A test proving that model="ollama/llama3.1" with ollama_base_url set results in
  litellm.acompletion being called with the correct api_base (mock litellm.acompletion,
  assert on kwargs — do not require a real running Ollama instance for this test).
- A test proving that requesting an ollama/* model with ollama_base_url unset fails
  closed with a clear, typed error (not a silent fallback to another provider, not a
  hang) — this is a regression test for the "must not silently misroute" behavior.
- Do NOT add a test that requires a live Ollama server / actual model inference — that
  is an integration/manual verification step, not something CI should depend on.

Manual steps only a human can do:
- Decide and provision the actual hardware: GPU-backed (recommended — CPU inference on a
  7-8B model is multi-second per response, which will feel bad in Chatpil's synchronous
  UX) vs CPU-only acceptance. This is an infra/cost decision the plan explicitly flags
  as non-technical — do not choose this for the user.
- Pull the actual model weights on the target machine (`ollama pull llama3.1` or
  equivalent) — multi-GB download, not something to automate in this task.
- Decide which model to standardize on (Llama 3.1 8B and Mistral 7B are the plan's
  suggested realistic options for modest hardware) and confirm it produces acceptable
  quality against llmCompose.ts's passesGrounding check in a real trial run — a weaker
  local model may fail this check more often than Claude/GPT-4-class models, which is
  safe (falls back to the deterministic template) but degrades the LLM-composed value
  prop; this is a judgment call for the user to make after seeing real output, not
  something to certify from code alone.
- If deploying Ollama on Fly.io, provision and pay for the GPU machine — do not attempt
  this yourself.

Branch: feat/ollama-local-provider

Verification (must be green before opening a PR):
```
cd frontend && npm ci && npm run typecheck && npm run build
npm run test:metrics && npm run test:rail && npm run test:settings
npm run test:flows && npm run test:tour
cd .. && python3 -m pytest -q
```
Plus a manual verification note in the PR description: confirm against a real local
Ollama instance (the human-provisioned one from the manual steps above) that a live
completion round-trips correctly through the /llm route end-to-end. This manual check
cannot be part of the automated suite.

Preserve existing functionality: do not change the default provider/model for existing
deployments — Ollama must be strictly opt-in via configuration, never a default that
silently degrades response quality for the existing Anthropic-backed deployment.

Open a PR into main. Do not merge.
```

---

## 3. anti-ai-slop-writing — copy-quality rubric

```
# Task: WP-INT3 — install the anti-ai-slop-writing skill and add a runtime writing-quality rubric

Objective: two distinct pieces, per docs/INTEGRATIONS_PLAN.md section 5 — (a) install
anti-ai-slop-writing as a Claude Code skill, same mechanism as the already-installed
.claude/skills/hallmark; (b) add a runtime writing-quality rubric that the app itself
enforces when composing deliverable prose, independent of any coding assistant.

Exact integration points (from the plan, verified against the code):
- .claude/skills/hallmark exists as a symlink to .agents/skills/hallmark/SKILL.md —
  this is the precedent to follow exactly for the skill-install half of this task.
- frontend/src/agents/llmCompose.ts: composeOnce's system prompt (lines ~43-54) and
  critiqueAndRevise's system prompt (lines ~88-91) already enforce grounding (only use
  provided facts, never invent numbers/names, no generic filler, answer-first) but have
  NO writing-mechanics rules — no em-dash ban, no hedge-phrase ban, no banned-opener
  list ("In today's fast-paced world," "It's important to note," etc.).
- frontend/src/deliverables/designTokens.ts's stripEmDashes()/assertNoEmDash() is the
  ONLY existing style-mechanics enforcement today, and it runs at render time (inside
  steelSignalTemplates.tsx, deck/pptx.ts) — AFTER the LLM has already generated prose.
  That's a band-aid, not a prompt-level fix; do not remove it (it's a useful backstop),
  but add the prompt-level rule so it's rarely triggered in the first place.
- frontend/src/agents/contract.ts already has PROSPECT_BANNED / INTERNAL_BANNED
  vocabulary lists enforced in validateAudienceAndForm — this is audience-appropriateness
  enforcement (internal jargon vs. external-facing prose), a DIFFERENT concern from
  writing-quality/AI-tell enforcement. Do not conflate the two lists; add a new,
  separate rubric rather than appending to PROSPECT_BANNED/INTERNAL_BANNED.
- frontend/src/ui/deliverables/DocumentViewer.tsx's section-rewrite path
  (editorAssistant.ts's requestSectionRevision) is a SECOND, independent LLM call site
  with weaker guardrails — its system prompt references "banned vocabulary" by name but
  never actually passes the list in the request payload. Any writing-quality rubric must
  reach BOTH call sites (llmCompose.ts AND editorAssistant.ts), not just one.
- frontend/src/app/promptContract.ts's GROUNDING_CONTRACT governs the separate Chatpil
  chat surface (jarvis.ts) — a sibling location, not the right place for this rubric,
  since deliverable composition and chat are different call sites with different prompts.

Dependencies and order: none — independent of every other item in this plan, can be
built in parallel with WP-INT1/2/4.

Implementation steps:
1. Install the anti-ai-slop-writing skill under .claude/skills/, mirroring exactly how
   .claude/skills/hallmark is installed (check whether hallmark is a real directory or a
   symlink to .agents/skills/hallmark and replicate that same structure/mechanism — do
   not invent a different installation pattern).
2. Create a new shared constant — recommend frontend/src/agents/writingQuality.ts
   exporting WRITING_QUALITY_RUBRIC: a short, explicit list of banned AI-tell patterns:
   generic openers ("In today's fast-paced world," "In the ever-evolving landscape of"),
   hedge phrases ("it's important to note," "it's worth mentioning," "arguably"),
   em-dash overuse (already caught at render time, but state the rule at the prompt
   level too — belt and suspenders per the plan), and any other concrete AI-tell patterns
   the anti-ai-slop-writing skill's own reference material specifies (read the skill's
   SKILL.md/references after installing it in step 1 and ground this list in what it
   actually says, not a generic guess).
3. Thread WRITING_QUALITY_RUBRIC into llmCompose.ts's composeOnce system prompt AND its
   critiqueAndRevise system prompt (both call sites, not just one).
4. Thread the same rubric into editorAssistant.ts's requestSectionRevision system
   prompt — this is the call site that currently references "banned vocabulary" without
   actually including it; fix that gap as part of this same change.
5. Do NOT build the Settings "Prompts & rubrics" editor UI (settingsSections.ts /
   SettingsWorkspace.tsx already have this as an explicit placeholder for future work) —
   ship the rubric as a fixed constant, matching how GROUNDING_CONTRACT and
   AGENT_RUBRICS already ship today. Building that editor UI is explicitly out of scope.

Tests required:
- A new unit test (follow the existing pattern in frontend/tools/test-*.ts scripts) that
  asserts WRITING_QUALITY_RUBRIC's text is actually present in the system prompt string
  built by composeOnce, critiqueAndRevise, and requestSectionRevision — a regression test
  proving all three call sites received the rubric, not just one.
- Manually generate at least one deliverable of each of the three types named in the
  original task (a brief, the weekly newsletter, an outreach draft) with the LLM path
  enabled (VITE_COPILOT_ENDPOINT configured) and read the output for whether it still
  reads human — this is a qualitative check the plan explicitly calls for ("validate
  with a few real generations... before considering it done, not just a prompt diff
  review") and cannot be fully automated; document the manual check performed in the PR
  description with example before/after snippets if feasible.
- Do not weaken or remove the existing PROSPECT_BANNED/INTERNAL_BANNED enforcement in
  contract.ts's validateAudienceAndForm.

Manual steps only a human can do:
- Confirm the exact anti-ai-slop-writing skill source/repo to install from (github.com/
  jalaalrd/anti-ai-slop-writing per the original task) — do not guess an alternate
  source if the install mechanism used for hallmark expects a specific format.
- Review the qualitative "does this still read human" check in step 2 of Tests required
  above — this is a judgment call on prose quality that code cannot self-certify.
- Decide if the rubric is too aggressive (over-corrects into stilted, checklist-driven
  prose, per the plan's flagged risk) after seeing real output, and adjust the rubric's
  wording accordingly — an iterative human-in-the-loop step, not a one-shot code change.

Branch: feat/anti-slop-writing-rubric

Verification (must be green before opening a PR):
```
cd frontend && npm ci && npm run typecheck && npm run build
npm run test:metrics && npm run test:rail && npm run test:settings
npm run test:deliverables && npm run test:flows && npm run test:tour
cd .. && python3 -m pytest -q
```
test:deliverables specifically, since this change touches the deliverable-composition
system prompts.

Preserve existing functionality: the grounding checks (passesGrounding, banned
vocabulary via PROSPECT_BANNED/INTERNAL_BANNED, audience/form validation) must all keep
passing unchanged — this task ADDS a rubric, it does not relax any existing check.

Open a PR into main. Do not merge.
```

---

## 4. react-force-graph — situation-board relationship graph

```
# Task: WP-INT4 — replace RelationshipGraph.tsx's internals with react-force-graph-2d and wire it as a reachable surface

Objective: turn the currently-orphaned RelationshipGraph component into a real,
reachable situation-board view showing account relationships (structural
parent/subsidiary and evidence-backed signal links) as a force-directed graph. See
docs/INTEGRATIONS_PLAN.md section 4.

Note: design/reference/BTX_Situation_Board.png does not exist anywhere in the repo
(confirmed directly and independently by an earlier design-system audit). Do not
fabricate assumptions about a specific visual reference — build against this prompt's
description and the existing design system (uiTokens.ts / styles.css's CSS variables),
and flag to the user if a specific mockup is expected to be supplied later.

Exact integration points (from the plan, verified against the code):
- frontend/src/ui/graph/RelationshipGraph.tsx (120 lines) already exists but is
  ORPHANED DEAD CODE — confirmed via grep, no file renders <RelationshipGraph anywhere,
  and App.tsx's surface switch has no case for it. It currently wraps @xyflow/react
  (already an installed dependency with no other consumer in the codebase) rendering a
  hub-and-spoke star — every company gets exactly one edge back to "self," not a real
  multi-edge graph.
- Replace @xyflow/react with react-force-graph-2d specifically (NOT the default
  react-force-graph package, which bundles three.js/A-Frame for 3D/VR — this is a
  business dashboard, use 2D canvas mode only, which avoids the three.js dependency
  entirely).
- Edge data sources, both already modeled and ready to use as-is (no new backend fields
  needed):
  1. Structural edges: CanonicalAccount.parent_id / subsidiary_ids
     (btx_platform/models.py:144-145, mirrored in frontend/src/engine/brain/entities.ts's
     Company type).
  2. Evidence-backed edges: SignalRelationship {canonical_account_id, match_method,
     confidence, evidence} (frontend/src/engine/signals/contract.ts:40-49, produced by
     frontend/src/identity/canonicalAccounts.ts's resolveSignalRelationships). Map
     confidence to edge opacity/weight; map match_method to a hover tooltip/label.
- Node styling: no AccountToken/status-ring component exists anywhere in the current
  codebase (confirmed via grep for growing/at-risk/churned derivations — none found,
  despite this being referenced as existing in some other planning context). Treat node
  status styling as NET-NEW work in this task, using uiTokens.color.{success,warning,
  danger} directly (uiTokens.ts already exists and is already consumed by both
  RelationshipGraph.tsx and ProspectMap.tsx today).
- Confidence-gradient edge styling: solid/full-opacity/teal (uiTokens.color.accent) for
  structural or high-confidence (>= RELATIONSHIP_CONFIDENCE_FLOOR = 0.72, from
  frontend/src/identity/canonicalAccounts.ts) links; dashed/muted
  (uiTokens.color.textMuted) for low-confidence or unlinked — this should match whatever
  confidence-gradient visual language exists elsewhere in the design system if
  feat/design-system-restyle has merged by the time this lands (check for a
  ConfidenceEdge-style component before building a second, parallel implementation of
  the same visual idea).
- Lazy-loading precedent to follow exactly: ProspectMap is
  `lazy(() => import("./ui/map/ProspectMap.tsx")...)` wrapped in <Suspense> (App.tsx:26,
  85-87). Do the same for the graph surface.

Dependencies and order: none — independent of every other item in this plan.

Implementation steps:
1. Add react-force-graph-2d to frontend/package.json. Do NOT add the umbrella
   react-force-graph package (pulls in three.js unnecessarily).
2. Remove @xyflow/react from frontend/package.json once step 3 confirms nothing else
   uses it (grep the whole frontend/src tree for @xyflow/react imports before removing —
   the plan states it currently has zero other consumers, but re-verify at implementation
   time in case something changed).
3. Rewrite frontend/src/ui/graph/RelationshipGraph.tsx: same component name and props
   shape ({world: World}), but replace the @xyflow/react hub-and-spoke rendering with
   react-force-graph-2d fed by a real multi-edge graph: nodes from world.companies
   (reuse whatever the existing node-building logic already selects — top N by score
   dimension, matching today's ~22-node cap logic), TWO edge types per the data sources
   above (structural parent/subsidiary, and evidence-backed SignalRelationship), styled
   distinctly per the confidence-gradient rule above.
4. Node click behavior: keep the existing `setState({activeCompanyId: node.id})` pattern
   (opens the dossier) — do not change this interaction.
5. Add a stable, world-derived key to the graph component instance (mirroring
   ProspectMap's `key={world.city}` Leaflet-remount pattern) so the force simulation
   does not visually re-jitter on every unrelated state change — this is a named risk in
   the plan, address it directly rather than discovering it in manual testing.
6. Wire it as an actually-reachable surface: add a SurfaceId entry in
   frontend/src/app/surfaces.ts, a case in App.tsx's surface switch (lazy-loaded per
   step above), and a rail nav entry — today it is unreachable from the running app
   regardless of what renders inside it, and this task must fix that, not just improve
   the component in isolation.
7. Confirm this surface follows this repo's design-system conventions: use uiTokens.ts /
   the CSS variables it mirrors for every color; do not introduce hardcoded hex values
   (if frontend/tools/check-design-tokens.ts exists by the time this lands, from
   feat/design-system-restyle if merged, run it and confirm it passes).

Tests required:
- A unit test (follow the pattern in frontend/tools/test-map.ts, which tests
  mapModel.ts's marker-building logic) for the graph's node/edge-building function in
  isolation: given a World with known parent/subsidiary relationships and
  SignalRelationship records, assert the correct nodes and BOTH edge types are produced,
  with correct styling metadata (color/dash/opacity) per confidence tier.
- A regression test proving the surface is actually reachable: add a
  data-surface-component attribute (matching every other surface's convention — see
  frontend/tools/test-rail-tabs.ts's existing assertions) and assert the new surface
  renders when selected from the rail nav.
- Confirm existing test:map and test:rail suites still pass unchanged (this task does
  not touch ProspectMap.tsx's own logic, only adds a sibling graph surface).

Manual steps only a human can do:
- Visually review the graph's readability/clutter at realistic node counts (the demo
  data's ~25 companies, but also sanity-check readability assumptions at a larger
  hypothetical count since real customer data will likely have more accounts) —
  automated tests can't judge visual clarity.
- Test touch/pinch-zoom/drag interaction on an actual mobile device — the plan flags
  this as meaningfully harder to get right than Leaflet's mature touch handling; do not
  rely on desktop-only manual testing.
- If a specific BTX_Situation_Board.png reference design is later supplied, review the
  built surface against it and file follow-up visual-polish work — it does not exist
  today, so this task cannot be checked against it now.

Branch: feat/relationship-force-graph

Verification (must be green before opening a PR):
```
cd frontend && npm ci && npm run typecheck && npm run build
npm run test:metrics && npm run test:rail && npm run test:settings
npm run test:map && npm run test:flows && npm run test:tour
cd .. && python3 -m pytest -q
```
Also manually check the production build's chunk-size output for the new graph chunk
against this repo's existing ~500 kB chunk-size concern (documented in prior build
output) — paste the relevant `npm run build` chunk-size lines in the PR description.

Preserve existing functionality and design system: ProspectMap.tsx and its Leaflet
rendering are untouched by this task. Every color used in the new/rewritten component
must come from uiTokens.ts or the CSS variables it mirrors — no hardcoded hex values.

Open a PR into main. Do not merge.
```

---

## 6. Data ingestion seam — stub prompt (BLOCKED, do not implement)

```
# Task: WP-INT6 — STUB, BLOCKED on source-system answers. Do not implement anything from
# this prompt until the questions below are answered by a human with product/business
# context this assistant does not have.

Objective (once unblocked): map an arbitrary real source system's records into the
already-built generic ingestion pipeline, so they flow into canonical accounts and
onward to HubSpot. See docs/INTEGRATIONS_PLAN.md section 6 for the full architecture —
the seam itself is ALREADY BUILT and tested; this stub exists only to capture what's
missing before any implementation work can start.

What already exists and does NOT need to be built (confirmed by direct code read):
- POST /webhooks/{connection_id} (btx_platform/api.py:1037-1038), HMAC-signature
  authenticated, exempt from Clerk auth (machine-to-machine).
- btx_platform/ingest.py's ingest() function: signature verification (constant-time,
  encrypted-at-rest secret), strict WebhookEnvelope validation
  (btx_platform/schemas.py:14-28, extra="forbid"), idempotency dedupe, durable Event
  persistence, background-forward enqueue. Fully unit-tested already.
- WebhookEnvelope's shape is deliberately generic: {event_type: str, data: dict,
  external_id?: str, idempotency_key?: str} — any source mappable to this shape has a
  working ingestion path today.
- Connection model (btx_platform/models.py:47-59) already models inbound sources and
  outbound destinations generically, with per-tenant scoping.
- btx_platform/workers/forward.py already retries with backoff and dead-letters after
  max_attempts, logging every attempt to OutboundLog.
- _sync_canonical_accounts (btx_platform/api.py:249-277) is the exact seam where a
  mapped, canonical-id-assigned record gets upserted into CanonicalAccount.

The ONLY missing piece is a per-source "envelope-mapping function": something that
receives or polls an arbitrary source system and maps its records into
WebhookEnvelope's {event_type, data, external_id} shape, then POSTs to
/webhooks/{connection_id} (or calls ingest() directly for a batch/non-webhook source).
This is what's blocked.

QUESTIONS THAT MUST BE ANSWERED BEFORE ANY IMPLEMENTATION WORK CAN START:
1. What are the actual source systems? (A CRM other than HubSpot? Spreadsheet/CSV
   uploads from a sales team? A partner data feed? A different monitor/signal source?)
   Each implies a different mapping function, different auth model, and different
   push-vs-poll integration shape.
2. For each named source: is it push-capable (can call our /webhooks endpoint directly)
   or pull-only (we must poll it on a schedule)? Pull-only sources need a new scheduled
   job, not just a mapping function — a materially different implementation shape.
3. What authentication does each source system offer/require on our side (API key,
   OAuth, SFTP, manual export file)? This determines what credentials need to be
   provisioned and where they're stored (the existing encrypted-Connection.signing_secret
   pattern covers HMAC-signed push sources; a pull-based source needs its own credential
   storage, which may need new schema, not just new code).
4. What is the expected record volume and update frequency per source? This affects
   whether the existing Celery/Redis worker infra (already built, already handles
   retries/dead-lettering) is sufficient as-is, or whether a dedicated batch-ingestion
   path is needed for very large one-time imports (e.g. a CSV import of tens of
   thousands of rows would want different handling than a trickle of webhook events).
5. Does any source system's data volume/noise level actually justify Splink (item 3 in
   the parent plan, currently deferred)? The plan's Splink section explicitly ties its
   "revisit" trigger to this question — a source with genuinely messy/noisy company
   names or addresses at real volume would be the trigger to un-defer Splink; a clean,
   well-structured source (e.g. a well-maintained CRM export) would not.
6. Are there compliance/data-residency constraints on any specific source (e.g. can it
   leave a customer's network at all, does it need to route through the Ollama/on-prem
   LLM path from item 2 for any AI-assisted mapping/cleanup step)?

Do not guess answers to these questions and proceed. Do not implement a placeholder/demo
mapping function "just to have something." When these are answered, write a proper
Codex prompt following the same structure as WP-INT1 through WP-INT4 above, scoped to
the specific named source system(s).
```

---

## Sequencing summary

1. **LiteLLM** (WP-INT1) — no dependencies, start first.
2. **Ollama** (WP-INT2) — hard dependency on WP-INT1 merged.
3. **anti-ai-slop-writing** (WP-INT3) — no dependencies, can run in parallel with 1/2.
4. **react-force-graph** (WP-INT4) — no dependencies, can run in parallel with 1/2/3.
5. **Splink** — no prompt produced; plan recommends defer. Revisit once WP-INT6's
   question 5 is answered and points toward a real need.
6. **Data ingestion** (WP-INT6) — stub only; blocked on human answers to the six
   questions above, not on any other work package in this list.
