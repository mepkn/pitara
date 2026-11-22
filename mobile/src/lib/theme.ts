import { DarkTheme, DefaultTheme, type Theme } from "expo-router";

// Mirrors the CSS variables in global.css for React Navigation chrome and for
// places that need a raw colour (icons, spinners). Palette: README "Look and feel".
export const THEME = {
  light: {
    background: "#FBF7F1",
    foreground: "#2B2218",
    card: "#FFFFFF",
    primary: "#B5651A", // --brand: tab tint and header accents
    fill: "#D9822B", // --primary
    border: "#E6DBCB",
    muted: "#7C6E5C",
    destructive: "#C2410C",
  },
  dark: {
    background: "#1C1814",
    foreground: "#F1E9DD",
    card: "#25201A",
    primary: "#E8963F",
    fill: "#E8963F",
    border: "#3A3128",
    muted: "#A89A87",
    destructive: "#F97316",
  },
};

export const NAV_THEME: Record<"light" | "dark", Theme> = {
  light: {
    ...DefaultTheme,
    colors: {
      background: THEME.light.background,
      border: THEME.light.border,
      card: THEME.light.card,
      notification: THEME.light.destructive,
      primary: THEME.light.primary,
      text: THEME.light.foreground,
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      background: THEME.dark.background,
      border: THEME.dark.border,
      card: THEME.dark.card,
      notification: THEME.dark.destructive,
      primary: THEME.dark.primary,
      text: THEME.dark.foreground,
    },
  },
};
