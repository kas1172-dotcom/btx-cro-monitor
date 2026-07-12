# BTX Engine — Platform Architecture Blueprint (paper draft, no code)

> Status: design only. No implementation in this document — it defines the
> architecture, stack, file structure, data model, and a phased roadmap so we
> can align before writing a line of the backend. Boilerplate (Phase 1 webhook
> receiver / queue / schema validation) is deliberately deferred to the build
> step.

## 0. The two engines, and how today's work fits

The full vision is **two engines** that share infrastructure:

1. **Integration Engine** — reliably moves data between the client's business
   tools (App A → App B) with no loss and no duplicates. This is a new,
   **always-on backend** (webhooks, queue, workers, database).
2. **Insights / "Dots Connector" Engine** — aggregates daily industry news,
   matches it to the client's *internal* business data, and emails a
   personalized "how the world affects your business" newsletter.

**What already exists (BTX_Engine / monitor-engine):** a serverless, static
realization of Engine #2's *intelligence* half — collectors, profile-grounded
LLM scoring, Signal Mesh (entity graph, cross-API enrichment, agentic research),
and the account map. It runs as a GitHub Actions batch and publishes a static
site.

**The decision this blueprint encodes:** keep that engine as a **library +
batch job**, and stand up a new **stateful backend service** for Engine #1. The
backend becomes the source of *live internal data*; the insights engine consumes
it and gains an **email** delivery channel. Two deployables, one platform.

```
                          ┌────────────────────────────────────────────┐
                          │            BTX Engine platform             │
                          ├───────────────────────┬────────────────────┤
   client tools  ───────► │  Integration Service  │  Insights Service  │ ───► inbox
   (App A, webhooks)      │  (always-on, FastAPI) │  (batch + workers) │
                          └───────────┬───────────┴─────────┬──────────┘
                                      │  shared Postgres + Redis        │
                                      └─────────────────────────────────┘
```

---

## 1. Architecture flow

### 1a. Integration Engine (reliable data movement)

```
App A
  │  POST webhook (signed)
  ▼
┌──────────────────────────────────────────────────────────────┐
│ Webhook Receiver (FastAPI)                                    │
│  1. verify HMAC signature           (reject 401 if bad)      │
│  2. validate envelope (Pydantic)    (reject 422 if bad)      │
│  3. dedupe on idempotency key       (skip if seen)          │
│  4. persist RAW payload → events    (status = received)     │
│  5. enqueue job (event_id)                                   │
│  6. return 200 OK  ◄── fast; no downstream call here        │
└───────────────────────────┬──────────────────────────────────┘
                            │ Redis queue
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ Worker: transform + forward (Celery)                         │
│  - load event, mark processing                              │
│  - map App A schema → App B schema (connector mapping)      │
│  - POST to App B                                            │
│      success → mark done, store outbound response          │
│      429/503 → retry w/ exponential backoff (max 5)        │
│      still failing → move to Dead Letter Queue + alert      │
│  - every step appended to the audit log                    │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
                          App B   (+ DLQ table for poison jobs)
```

