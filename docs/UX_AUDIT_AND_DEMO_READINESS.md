# UX Audit And Demo Readiness

## Executive Summary

The cockpit has the right backend foundation: authenticated backend state, canonical accounts, score snapshots, work-item lifecycle, notes, audit history, and verified HubSpot task execution. The remaining risk is experience clarity. A CRO can reach the needed records, but the product still exposes too much implementation language, spreads decision context across surfaces, and lacks a compact global command layer.

Latest implementation pass adds the missing inspection and presentation layer: one shared Evidence Drawer, meaningful account/work timelines, URL-backed Focus mode, URL-backed Briefing mode, Ask citation inspection, and a polished Executive Account and Meeting Brief.

The demo should lead with:

1. What changed
2. Why it matters
3. What Jamie can control next
4. Evidence and verification one action away

## Major Usability Issues

- Today currently reads like a compact activity brief rather than a command cockpit. It needs a ranked priority stack and clearer attention groups.
- Account 360 shows useful scores and work, but the answer to "why this account matters" is below technical score blocks.
- Work Queue has backend lifecycle controls, but list rows still expose internal status labels more strongly than business meaning.
- Evidence is available in signal cards and score details, but not through a consistent "View evidence" pattern.
- The topbar shows status chips, but it does not yet provide global command/search or contextual action routing.
- Secondary routes are visible, but mobile still needs a deliberate "More" pattern instead of trying to preserve the full desktop rail.
- Ask is still implemented through multiple internal names and modules. The user-visible identity should be one assistant.

## Major Visual Issues

- The visual language is consistent enough to build on, but it still feels closer to a dense internal dashboard than an executive revenue command surface.
- Many sections use similar card weight, which makes priority and supporting detail feel equal.
- Score cards use backend family names or score jargon in some places. These need plain-language labels.
- Some status chips compete for attention in the topbar even when they are informational.
- Several panels rely on repeated cards instead of stronger section hierarchy.

## Duplicate Or Obsolete Surfaces

- HubSpot should remain under Integrations and contextual work-item execution, not a primary navigation destination.
- Legacy assistant identities should be hidden from user-facing copy: Brain, Jarvis, Copilot, and Chatpil.
- Demo-only fixture labels should remain test/seed scaffolding and must not imply live execution.

## Misleading Labels And Dead Ends

- Avoid "live" unless a source is behaviorally available.
- Avoid "capacity fit" when the product only has capability alignment and no ERP/MES capacity connection.
- Avoid "complete" for external actions before verification.
- Avoid "PWIN" on executive surfaces; use "Likelihood to win" with methodology details behind disclosure.
- Remove or disable inert Review controls on the primary demo path.

## Surface Findings

### Today

- Purpose is understandable, but the hierarchy should change from mini-brief list to ranked priorities.
- Attention counts should link to exact Work Queue filters.
- Confirmed account, program, and market developments should be separated.
- Completed/verified work should appear to demonstrate system response.
- Implemented: ranked priority cards and development columns now expose "View evidence" without leaving Today.

### Work Queue

- Backend lifecycle is strong and should not be rewritten.
- Default view should prioritize actionable work: assigned to me, awaiting approval, overdue, failed execution, due soon, and unassigned high priority.
- List rows should stay simple. Evidence, notes, audit history, and execution detail belong on detail.
- Detail needs a business-first hierarchy before audit/state-machine detail.
- Implemented: Work detail now has Focus mode, shared evidence, and a meaningful timeline before the raw audit history.

### Account 360

- Needs a decision strip above score details.
- Score names need executive labels:
  - Strategic attractiveness
  - Evidence strength
  - Likelihood to win
  - Ability to deliver
  - Relationship strength
- Missing scores must be "More information needed" or "Not connected," never zero.
- Current work should use the same backend work-item records as Work Queue.
- Implemented: Account 360 now has score evidence buttons, account evidence, meaningful timeline, Focus mode, and Briefing mode.

### Ask

- Keep one user-facing assistant identity.
- Answers must cite internal records and distinguish confirmed, inferred, missing, simulated, and unavailable data.
- Persistent conversation support is still a separate backend milestone.
- Implemented: Ask citations now open the shared Evidence Drawer, and contextual Ask actions cover evidence, changes, missing information, talking points, and executive brief drafting.

### Deliverables

- Existing deliverable tooling works, but the primary demo needs one polished executive account and meeting brief template with sources, missing information, data freshness, and classification.
- Implemented: the meeting brief is now "Executive Account and Meeting Brief" with cover, executive summary, account context, recent developments, decision summary, meeting prep, current work, and sources/data notes. Deliverable view supports Focus and Briefing modes.

### Integrations And Source Health

- Source health should be concise and relevant.
- Configured credentials are not the same as behaviorally verified availability.

## Shared Contract Requirements

Backend remains authoritative for:

- Account and program identity
- Signal relationships
- Score snapshots and missing inputs
- Work-item lifecycle and allowed actions
- Audit history and notes
- Integration status and source freshness
- External execution and verification
- User role and permissions

Frontend presentation helpers should own only labels, grouping, severity, and view-model shaping.

## Demo Readiness Priorities

1. Add shared presentation contracts.
2. Add global command/search and context ribbon.
3. Rebuild Today around three priorities and attention groups.
4. Add Account 360 decision strip and friendly score labels.
5. Polish Work Queue list/detail hierarchy without changing lifecycle.
6. Add deterministic demo reset and runbook.
7. Consolidate assistant identity and persistent conversations.
8. Add briefing/focus modes and executive brief.

## Current Evidence And Timeline Audit

- Evidence was previously fragmented across signal cards, score details, deliverable sources, and Ask citations. The new shared Evidence Drawer normalizes summary, supporting records, relationship status, score contribution, uncertainty, and advanced details.
- Citations previously navigated away from Ask. Ask citations now inspect evidence in place and still provide an explicit "Open record" route.
- Program signals previously showed source text but not the shared evidence pattern. Expanded program signals now use the drawer.
- Score explanations previously showed technical factor detail before an executive-friendly evidence action. Score KPIs and details now expose "View evidence."
- Work item audit history remains available, but meaningful business events now appear first.
- Focus mode hides secondary panes and navigation density on Account 360, Work detail, Ask, and Deliverable preview while preserving the same URL and record.
- Briefing mode is read-only, keyboard navigable, and print-friendly for Account 360 and Deliverable preview.

## Remaining UX Limits

- Live internet research is intentionally not implemented.
- External web citations are limited to records already stored in the workspace.
- ERP/MES capacity, email execution, and calendar execution remain unavailable.
- Compare mode, statistical PWIN calibration, and self-learning score changes remain deferred.
