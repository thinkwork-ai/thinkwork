import { DarkTheme, DefaultTheme, type Theme } from "@react-navigation/native";

// Theme colors matching our CSS variables
export const COLORS = {
  light: {
    background: "#ffffff",
    foreground: "#171717",
    card: "#ffffff",
    cardForeground: "#171717",
    primary: "#f8841d",
    primaryForeground: "#fafafa",
    secondary: "#f5f5f5",
    secondaryForeground: "#262626",
    muted: "#f5f5f5",
    mutedForeground: "#737373",
    destructive: "#ef4444",
    border: "#e5e5e5",
    input: "#e5e5e5",
  },
  dark: {
    background: "#000000",
    foreground: "#fafafa",
    card: "#171717",
    cardForeground: "#fafafa",
    primary: "#faa54b",
    primaryForeground: "#fafafa",
    secondary: "#262626",
    secondaryForeground: "#fafafa",
    muted: "#262626",
    mutedForeground: "#a3a3a3",
    destructive: "#ef4444",
    border: "rgba(255, 255, 255, 0.1)",
    input: "rgba(255, 255, 255, 0.15)",
  },
};

// Navigation theme for @react-navigation/native
export const NAV_THEME: Record<"light" | "dark", Theme> = {
  light: {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: COLORS.light.background,
      border: COLORS.light.border,
      card: COLORS.light.card,
      notification: COLORS.light.destructive,
      primary: COLORS.light.primary,
      text: COLORS.light.foreground,
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: COLORS.dark.background,
      border: COLORS.dark.border,
      card: COLORS.dark.card,
      notification: COLORS.dark.destructive,
      primary: COLORS.dark.primary,
      text: COLORS.dark.foreground,
    },
  },
};
