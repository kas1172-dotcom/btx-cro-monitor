# BTX Voice Spec

Status: law. This file is the single source of truth for how the product writes: every
generated deliverable, every Ask answer, and every user-visible string in the cockpit.
The `check:voice` linter enforces the mechanical rules (banned words, banned openers, em
dashes). The composition rubric and validators enforce the rest.

The goal: text that reads like a deliberate house style written by a person who knows the
business, not like generic AI output.

## 1. Voice rules

- Answer first. Lead with the conclusion, then the evidence. Never build up to the point.
- One claim, one piece of evidence. Do not stack three supporting clauses on one claim.
- Plain verbs. Active voice. The subject does the thing.
- Short sentences. Short paragraphs. One idea per sentence.
- Exact numbers from source only. Never invent, round, or estimate a figure. If a number
  is not in the source, do not state one.
- Name the source when a claim depends on it. Cite the real source, never a filename.
- Say what is missing when data is missing, in plain words, not with a hedge.

## 2. Banned words

These signal generic AI writing. Never ship them in user-visible copy or deliverables:

leverage, utilize, unlock, streamline, foster, delve, robust, seamless, holistic,
cutting-edge, elevate, empower, synergy, game-changer, best-in-class, world-class,
revolutionary, paradigm, tapestry, realm, landscape, spearhead.

Also banned: navigate used as a metaphor (navigating the landscape, navigate challenges).
Navigate is allowed only for literal movement or map interaction.

## 3. Banned openers

Do not start a sentence, paragraph, section, or answer with any of these:

"In today's ...", "It is worth noting", "It is important to", "In conclusion", "At the
end of the day", "Needless to say".

## 4. Banned punctuation and patterns

- No em dashes and no en dashes, anywhere: copy, code, comments, commits, specs. Use a
  comma, a colon, or restructure the sentence.
- No emoji, anywhere in the product or deliverables.
- No exclamation marks in deliverables.
- No meta about the assistant or the prompt: "As an AI", "I hope this helps", "Certainly",
  "Sure, here is". Do not restate the request back to the user.
- No rule-of-three padding: do not pad a sentence with three synonyms or three clauses for
  rhythm.
- No hedges: very, really, quite, basically, essentially, arguably, fairly, somewhat.

## 5. Deliverable shape

- A brief, memo, or assessment opens with the verdict, not with context.
- Each section earns its place with a clear so-what.
- Evidence is bound to the claim it supports and to the account it concerns.
- A meeting brief for one account carries that account's signals, not the portfolio's.

## 6. Enforcement

- `check:voice` scans user-visible strings, deliverable templates, and the LLM system
  prompts in `frontend/src/agents/` and `frontend/src/brain/` for the words in section 2,
  the openers in section 3, and em or en dashes. A hit fails the build.
- The canonical banned lists live in `frontend/tools/voiceRules.ts` and mirror this file.
  When this file changes, that module changes with it.
- An explicit allowlist file `frontend/tools/voice-allowlist.txt` holds the few legitimate
  exceptions (for example a real product or company name that contains a banned substring).
  The allowlist is reviewed, not a dumping ground.
