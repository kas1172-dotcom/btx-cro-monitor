# WP9 — Deliverable Templates: Design Spec & Codex Build Prompt

This is the spec that turns the six locked reference designs into the app's live
deliverable pipeline. It defines the shared visual system ("Steel & Signal"), the
two non-negotiable rules (provenance on every claim; the figure convention), the
per-template mapping to existing code, and the acceptance tests. Hand the whole
document to Codex along with the House Rules from `CODEX_EXECUTION_PLAYBOOK.md`.

Depends on: WP6 (deliverables render inside the new surfaces) and WP3 (provenance
blocks cite real relationship records). Do WP9 after those land.

---

## 1. Reference ground truth (commit these first)

Six approved reference artifacts and their generators are the visual source of
truth. Their generator code specifies exact colors, coordinates, type sizes, and
spacing — port that, don't reinvent it. Put them in the repo at `design/reference/`:

| Deliverable | Reference render | Generator (exact spec) |
|---|---|---|
| Board deck (quarterly) | `BTX_Board_Deck_Template.pptx` | `build_deck.js` (pptxgenjs) |
| Sales pitch (3 slides) | `BTX_Sales_Pitch.pptx` | `build_pitch.js` (pptxgenjs) |
| Capabilities assessment (1-pager) | `BTX_Capabilities_Assessment.pdf` | `build_caps.py` (SVG) |
| Outreach draft (email) | `BTX_Outreach_Draft.pdf` | `build_outreach.py` (SVG) |
| Monthly newsletter | `BTX_Monthly_Newsletter.pdf` | `build_newsletter.py` (SVG) |
| Retention/earnings heat map | `BTX_Retention_Earnings_Heatmap.png` | `build_heatmap.py` (matplotlib) |

The generators are reference implementations, not production code. Codex ports the
*design* (tokens + layout logic) into the app's own rendering stack (Section 5).
The visual output must match these references.

---

## 2. Shared visual system — "Steel & Signal" (single source of truth)

Create one design-tokens module in the frontend (e.g.
`frontend/src/deliverables/designTokens.ts`) that every template imports. No
template may hardcode a color, font, or size that isn't in this module.

### Color tokens (hex)
```
navy   12263A   (dominant; cover/close backgrounds, dark cards, headings on light)
teal   2FB6A8   (single accent/motif; section-marker circles, primary data series)
steel  3E7CB1   (secondary data series)
ink    12263A   (body text on light)
muted  6B7787   (secondary text, captions, axis labels)
bg     F6F8FB   (light content background)
panel  EAEFF5   (subtle card tint, alternating table rows)
white  FFFFFF   (cards)
ice    AEC3D6   (text on navy)
line   D8E0EA   (hairline borders, table rules)
tint   E7F4F2   (provenance card fill)   border BFE3DD   ink 1E8C7E
signal: green 3FA66A · amber E0A93B · red D6533C   (status/tier only)
```
Dominance rule: navy + teal carry the identity; steel/panel support; signal colors
are reserved for status (retention, risk, scope tiers) and nothing decorative.

### Typography
- **Production brand font: Inter** (locked). Open-source (OFL), free to embed in PDF and
  pptx, high legibility at small sizes. Font stack token: `"Inter", "Segoe UI", Arial,
  sans-serif`. Optional display alternative if more engineered character is wanted later:
  IBM Plex Sans. Wire the font as a single token; do not scatter font names.
- One family for headings and body, weights 400 and 700 only. (The committed reference
  renders used an Arial/Calibri-class fallback because Inter was not installed in the
  render environment; production output must ship Inter and match the reference layout.)
- Scale (slides, pt): slide title 30 bold · section header 16–18 bold · body 12–13 ·
  caption 9–10 · eyebrow 11 bold + letter-spacing · stat callout 40 bold.
- Scale (documents, px at 816-wide page): H1 34 · section 17 · body 12.5 · caption 10 ·
  eyebrow 10–11 bold letter-spaced.

### Layout + motif
- Motif = a filled **teal circle** for section markers and step/story numbers. Carry
  it across every template. Cards = white fill, `line` border, soft shadow, 8px radius.
