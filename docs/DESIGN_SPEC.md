# BTX Design Spec: Steel and Signal

Status: law. This file is the single source of truth for color, type, spacing, and
hierarchy across the product. The linters in Section 5 and the CI checks in Section 7
enforce it. If a rule here and the code disagree, the code is wrong.

Steel and Signal is one brand with two themes. Do not collapse them. The cockpit is a
dark working instrument. The deliverables are light print documents a customer receives.
They share a brand core (accent, font, semantic status colors); they do not share
surfaces or text colors.

## 1. Brand core (identical in both themes)

One canonical module owns these values. Both themes import them. They are never
redefined per theme.

- Accent teal: `#2FB6A8`
- Font: Inter, weights 400 (regular) and 600 (semibold). No system font fallback as a
  design choice; the fallback stack exists only for load failure.
- Status green: `#54B37E`
- Status amber: `#E0A93B`
- Status red: `#D6533C`
- Steel blue: `#4C86C4`

## 2. Theme A: Cockpit (dark)

The in-app surfaces under `frontend/src/ui/`.

| Role | Token | Value |
|---|---|---|
| Page | page | `#0C1621` |
| Rail | rail | `#0A131E` |
| Panel | panel | `#101E2C` |
| Card | card | `#13212F` |
| Card border | cardBorder | `#22384B` |
| Hairline | hairline | `#1B2C3C` |
| Accent text | accentText | `#7FE3D6` |
| Accent tint | accentTint | `#123430` |
| Text primary | textPrimary | `#E9EFF4` |
| Text secondary | textSecondary | `#8DA1B4` |
| Text muted | textMuted | `#5F7488` |

Base is dark cool grey, never pure black. Depth is signaled by stepping surface
lightness (page, rail, panel, card), not by drop shadows.

## 3. Theme B: Document (light print)

The rendered deliverables under `frontend/src/deliverables/` and the generators in
`design/reference/`. A client document is white paper with a navy header, not a dark
screen.

| Role | Token | Value |
|---|---|---|
| Page background | bg | `#F6F8FB` |
| Sheet | white | `#FFFFFF` |
| Panel | panel | `#EAEFF5` |
| Header / ink | ink, navy | `#12263A` |
| Muted text | muted | `#6B7787` |
| Ice | ice | `#AEC3D6` |
| Line | line | `#D8E0EA` |
| Tint | tint | `#E7F4F2` |

## 4. Type scale

Inter only. Two weights: 400 and 600.

Cockpit: hero heading 28 to 32px/600, section heading 18px/600, body 14px/400, label
12px/600 uppercase tracked, caption 12px/400. Line height 1.35 to 1.5.

Document: h1 34pt, section 17pt, body 12.5pt, caption 10pt, eyebrow 10.5pt. Slide: title
30, section 17, body 12.5, caption 9.5, stat 40.

Headings do not exceed the sizes above. A count or a label is never the largest element
on a screen; content leads.

## 5. Spacing, radius, border

- Spacing scale: 4, 8, 12, 16, 24, 32, 48. Use scale steps, not arbitrary pixels.
- Radius: sm 6px, md 8px, lg 12px. Cards use md.
- Borders: cockpit cards use a 1px hairline or cardBorder, or elevation. Prefer elevation
  over borders. No dashed borders as a default card treatment.

## 6. Hierarchy rules

- Heading: one per surface, restrained size, 600 weight.
- Card: one clear focal line (title), supporting text muted, one primary action.
- Label: 12px, 600, uppercase, tracked, textMuted or muted.
- Status pill: filled tint of a status color, short word, paired with an icon or dot so
  it reads without color alone.
- One primary action per view or card. Secondary actions are outline or text, never a
  second filled accent button competing with the primary.
- Scanning views stay compact. Full reasoning lives one click away, never forced inline.

## 7. AI-slop to never ship

These fail review on sight, in cockpit and in documents:

- Gradients used as decoration.
- Stacked soft drop shadows for depth. Dark depth is surface lightness, not shadow.
- Emoji used as icons or status markers.
- Centered-everything layouts. Content is left-aligned and gridded.
- System font as a design choice.
- Walls of evenly weighted cards with nothing emphasized.
- Off-system color: any hex not defined in the token source.
- Full paragraphs rendered inline in a list or feed row.

## 8. Enforcement

Three checks guard this spec. All run in CI (Section 7) and block merge on violation.

- `npm run check:design`: no raw off-system hex anywhere under `frontend/src/ui/`,
  `frontend/src/deliverables/`, or the `design/reference/` generators. The only place a
  color literal may live is the canonical token source.
- `npm run check:voice`: no banned word, banned opener, or em dash in user-visible
  strings, deliverable templates, or LLM system prompts. See docs/VOICE_SPEC.md.
- Visual regression: rendered surfaces and deliverables diff against the approved
  baselines. Meaningful drift fails.

### Updating a visual baseline

A baseline changes only on a deliberate, reviewed design change. To update: make the
change, regenerate the baseline with the snapshot tool, review the new image by eye
against this spec, and commit the new baseline in the same change that alters the design.
Never regenerate a baseline to make a red check go green without looking at it.
