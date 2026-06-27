import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "dark-blue";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "thinkwork.theme";
const DARK_BLUE_THEME_COLOR = "#0f1724";
const DARK_THEME_COLOR = "#1a1a1a";
const LIGHT_THEME_COLOR = "#ffffff";

function isTheme(value: string | null): value is Theme {
  return value === "dark" || value === "dark-blue" || value === "light";
}

function isDarkTheme(theme: Theme): boolean {
  return theme === "dark" || theme === "dark-blue";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isTheme(stored)) return stored;
    // Default to dark mode
    return "dark";
  });

  const apply = useCallback((t: Theme) => {
    const isDark = isDarkTheme(t);
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("dark-blue", t === "dark-blue");
    document.documentElement.dataset.theme = t;
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute(
        "content",
        t === "dark-blue"
          ? DARK_BLUE_THEME_COLOR
          : t === "dark"
            ? DARK_THEME_COLOR
            : LIGHT_THEME_COLOR,
      );
    }
    localStorage.setItem(STORAGE_KEY, t);
  }, []);

  useEffect(() => apply(theme), [theme, apply]);

  const setTheme = useCallback(
    (t: Theme) => {
      setThemeState(t);
      apply(t);
    },
    [apply],
  );

  const toggleTheme = useCallback(() => {
    setTheme(
      theme === "light" ? "dark" : theme === "dark" ? "dark-blue" : "light",
    );
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
