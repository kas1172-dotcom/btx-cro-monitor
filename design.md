# BTX Revenue Brain — Design System (Steel & Signal / Cockpit)

Status: locked. This file is the single source of truth for color, type, and the
signature visual devices used across the cockpit app (`frontend/src/ui/`). It does
not govern the exported deliverable documents (decks/PDFs/PPTX) — those use a
separate, deliberately different light-mode print palette defined in
`frontend/src/deliverables/designTokens.ts` (the "Steel & Signal" document theme),
because a document sent to a client is a different artifact with different
constraints than the in-app cockpit. Do not merge the two.

Genre: atmospheric, dark, modern-minimal. Not editorial, not a generic SaaS
dashboard. The cockpit is a working instrument a CRO lives in between calls — every
surface should read as instrumentation, not a brochure.

## Rule zero

All new UI under `frontend/src/ui/` imports colors from `frontend/src/app/uiTokens.ts`
(or the CSS variables it mirrors in `frontend/src/ui/styles.css`'s `:root` block).
No component defines its own color literal — ever, including inline `style={{}}`.
See "Enforcement" below for how this is checked.

## Tokens

Source of truth: `frontend/src/app/uiTokens.ts`. Mirrored as CSS custom properties
in `frontend/src/ui/styles.css`'s top `:root` block (lines 1–17).

| Token | Hex | Use |
|---|---|---|
| `page` | `#0C1621` | App background |
| `rail` | `#0A131E` | Left nav rail background |
| `panel` | `#101E2C` | Secondary surface background |
| `card` | `#13212F` | Card / panel background |
| `cardBorder` | `#22384B` | Card border |
| `hairline` | `#1B2C3C` | Dividers, subtle separators |
| `accent` (teal) | `#2FB6A8` | Primary accent — links, active states, verified provenance |
| `accentText` | `#7FE3D6` | Accent text on dark backgrounds |
| `accentTint` | `#123430` | Accent-tinted backgrounds (badges, icon circles) |
| `textPrimary` | `#E9EFF4` | Primary text |
| `textSecondary` | `#8DA1B4` | Secondary text |
| `textMuted` | `#5F7488` | Muted / tertiary text |
| `success` (green) | `#54B37E` | Positive signal, growing accounts |
| `warning` (amber) | `#E0A93B` | Caution, unlinked/low-confidence, at-risk |
| `danger` (red) | `#D96A57` | Risk, churned, failure states |
| `info` (steel) | `#4C86C4` | Neutral informational accent |

Font: Inter only. Weights 400 (regular) and 600 (semibold) only — never 300, 500,
700, or 800 anywhere in the cockpit UI.

Radii: `sm` 6px, `md` 8px, `lg` 12px (`uiTokens.radius`).

## Signature devices

These are the visual grammar that must run consistently everywhere the underlying
data condition occurs — not just on one surface.

### 1. Provenance as visual grammar

Two existing, distinct systems, both required, serving different questions:

- **Categorical source** (`ProvenanceBadge`, `frontend/src/ui/common/ProvenanceBadge.tsx`) —
  answers "where did this come from": CRM (green), Monitor (teal), Demo (amber).
  Unchanged by this pass.
- **Confidence gradient** (`ConfidenceEdge`, `frontend/src/ui/common/ConfidenceEdge.tsx`,
  new) — answers "how sure are we this claim is linked to the right account":
  a verified, relationship-backed account link renders **solid, full-opacity, teal**;
  an unlinked or low-confidence claim renders **dashed, reduced-opacity, muted**.
  Confidence maps continuously to border style + opacity, not just a binary switch:
  - `confidence >= 0.85` → solid border, 1px, full opacity, `accent` color.
  - `0.72 <= confidence < 0.85` → solid border, 1px, 70% opacity, `accent` color.
  - `confidence < 0.72` or unlinked/`scope !== "specific_account"` → dashed border,
    1px, `textMuted` color, 55% opacity.

  This runs everywhere an account-linked claim appears: `SignalCard`, `Account360`'s
  relationship-backed signal list, the map's account tokens, Programs, Capacity.

### 2. Scope pills

`ScopePill` (`frontend/src/ui/primitives.tsx`) — already built, color-coded:
portfolio/market/program → teal tint; specific_account/customer/supplier → green
tint; unlinked/competitor → amber tint. Every signal-bearing surface must render
one wherever a signal or claim is shown, not only where `SignalCard` already does.

### 3. Account status rings

`AccountToken` (`frontend/src/ui/common/AccountToken.tsx`, new) — a small circular
token (initials or icon) with a colored ring indicating account health, derived
from the existing `CompanyScore.dimensions.risk.score`:

- `risk.score < 33` → **growing**, `success` green ring.
- `33 <= risk.score < 66` → **at-risk**, `warning` amber ring.
- `risk.score >= 66` → **churned/critical**, `danger` red ring.

Used in Account 360's account list and the Map's account markers/legend.

### 4. Designed empty states

`EmptyState` (`frontend/src/ui/primitives.tsx`) — icon in an accent-tint circle,
headline, one line of body copy. Never bare text ("No data"). Required on every
surface that can reach a genuinely empty condition.

## Enforcement

- All colors: `uiTokens.ts` (TS call sites) or the `:root` CSS variables it mirrors
  (CSS files). No other file may declare a hex color under `frontend/src/ui/`.
- Guard: `frontend/tools/check-design-tokens.ts` (run via `npm run check:design`)
  fails the build if a raw hex literal (`#[0-9a-fA-F]{3,8}`) appears in any
  `.ts`/`.tsx` file under `frontend/src/ui/` outside `uiTokens.ts` itself, or in
  `frontend/src/ui/styles.css` outside its top `:root` token block. See
  `design/DESIGN_AUDIT.md` for the grep this script encodes and its exact output.
- `npm run check:design` is part of the required verification suite alongside
  `npm run typecheck` and `npm run build`.

## Known, deliberate exception

`frontend/src/deliverables/steelSignalTemplates.tsx` and its CSS block in
`frontend/src/ui/styles.css` (the `--ss-*` prefixed variables, isolated to a single
clearly-labeled block) implement the separate light-mode "Steel & Signal" document
export theme (decks, PDFs, PPTX, the retention/earnings heat map export). This is
intentionally a different visual system for a different artifact class and is
excluded from the raw-hex guard and from the "every surface" retrofit requirement
in this pass. Do not consolidate the two without a separate, deliberate decision —
see the follow-up already flagged in `docs/IA_RESTRUCTURE_PLAN.html`'s Analysis
section.
