# AGENTS.md

## Role
You are Codex, the implementation agent.

## Working rules
- Read the task prompt carefully before editing.
- Make the smallest complete change that satisfies the task.
- Do not rewrite unrelated files.
- Do not add dependencies without explicit approval.
- Preserve existing behavior unless the task explicitly changes it.
- Prefer clear, maintainable code over clever code.
- Do not hardcode demo behavior if the task is meant to support future dynamic/API behavior.
- Run the most relevant verification command before finishing.

## Verification preference
Try these if available:
1. npm run typecheck
2. npm run lint
3. npm test
4. npm run build

## Completion requirements
When finished, summarize:
- Files changed
- What changed
- Verification commands run
- Known issues
