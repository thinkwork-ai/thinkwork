import { useWindowDimensions, Platform } from "react-native";
import { useMemo } from "react";

export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

export function useMediaQuery() {
  const { width } = useWindowDimensions();

  return useMemo(() => {
    const isWeb = Platform.OS === "web";
    
    return {
      width,
      isMobile: width < BREAKPOINTS.md,
      isTablet: width >= BREAKPOINTS.md && width < BREAKPOINTS.lg,
      isDesktop: width >= BREAKPOINTS.lg,
      isWide: width >= BREAKPOINTS.md,
      isNarrow: width < BREAKPOINTS.md,
      isWeb,
      // Specific breakpoint checks
      sm: width >= BREAKPOINTS.sm,
      md: width >= BREAKPOINTS.md,
      lg: width >= BREAKPOINTS.lg,
      xl: width >= BREAKPOINTS.xl,
      "2xl": width >= BREAKPOINTS["2xl"],
    };
  }, [width]);
}

export function useBreakpoint(breakpoint: Breakpoint): boolean {
  const { width } = useWindowDimensions();
  return width >= BREAKPOINTS[breakpoint];
}

/**
 * Simple hook for wide screen detection (≥768px)
 */
export function useIsLargeScreen(): boolean {
  const { width } = useWindowDimensions();
  return width >= BREAKPOINTS.md;
}
