// Canonical Steel and Signal brand values shared by BOTH themes: the dark
// cockpit (uiTokens.ts) and the light print documents (deliverables/designTokens.ts).
// Only values that are genuinely identical across the two themes live here, so
// they cannot drift. Per-theme surfaces and text colors do NOT belong here; each
// theme defines its own. See docs/DESIGN_SPEC.md.
//
// The cockpit and the document theme use different print-tuned status greens,
// reds, and steels on purpose; those stay per-theme and are not shared here.

export const brandCore = {
  accent: "#2FB6A8",
  amber: "#E0A93B",
  font: {
    family: '"Inter", "Segoe UI", Arial, sans-serif',
    face: "Inter",
    weightRegular: 400,
    weightSemibold: 600,
  },
} as const;

/** Bare hex (no leading #), for generators that need the 6-char form. */
export function hex(value: string): string {
  return value.replace(/^#/, "");
}
