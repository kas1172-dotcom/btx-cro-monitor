export const uiTokens = {
  color: {
    page: "#0C1621",
    rail: "#0A131E",
    panel: "#101E2C",
    card: "#13212F",
    cardBorder: "#22384B",
    hairline: "#1B2C3C",
    accent: "#2FB6A8",
    accentText: "#7FE3D6",
    accentTint: "#123430",
    textPrimary: "#E9EFF4",
    textSecondary: "#8DA1B4",
    textMuted: "#5F7488",
    success: "#54B37E",
    warning: "#E0A93B",
    danger: "#D96A57",
    info: "#4C86C4",
  },
  font: {
    family: '"Inter", "Segoe UI", Arial, sans-serif',
    weightRegular: 400,
    weightSemibold: 600,
  },
  rgb: {
    page: "12, 22, 33",
    rail: "10, 19, 30",
    panel: "16, 30, 44",
    card: "19, 33, 47",
    accent: "47, 182, 168",
    success: "84, 179, 126",
    warning: "224, 169, 59",
    danger: "217, 106, 87",
    info: "76, 134, 196",
  },
  radius: {
    sm: "6px",
    md: "8px",
    lg: "12px",
  },
} as const;

export type UiTokenName = keyof typeof uiTokens.color;
