/** Game master palettes (design doc §7.1). Warm = left hemisphere, cold = right. */
export const PALETTES = {
  warm: {
    g50: "#FFF7EC", g100: "#FFE8C7", g200: "#FFD08A", g300: "#FFB547", g400: "#FF8F3D",
    g500: "#F26A2E", g600: "#E0483A", g700: "#B8322B", g800: "#7A2420", g900: "#3D1410",
    accent1: "#F5C431", accent2: "#FF7A8A",
    hudBg: "rgb(61 20 16 / 0.88)", hudFg: "#FFF7EC", hudAccent: "#FFB547", hudWarning: "#F5C431",
    btn: "#B8322B", btnText: "#FFFFFF",
    heart: "#FF5A5F", success: "#1F9D55", error: "#D63A3A",
  },
  cold: {
    g50: "#F0F7FF", g100: "#D6ECFF", g200: "#A8D8F5", g300: "#6CC4E8", g400: "#2FB3C8",
    g500: "#2A8FD8", g600: "#3D63D6", g700: "#5B47C9", g800: "#232C6B", g900: "#0E1530",
    accent1: "#4FD8B8", accent2: "#B39BFF",
    hudBg: "rgb(14 21 48 / 0.88)", hudFg: "#F0F7FF", hudAccent: "#6CC4E8", hudWarning: "#F5C431",
    btn: "#3D63D6", btnText: "#FFFFFF",
    heart: "#FF5A5F", success: "#1F9D55", error: "#D63A3A",
  },
} as const;

export const HIGH_CONTRAST = { hudBg: "#000000", hudFg: "#FFFFFF", outline: "#FFE14D" } as const;
