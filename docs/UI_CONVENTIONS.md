# Revenue Cockpit UI conventions

These conventions apply to every cockpit route, embedded panel, overlay, and exported deliverable. Prefer shared tokens and primitives over view-specific values.

## Product language

- Product: **BTX Revenue Cockpit** (short form: **Revenue Cockpit**).
- Intelligence and assistant layer: **Enterprise Brain** (branded form: **BTX Enterprise Brain**).
- Use sentence case for actions and labels. Actions should state the outcome, such as “Create work item” or “Open briefing”; avoid “Submit,” “OK,” and “Click here.”
- User-visible errors explain recovery and never expose endpoints, response payloads, stack details, or provider configuration names.

## Type scale

Use the semantic CSS tokens defined in `frontend/src/ui/styles.css`:

| Token | Size | Use |
|---|---:|---|
| `--type-caption` | 11px | Metadata, table labels, provenance |
| `--type-body` | 14px | Default controls and body copy |
| `--type-title` | 20px | Section and card titles |

Larger display headings may use an existing responsive `clamp()`. Avoid adding one-off sizes when a semantic token fits. Body copy must wrap, use a readable line height, and never be clipped to hide meaning.

## Spacing scale

Use `--space-1` through `--space-5`: 4, 8, 12, 16, and 24px. Component-internal gaps normally use 4–12px; card padding uses 12–24px. New arbitrary spacing values require a layout constraint that cannot be represented by this scale.

## Color and focus

- Use the semantic surface, text, border, status, and accent tokens. Do not add literal colors in view CSS.
- Body text must meet 4.5:1 contrast; large text and essential graphical controls must meet 3:1.
- Every interactive element uses the shared accent focus ring. Never remove `outline` without an equally visible replacement.

## Components and responsive behavior

- All touch controls are at least `--touch-target` (44px) in both interactive dimensions on mobile and touch-oriented tablet layouts.
- Use the shared button/input/card treatment before introducing a route-specific variant.
- Use full `WorkItemList` only where a local, keyboard-focusable horizontal scrolling region is appropriate. Pass `compact` in cards, drawers, Account 360, Ask context, or other constrained containers.
- Tables must either scroll within a labeled, focusable region or switch to labeled stacked rows. The application shell must never be the scrolling mechanism for an oversized table.
- Overlays retain at least 8px viewport inset at 375px and must account for the mobile navigation safe area.
- Ellipsis is reserved for content whose complete value is available in the same interaction or through an accessible name. Explanatory and decision-making copy wraps.

## States

Every data surface provides loading, empty, error, and unavailable-data states. Use the shared `EmptyState` presentation and `userFacingError()` for caught service errors. Disabled controls remain readable and explain prerequisites in adjacent copy when the reason is not obvious.
