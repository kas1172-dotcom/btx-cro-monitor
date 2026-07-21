#!/usr/bin/env bash
set -euo pipefail

MODE="standard"
CUSTOM_BRANCH=""
ALLOW_DIRTY="false"
TASK_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick)
      MODE="quick"
      shift
      ;;
    --standard)
      MODE="standard"
      shift
      ;;
    --deep)
      MODE="deep"
      shift
      ;;
    --review)
      MODE="review"
      shift
      ;;
    --branch)
      CUSTOM_BRANCH="${2:-}"
      shift 2
      ;;
    --allow-dirty)
      ALLOW_DIRTY="true"
      shift
      ;;
    -h|--help)
      cat <<HELP
Usage:
  ./scripts/ai-dev.sh [--quick|--standard|--deep|--review] [--branch branch-name] "your messy request"

Modes:
  --quick      Tiny fix, copy change, CSS/layout bug, one-component change
  --standard   Normal feature, bug fix, or app improvement
  --deep       Architecture, API/data flow, ranking logic, confusing bug
  --review     Review current changes only; Codex will not edit

Examples:
  ./scripts/ai-dev.sh --quick "Fix the ranking card text overflow"
  ./scripts/ai-dev.sh --standard "Add an All option to the You Are In button"
  ./scripts/ai-dev.sh --deep "Redesign the API brain so connected systems can affect rankings, summaries, map context, and ChatPill"
  ./scripts/ai-dev.sh --review "Review whether the current ranking system is explainable to a CRO"
HELP
      exit 0
      ;;
    *)
      TASK_ARGS+=("$1")
      shift
      ;;
  esac
done

TASK="${TASK_ARGS[*]:-}"

if [ -z "$TASK" ]; then
  echo "Missing task."
  echo "Run: ./scripts/ai-dev.sh --standard \"Describe your task in normal English\""
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Git is required for this workflow."
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude CLI not found. Install/login to Claude Code first."
  exit 1
fi

if [ "$MODE" != "review" ] && ! command -v codex >/dev/null 2>&1; then
  echo "Codex CLI not found. Install/login to Codex first."
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Run this from inside a git repo."
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current || true)"

slugify() {
  echo "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9]/-/g' \
    | sed 's/-\+/-/g' \
    | sed 's/^-//' \
    | sed 's/-$//' \
    | cut -c1-48
}

DATE_STAMP="$(date +%Y%m%d-%H%M)"
TASK_SLUG="$(slugify "$TASK")"
TASK_SLUG="${TASK_SLUG:-task}"

RUN_ID="${DATE_STAMP}-${MODE}-${TASK_SLUG}"
RUN_DIR=".ai/runs/${RUN_ID}"
mkdir -p "$RUN_DIR"

# Prevent accidental AI edits on top of unrelated uncommitted work.
if [ "$ALLOW_DIRTY" != "true" ] && [ "$MODE" != "review" ]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Your working tree has uncommitted changes."
    echo "Commit/stash them first, or rerun with --allow-dirty if you intentionally want AI to work on top of them."
    exit 1
  fi
fi

