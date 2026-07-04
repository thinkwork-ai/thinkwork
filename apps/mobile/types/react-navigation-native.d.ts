declare module "@react-navigation/native" {
  import type { ComponentType, ReactNode } from "react";

  export type Theme = {
    dark: boolean;
    colors: Record<string, string>;
    fonts?: unknown;
  };

  export const DefaultTheme: Theme;
  export const DarkTheme: Theme;
  export const ThemeProvider: ComponentType<{
    value: Theme;
    children?: ReactNode;
  }>;

  export function useFocusEffect(effect: () => void | (() => void)): void;
}