Key guarantees:
- **Fast ack:** the receiver only persists + enqueues, then returns 200. No
  synchronous A→B call (the prompt's core rule).
- **No loss:** the raw payload is on disk (DB) before we ack; a worker crash
  re-runs from the stored event.
- **No duplicates:** idempotency key on ingest + a unique constraint on
  `(connection_id, external_id)` on the way out → upsert, never double-create.
- **Isolation of bad data:** after N failed attempts a job goes to the DLQ
  table and stops retrying, with an alert — it never blocks the queue.

### 1b. Insights / Dots Connector Engine (news → impact → newsletter)

```
Celery beat (daily cron)
  │
  ▼
News Aggregation worker ── fetch headlines + full text (news APIs / RSS)
  │                         [reuses monitor-engine collectors]
  ▼
Filter + entity extraction + cross-API enrichment   [reuses Signal Mesh]
  │
  ├──────────────► join with INTERNAL data ◄── from the Integration DB
  │                (the metrics/records synced by Engine #1)
  ▼
LLM Strategy orchestration  [reuses scorer/prompts; system prompt =
  │                          "corporate strategist: link this news to THESE
  │                           internal metrics and explain the impact"]
  ▼
Newsletter render (HTML email)  +  static dashboard (existing site)
  │
  ▼
Email delivery API (Resend / SendGrid) → subscribers
```

The intelligence stages are already built; the *new* parts are: pulling
**live internal data** from the integration DB, rendering an **email**, and
**delivery + scheduling**.

---

## 2. Recommended tech stack (solo-developer-friendly)

Chosen for reliability + the least moving parts one person can run.

| Concern | Choice | Why |
|---|---|---|
| Language | **Python 3.11+** | Reuses the entire existing engine (collectors, scorer, Pydantic models, Signal Mesh) with zero rewrite. |
| API framework | **FastAPI** | Async, fast, Pydantic-native validation at the boundary. |
| Queue + workers | **Celery + Redis** | Mature, built-in `autoretry` with exponential backoff, scheduled tasks via Celery beat, easy DLQ pattern. (Redis also doubles as cache.) |
| Database | **PostgreSQL** | Transactions, unique constraints for dedup, JSONB for raw payloads, durable audit log. |
| ORM + migrations | **SQLAlchemy 2.0 + Alembic** | Versioned schema changes; the prompt's "DB log of record." |
| Validation | **Pydantic v2** | Already the single source of truth in this repo — extend it to inbound envelopes. |
| Email | **Resend** (or SendGrid) | Simple API, good deliverability; one HTTP call from a worker. |
| Secrets | **Env vars** (+ a secret manager in prod) | Matches the existing non-negotiable rule. |
| Stored 3rd-party creds | **Fernet-encrypted column** (key from env/KMS) | Connection credentials at rest are encrypted, not plaintext. |
| Local dev | **Docker Compose** (api, worker, beat, postgres, redis) | One `up` command; mirrors prod topology. |
| Hosting | **Render / Fly.io / Railway** + managed Postgres + Redis | Push-to-deploy, managed backups, no server babysitting for a solo dev. |
| Observability | **structlog + Sentry**, a DLQ alert | JSON logs, error capture, paged when poison jobs pile up. |

> This is intentionally *not* a microservices/Kafka design. One API process,
> one worker process, one beat process, one DB, one Redis — the smallest stack
> that satisfies every reliability requirement.

---

## 3. Local project file structure

Two deployables in one monorepo so they can share the Pydantic models and the
existing engine. (Splitting into separate repos later is a `git subtree` away.)

```
btx-engine/
├── docker-compose.yml            # api, worker, beat, postgres, redis
├── pyproject.toml
├── alembic/                      # DB migrations
│   └── versions/
├── .env.example                  # documents every required env var (no values)
│
├── platform/                     # the new backend (Engine #1 + delivery for #2)
│   ├── api/
│   │   ├── main.py               # FastAPI app factory
│   │   ├── deps.py               # DB session, settings, auth
│   │   ├── security.py           # HMAC webhook signature verification
│   │   └── routes/
│   │       ├── webhooks.py       # POST /webhooks/{connection}  (the receiver)
│   │       ├── health.py
│   │       └── admin.py          # replay DLQ, inspect events (internal)
│   │
│   ├── schemas/                  # Pydantic boundary models
│   │   ├── envelope.py           # the inbound webhook envelope
│   │   └── connectors/           # per-integration inbound/outbound shapes
│   │
│   ├── db/
│   │   ├── base.py               # SQLAlchemy engine/session
│   │   └── models.py             # events, connections, dead_letters, idempotency…
│   │
│   ├── workers/
│   │   ├── celery_app.py         # Celery config: retries, backoff, beat schedule
│   │   ├── forward.py            # transform + POST to App B  (with retry/DLQ)
│   │   ├── news.py               # daily news aggregation task
│   │   └── newsletter.py         # LLM strategy + render + email send
│   │
│   ├── connectors/               # generic App A/App B adapters (config-driven)
│   │   ├── base.py               # fetch/post + mapping primitives
│   │   └── registry.py
│   │
│   ├── integrity/
│   │   ├── idempotency.py        # dedupe keys + upsert helpers
│   │   ├── retry.py              # backoff policy
│   │   └── dlq.py                # dead-letter move + alert
│   │
│   ├── ai/
│   │   ├── prompts/              # strategist system prompts (versioned text)
│   │   └── strategy.py           # feed news + internal metrics → LLM
│   │
│   ├── delivery/
│   │   ├── render.py             # HTML email template
│   │   └── email.py              # Resend/SendGrid client
│   │
│   └── audit/
│       └── log.py                # append-only event/audit writes
│
├── engine/                       # the EXISTING monitor-engine, as a library
│   └── monitor_engine/           # collectors, scorer, Signal Mesh, targets…
│
└── tests/
    ├── test_webhook_receiver.py  # signature, validation, dedupe, 200 fast-path
    ├── test_forward_worker.py    # retry/backoff, DLQ after N, idempotent upsert
    ├── test_news_pipeline.py
    └── test_newsletter.py
```

---

## 4. Data model (tables — the "log of record")

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `connections` | one row per integration endpoint (App A or B) | id, name, direction, **encrypted credentials**, signing_secret, mapping_id |
| `events` | **every raw inbound payload** (audit) | id, connection_id, **raw JSONB**, idempotency_key, status (received/processing/done/failed/dead), attempts, received_at |
| `idempotency_keys` | dedupe on ingest | key UNIQUE, event_id, created_at |
| `outbound_log` | each forward attempt to App B | id, event_id, request, **response**, http_status, attempt_no, at |
| `dead_letters` | poison jobs isolated after N attempts | id, event_id, last_error, moved_at, replayed_at |
| `mappings` | App A field → App B field transforms | id, spec (JSONB) |
| `metrics_snapshots` | client **internal** business metrics (synced by Engine #1) | id, client_id, metric, value, as_of |
| `news_items` | aggregated daily news | id, title, url, summary, entities (JSONB), fetched_at |
| `newsletters` | rendered editions (audit + resend) | id, client_id, html, sent_at, status |
| `subscribers` | recipients | id, client_id, email, active |

Unique constraints do the heavy lifting for "no duplicates":
`events.idempotency_key UNIQUE`, and `(connection_id, external_id)` UNIQUE on
the outbound side → upsert semantics.

---

## 5. Reliability & security checklist (maps 1:1 to the prompt)

- [ ] **Async, decoupled:** receiver persists + enqueues + 200; workers do A→B.
- [ ] **Exponential backoff:** Celery `autoretry_for=(429,503,timeout)`,
      `retry_backoff=True`, `retry_backoff_max`, `max_retries=5`.
- [ ] **Dead Letter Queue:** after 5 attempts → `dead_letters` table + alert;
      admin endpoint to inspect/replay.
- [ ] **Schema validation:** Pydantic on the envelope *and* per-connector body,
      before anything is processed (422 on failure).
- [ ] **Webhook signatures:** HMAC-SHA256 of the raw body vs `X-Signature`,
      constant-time compare; reject before parsing.
- [ ] **No hardcoded keys:** all via env; third-party creds Fernet-encrypted
      at rest.
- [ ] **Audit log:** raw payload + status + outbound response retained per event.
- [ ] **Idempotency:** ingest key + outbound unique constraint → no dupes, no loss.
- [ ] **Least privilege + PII:** scoped DB roles; minimize/segregate any PII in
      payloads; retention policy on `events`.

---

## 6. Development roadmap (phased, actionable)

Each phase is independently shippable and testable. Code is written at build
time, not here.

- **Phase 0 — Scaffolding.** Monorepo, `docker-compose` (postgres+redis),
  settings, Alembic baseline, CI running tests. *Done when:* `compose up` boots
  api+worker+beat+db+redis and the test suite runs in CI.
- **Phase 1 — Webhook receiver (the prompt's Phase 1).** Signature verify →
  Pydantic validate → dedupe → store raw `events` → enqueue → 200. *Done when:*
  a signed payload is persisted and acked in <100 ms with no downstream call.
- **Phase 2 — Forward worker + resilience.** Transform + POST to App B; backoff
  retries; DLQ after 5; outbound audit log; idempotent upsert. *Done when:* a
  flaky App B (simulated 429/503) eventually succeeds or lands in the DLQ, never
  duplicating.
- **Phase 3 — First real connectors.** Wire the client's actual App A and App B
  (auth, mapping config). *Done when:* a real record flows end-to-end.
- **Phase 4 — Internal-data sync.** Land the client's business metrics into
  `metrics_snapshots` (via Engine #1 connectors). *Done when:* current metrics
  are queryable.
- **Phase 5 — News + strategy.** Daily aggregation (reuse engine collectors) +
  LLM strategist joining news ↔ internal metrics. *Done when:* a draft
  newsletter is generated for a client and stored.
- **Phase 6 — Delivery + schedule.** HTML render → Resend/SendGrid; Celery beat
  daily cron; subscriber management. *Done when:* the newsletter lands in an
  inbox on schedule.
- **Phase 7 — Observability + admin.** Structured logs, Sentry, DLQ alerting,
  a minimal internal admin (inspect/replay events). *Done when:* a poison job
  pages you and is replayable in one click.
- **Phase 8 — Harden + deploy.** Load test the receiver, retention/PII policy,
  secrets in prod manager, deploy to Render/Fly. *Done when:* it survives a
  burst and a worker restart with zero loss/dupes.

Suggested order of value: **0 → 1 → 2 → 3** (reliable integration first; it's
the part not yet built), then **4 → 5 → 6** (light up the newsletter on top of
the existing engine), then **7 → 8** (operate it).

---

## 7. How the existing engine is reused (not rewritten)

- `monitor_engine.collectors` → the **news aggregation** worker.
- `monitor_engine.analysis` (scorer, prompts) + Signal Mesh → the **LLM
  strategy** stage; the system prompt gains the client's **live** metrics from
  `metrics_snapshots` instead of a static profile.
- `monitor_engine.enrichment.connector` → the basis for the generic **App A/App
  B connectors** (same `{query}`/field-map idea, extended to POST/forward).
- `monitor_engine.targets` (account-map data) → JSON input for the cockpit's
  internal map/prospecting views.
- The React cockpit is the **internal dashboard**; email is the external
  channel.

---

## 8. Open decisions (need client input before Phase 3)

1. **Which tools are App A and App B?** (CRM, ERP, ticketing, accounting…) —
   determines connector specifics, auth model, and webhook availability.
2. **Auth models** for each tool (API key, OAuth2, HMAC webhooks?).
3. **Which internal metrics** drive the newsletter's "impact" linkage?
4. **Volume** (events/day) — sizes Redis/Postgres and worker concurrency.
5. **Email provider** + sender domain (DNS/DKIM setup).
6. **Hosting budget** — Render/Fly tier; managed Postgres/Redis sizing.
7. **Data residency / PII** constraints in stored payloads.

---

### Next step
On approval of this paper design, the natural first build is **Phase 0 + Phase 1**
(scaffold + webhook receiver with signature verification, schema validation,
raw-store, enqueue, 200 fast-path) — the prompt's requested Phase-1 boilerplate.
No code or services will be created until you say go.
```
