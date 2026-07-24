// Canonical BTX voice lists and detection. Mirrors docs/VOICE_SPEC.md. The
// deliverable composition prompts, the editor rewrite, the Ask assistant, and
// the check:voice linter all import from here so there is one list.

export const BANNED_WORDS = [
  "leverage", "utilize", "unlock", "streamline", "foster", "delve", "robust",
  "seamless", "holistic", "cutting-edge", "elevate", "empower", "synergy",
  "game-changer", "best-in-class", "world-class", "revolutionary", "paradigm",
  "tapestry", "realm", "landscape", "spearhead",
] as const;

export const BANNED_OPENERS = [
  "In today's", "It is worth noting", "It is important to", "In conclusion",
  "At the end of the day", "Needless to say",
] as const;

export const BANNED_HEDGES = [
  "very", "really", "quite", "basically", "essentially", "arguably", "fairly", "somewhat",
] as const;

export const VOICE_RULES_PROMPT = [
  "Write in the BTX house voice.",
  "Answer first: lead with the conclusion, then the evidence.",
  "One claim, one piece of evidence. Do not stack clauses.",
  "Plain verbs, active voice, short sentences, short paragraphs.",
  "Use exact numbers from source only. Never invent or round a figure.",
  "Say what is missing in plain words.",
  `Never use these words: ${BANNED_WORDS.join(", ")}.`,
  `Never open with: ${BANNED_OPENERS.join("; ")}.`,
  "No em dashes or en dashes; use a comma or restructure. No emoji. No exclamation marks.",
  "No meta about yourself or the request. Do not restate the request.",
  "No hedges such as very, really, quite, basically, essentially.",
].join("\n");

function wordPattern(word: string): RegExp {
  if (/[^a-z]/i.test(word)) {
    // Hyphenated or multi-part term: match the literal phrase.
    return new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  // Single word plus common inflections, on word boundaries.
  return new RegExp(`\\b${word}(?:s|es|ed|d|ing)?\\b`, "i");
}

/**
 * Return the voice violations found in `text`: banned words, banned openers,
 * and em or en dashes. Empty array means the text is clean.
 */
export function findVoiceViolations(text: string): string[] {
  const found: string[] = [];
  if (/[\u2013\u2014]/.test(text)) found.push("em or en dash");
  for (const word of BANNED_WORDS) {
    if (wordPattern(word).test(text)) found.push(`banned word "${word}"`);
  }
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const opener of BANNED_OPENERS) {
    if (lines.some((line) => line.toLowerCase().startsWith(opener.toLowerCase()))) {
      found.push(`banned opener "${opener}"`);
    }
  }
  return [...new Set(found)];
}
