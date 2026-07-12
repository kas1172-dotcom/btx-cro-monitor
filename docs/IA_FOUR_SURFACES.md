# Four-Surface IA

## Assistant Consolidation

Ask is the primary assistant surface. The floating Copilot window is retired because it duplicated the same conversational role while Ask is already embedded in the cockpit workflow and brain-action path.

Kept assistant modules:

- `frontend/src/brain/brainEngine.ts` and `frontend/src/brain/generateBrainResponse.ts`: deterministic Ask response path.
- `frontend/src/brain/jarvis.ts`: live/offline LLM orchestration used by assistant calls.
- `frontend/src/brain/copilot.ts`: deterministic fallback helper still imported by `jarvis.ts`.

Deleted assistant surface:

- `frontend/src/ui/copilot/Copilot.tsx`: unreferenced after App shell removal.

## Before / After Nav Map

Before: nine peer entries:

- Home
- Signals
- Accounts
- Capability
- Revenue
- Map
- Memory
- Actions
- Settings

After: hierarchy:

- Core: Today's Brief, Work Queue, Accounts, Ask
- Analytical: Map, Analysis, Capacity, Programs
- Utility: Settings

Absorbed views:

- Signals, Accounts, Capability, and Revenue now roll into Account 360 plus the analytical dashboards.
- Memory, Source admin, Configuration, and Integrations live under Settings.
- The old Actions tab becomes Work Queue backed by the durable work-item contract.

## Work-Item Boundary

The cockpit attempts to read `/work-items` from the backend and falls back to deterministic work items derived from the current world when browser-safe backend auth is not available yet. The fallback is labeled in the UI; it is not presented as persisted backend state.