- Sandwich: dark (navy) cover and closing surfaces; light content in between.
- **Forbidden (reads as AI filler):** accent stripes, color bars, edge borders on one
  side of a card, underlines beneath titles. Set sections apart with whitespace, a
  subtle `panel`/`tint` fill, or the teal-circle motif only.
- Footer on every content page: "BTX …  ·  Confidential  ·  Illustrative sample" +
  page number, in `muted`.

### Voice
- **No em dashes** anywhere in generated copy. Use commas, colons, semicolons, or the
  middot separator. Enforce this in the composition layer (add to banned-vocabulary /
  post-process). Ranges use "to", not an en dash.

---

## 3. Two global rules (enforced in code, tested)

### Rule A — Provenance on every factual claim
Every account-linked claim, figure, and recommended action renders a **provenance
card**: `tint` fill, `BFE3DD` border, "SOURCE" eyebrow in `1E8C7E`, then the source
entity (bold), the match method, and the confidence, pulled from the WP3 relationship
record — not free text. Build one shared `<ProvenanceCard>` (and a pptx equivalent)
and reuse it. A claim that resolves to an `unlinked`/low-confidence signal must render
as market/portfolio scope, never as account-specific evidence. A deliverable that
would cite an unsourced account figure fails validation and does not export.

### Rule B — Figure convention (research-paper style)
Every chart/figure carries, in this order:
1. **Figure number + descriptive title** ("Figure 1.  Bookings and backlog by fiscal quarter").
2. **Fully labeled axes with units** (and a labeled legend/colorbar where used).
3. **A caption** defining what the figure encodes and its data source.
4. **A one-line summary** ("Summary: …") stating the finding and, where relevant, the action.

Implement this as a single figure wrapper so no chart can be emitted without it.
Tables are labeled with a header and note but do not require a Figure number.

---

## 4. The six templates → pipeline mapping

Each maps to an existing agent in `frontend/src/agents/`. Keep composition
deterministic for facts/numbers (existing `rubrics.ts`, `promptContract.ts`,
grounding checks); LLM prose only for non-factual framing.

1. **Board deck** (`boardDeckAgent.ts` → `deliverables/deck/pptx.ts`). 9-slide structure
   per reference: cover, exec summary (4 stat callouts + "what changed"), revenue chart
   (Fig), account-in-focus (provenance), tiered signals (scope pills), capacity chart
   (Fig), risks, actions table, close. Charts follow Rule B; account slide follows Rule A.
2. **Sales pitch** (`salesPitchAgent.ts`). 3 slides: value-prop cover, two projections
   side by side (Fig 1 internal revenue to BTX, Fig 2 external value to client), the ask.
3. **Capabilities assessment** (`capabilitiesAssessmentAgent.ts`). Single designed page
   (HTML/CSS → PDF): capability tiles, certifications, **current production capacity**
   table with available-capacity flagged by status color, materials/track-record,
   provenance footer. Client-facing: **must not** contain other-client earnings/retention.
4. **Outreach draft** (`outreachAgent.ts`). Email layout: To/From/Subject, body, signature,
   "Why now / Evidence" provenance box, "draft, review before sending" note. On approval
   this is the artifact the WP8 HubSpot-task action attaches.
5. **Monthly newsletter** (new `newsletterAgent.ts`, or extend `weeklyMemoAgent.ts`).
   Masthead + three stories, each in **Tell me / Show me / So what**. Internal; monthly
   cadence default (make cadence a config value).
6. **Retention/earnings heat map** (chart component, not a document). Accounts × periods,
   color = revenue, status column = retention. Lives in the **Analysis dashboard** and is
   embeddable in the board deck. **Internal only** — never in a client-facing deliverable.
   Follows Rule B.

---

## 5. Rendering-tech translation

The references were rendered with standalone tools; map each to the app's real stack:

- **Decks (board, pitch):** `pptxgenjs` through `deliverables/deck/pptx.ts`. Port the
  reference `.js` generators' layout logic directly; they already use pptxgenjs.
- **Documents (capabilities, outreach, newsletter):** the reference SVGs define exact
  layout; reimplement as **HTML/React + CSS** using the design tokens, export to PDF via
  the app's existing print/export path (`export.ts` / `printDeliverable`). Keep them
  print-accurate at US-Letter.