# Create an AI branch for implementation tasks.
if [ "$MODE" != "review" ]; then
  if [[ "$CURRENT_BRANCH" != ai/* ]]; then
    if [ -n "$CUSTOM_BRANCH" ]; then
      BRANCH_NAME="$CUSTOM_BRANCH"
    else
      BRANCH_NAME="ai/${MODE}-${TASK_SLUG}"
    fi

    if git show-ref --verify --quiet "refs/heads/${BRANCH_NAME}"; then
      BRANCH_NAME="${BRANCH_NAME}-${DATE_STAMP}"
    fi

    echo "Creating task branch: ${BRANCH_NAME}"
    git checkout -b "$BRANCH_NAME"
  else
    echo "Already on AI branch: ${CURRENT_BRANCH}"
  fi
fi

cat > "$RUN_DIR/request.md" <<REQUEST_EOF
# Original request

Mode: $MODE

$TASK
REQUEST_EOF

# Model presets.
# You can override these from the terminal, for example:
# CODEX_MODEL=gpt-5.5 ./scripts/ai-dev.sh --standard "task"
case "$MODE" in
  quick)
    CLAUDE_MODEL="${CLAUDE_MODEL:-sonnet}"
    CLAUDE_EFFORT="${CLAUDE_EFFORT:-medium}"
    CODEX_MODEL="${CODEX_MODEL:-gpt-5.2-codex}"
    CODEX_EFFORT="${CODEX_EFFORT:-medium}"
    ;;
  standard)
    CLAUDE_MODEL="${CLAUDE_MODEL:-sonnet}"
    CLAUDE_EFFORT="${CLAUDE_EFFORT:-high}"
    CODEX_MODEL="${CODEX_MODEL:-gpt-5.2-codex}"
    CODEX_EFFORT="${CODEX_EFFORT:-high}"
    ;;
  deep)
    CLAUDE_MODEL="${CLAUDE_MODEL:-opus}"
    CLAUDE_EFFORT="${CLAUDE_EFFORT:-xhigh}"
    CODEX_MODEL="${CODEX_MODEL:-gpt-5.2-codex}"
    CODEX_EFFORT="${CODEX_EFFORT:-xhigh}"
    ;;
  review)
    CLAUDE_MODEL="${CLAUDE_MODEL:-opus}"
    CLAUDE_EFFORT="${CLAUDE_EFFORT:-high}"
    CODEX_MODEL=""
    CODEX_EFFORT=""
    ;;
esac

run_claude_to_file() {
  local prompt_file="$1"
  local output_file="$2"

  if claude --help 2>&1 | grep -q -- "--model"; then
    if claude --help 2>&1 | grep -q -- "--effort"; then
      claude -p --model "$CLAUDE_MODEL" --effort "$CLAUDE_EFFORT" "$(cat "$prompt_file")" | tee "$output_file"
    else
      claude -p --model "$CLAUDE_MODEL" "$(cat "$prompt_file")" | tee "$output_file"
    fi
  else
    claude -p "$(cat "$prompt_file")" | tee "$output_file"
  fi
}

run_codex() {
  local prompt_file="$1"
  local output_file="$2"

  codex exec \
    --config "model=\"${CODEX_MODEL}\"" \
    --config "model_reasoning_effort=\"${CODEX_EFFORT}\"" \
    "$(cat "$prompt_file")" | tee "$output_file"
}

echo ""
echo "Run folder: $RUN_DIR"
echo "Mode: $MODE"
echo "Claude model preset: $CLAUDE_MODEL / effort: $CLAUDE_EFFORT"
if [ "$MODE" != "review" ]; then
  echo "Codex model preset: $CODEX_MODEL / effort: $CODEX_EFFORT"
fi
echo ""

if [ "$MODE" = "review" ]; then
  cat > "$RUN_DIR/claude-review-prompt.md" <<PROMPT_EOF
You are my senior product, architecture, and code reviewer.

Read:
- AGENTS.md if it exists
- CLAUDE.md if it exists
- docs/WIZARD_STACK_RECONCILE.md if architecture-porting context is needed
- $RUN_DIR/request.md
- git diff

Do not edit files.

Output a review in markdown with:

# Claude Review

## Summary
Did the current work satisfy the request?

## Blockers
Issues that must be fixed.

## Should fix
Important issues.

## Nice to have
Optional improvements.

## Product concerns
Does this make the app clearer or more useful for the target user?

## Architecture concerns
Does this introduce unnecessary complexity, hardcoding, or future problems?

## UX concerns
Any readability, workflow, layout, or explanation issues.

## Suggested next Codex prompt
A precise follow-up prompt if code changes are needed.
PROMPT_EOF

  echo "Claude is reviewing current changes..."
  run_claude_to_file "$RUN_DIR/claude-review-prompt.md" "$RUN_DIR/review.md"

  echo ""
  echo "Review complete:"
  echo "- $RUN_DIR/review.md"
  exit 0
fi

cat > "$RUN_DIR/claude-plan-prompt.md" <<PROMPT_EOF
You are my senior product architect and prompt compiler for Codex.

Read:
- AGENTS.md
- CLAUDE.md
- docs/WIZARD_STACK_RECONCILE.md if architecture-porting context is needed
- $RUN_DIR/request.md

Do not write application code.
Do not edit files.
Your job is to turn the user's messy request into a precise Codex implementation prompt.

Output markdown only.
Do not wrap your answer in a code fence.

Create this structure:

# Codex Implementation Prompt

## Goal
One clear sentence.

## Context
What the user is trying to accomplish and why it matters.

## Scope
Exactly what Codex should change.

## Out of scope
What Codex must not touch.

## Files to inspect first
Likely files or folders. If uncertain, tell Codex to inspect before editing.

## Implementation steps
Numbered steps.

## UX/product requirements
What the user should see or experience.

## Technical requirements
Architecture, data, state, API, styling, or testing requirements.

## Acceptance criteria
Checklist of what must be true when finished.

## Verification
Commands Codex should run if available.

## Final Codex instruction
Implement only this task. Make the smallest complete change. Do not rewrite unrelated files. Summarize files changed, verification results, and known issues.

Important context:
The product is a CRO-facing decision-support app. The user cares about clean UI, explainable rankings, current-business vs prospecting workflows, ChatPill context, API-driven future state, and avoiding hardcoded demo logic unless explicitly requested.
PROMPT_EOF

echo "1/3 Claude is converting your request into a Codex-ready prompt..."
run_claude_to_file "$RUN_DIR/claude-plan-prompt.md" "$RUN_DIR/codex-prompt.md"

cat > "$RUN_DIR/codex-exec-prompt.md" <<PROMPT_EOF
$(cat "$RUN_DIR/codex-prompt.md")

Additional execution requirements:
- Read AGENTS.md before editing.
- Store your implementation summary and verification results in $RUN_DIR/test-log.md.
- Do not edit $RUN_DIR/request.md or $RUN_DIR/codex-prompt.md.
- If verification fails, document the exact failure and the likely fix.
PROMPT_EOF

echo ""
echo "2/3 Codex is implementing..."
run_codex "$RUN_DIR/codex-exec-prompt.md" "$RUN_DIR/codex-output.log"

cat > "$RUN_DIR/claude-review-prompt.md" <<PROMPT_EOF
You are my senior product, architecture, and code reviewer.

Review:
- AGENTS.md
- CLAUDE.md
- docs/WIZARD_STACK_RECONCILE.md if architecture-porting context is needed
- $RUN_DIR/request.md
- $RUN_DIR/codex-prompt.md
- $RUN_DIR/test-log.md if it exists
- git diff

Do not edit code.

Output markdown only.
Do not wrap your answer in a code fence.

Create:

# Claude Review

## Summary
Did Codex satisfy the original request?

## Blockers
Issues that must be fixed before commit.

## Should fix
Important issues that should be fixed soon.

## Nice to have
Optional improvements.

## Product concerns
Does this actually make the app clearer or more useful for the CRO?

## Architecture concerns
Does this introduce hardcoding, duplicated logic, fragile state, bad data flow, or future API problems?

## UX concerns
Any readability, layout, workflow, naming, or explanation issues.

## Acceptance criteria check
Mark each acceptance criterion as pass/fail/unclear.

## Follow-up Codex prompt
If fixes are needed, give one precise prompt that fixes only blockers and should-fix issues.
PROMPT_EOF

echo ""
echo "3/3 Claude is reviewing Codex's changes..."
run_claude_to_file "$RUN_DIR/claude-review-prompt.md" "$RUN_DIR/review.md"

echo ""
echo "Done."
echo ""
echo "Open these:"
echo "- $RUN_DIR/codex-prompt.md"
echo "- $RUN_DIR/test-log.md"
echo "- $RUN_DIR/review.md"
echo ""
echo "Inspect the code:"
echo "git diff"
echo ""
echo "Run your app:"
echo "npm run dev"
echo ""
echo "If good:"
echo "git add . && git commit -m \"AI task: ${TASK_SLUG}\""
echo ""
echo "If bad:"
echo "git restore ."