- **Figures:** one shared chart component that applies Rule B, built on the existing
  `metrics/chartSpec.ts` catalog. The heat map is a dedicated reusable component.
- Lazy-load pptx/pdf/heavy chart libs (ties to the P2 bundle-size work) so opening a
  deliverable doesn't pull every export library.

---

## 6. Codex build prompt (paste after the House Rules)

```
# Task: WP9 — implement the deliverable-template system (Steel & Signal)

Reference designs are committed under design/reference/ (six renders + their
generator scripts). They are the visual source of truth; match them. The generator
code specifies exact colors, coordinates, and type sizes — port the design, do not
invent new styling.

1. Create frontend/src/deliverables/designTokens.ts as the SINGLE source of truth for
   the Steel & Signal system (colors, typography scale, spacing, motif, footer). No
   template may hardcode a token. Values are in the WP9 spec, Section 2.

2. Build shared primitives, each with unit tests:
   - <ProvenanceCard> (+ pptx equivalent): renders source entity, match method, and
     confidence from a WP3 relationship record. Enforce Rule A (spec Section 3).
   - <Figure> wrapper (+ pptx equivalent): stamps figure number, labeled axes/units,
     caption, and one-line summary on every chart. Enforce Rule B. No chart may be
     emitted without it.
   - Scope/status pills, stat callouts, capacity table, tell/show/so-what block.

3. Implement the six templates mapped to their agents (spec Section 4), matching the
   references. Decks via pptxgenjs (deliverables/deck/pptx.ts); documents as HTML/React
   + CSS exported to PDF; the heat map as a reusable Analysis-dashboard component.

4. Enforce the two hard invariants:
   - Every account-linked claim/figure/action carries a provenance card sourced from a
     relationship record. An unlinked/low-confidence signal renders as market scope,
     never as account evidence. A deliverable citing an unsourced account figure fails
     validation and does NOT export.
   - No em dashes in any generated copy (add to the banned set / post-process).

5. Keep the client-facing capabilities assessment free of any other-client
   earnings/retention data. The retention/earnings heat map is internal only.

6. Tests (required):
   - Snapshot/visual parity of each template against its reference.
   - A deliverable with an unsourced account claim fails validation (does not export).
   - A market-scope signal never renders as account evidence.
   - Every chart renders figure number + axis labels + caption + summary.
   - Exports open cleanly: run the pptx validator on generated decks; PDFs render.
   - No em dash appears in any generated deliverable text.

Deliverable: branch feat/deliverable-templates, tokens + primitives + six templates +
tests, green suite, PR attaching one generated sample of each deliverable.
```

---

## 7. Acceptance checklist (you verify before merge)

- Generated board deck and pitch visually match the reference `.pptx` and pass the
  pptx validator.
- Capabilities, outreach, and newsletter PDFs match their references at US-Letter.
- Every figure shows: Figure N, labeled axes with units, caption, and a Summary line.
- Every account claim shows a provenance card tied to a real relationship record; an
  unlinked signal is shown as market scope.
- The capabilities assessment contains no other-client earnings; the heat map appears
  only in internal surfaces.
- No em dash anywhere in generated output.

---

## 8. Brand basics (locked) + remaining manual steps

**Font (locked): Inter.** Codex adds the Inter font files to the app and embeds them in
PDF/pptx exports. Token: `fontFamily = '"Inter", "Segoe UI", Arial, sans-serif'`. Headings
and body share Inter; weights 400 and 700 only.

**Logo (interim, locked): the BTX monogram.** A filled teal (`2FB6A8`) circle with "BTX"
in navy (`12263A`), as used on every reference. This is the interim mark. Codex builds it
as a single `<BrandMark>` component sized by a prop, so a real logo file can replace it in
one place later.

**Color + layout:** fully specified in Section 2; nothing outstanding.

Remaining manual steps:
- **🧑 Real logo (optional, later).** If BTX commissions a logo, drop the asset in and point
  `<BrandMark>` at it. No other change needed.
- **🧑 Real numbers.** References use illustrative data. When real CRM/ERP figures flow (post
  WP3/WP6), drop the "illustrative sample" footer via a config flag.
- **🎨 Claude can** produce extra templates (e.g., an internal weekly digest variant), refine
  a reference before Codex ports it, or re-render the reference set in Inter for exact parity.
```
