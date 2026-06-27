// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "../src/context/ThemeContext";

const ORIGINAL_LOCAL_STORAGE = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);

function createStorage() {
  const store = new Map<string, string>();

  return {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => store.delete(key),
    setItem: (key: string, value: string) => store.set(key, value),
  };
}

function ThemeProbe() {
  const { theme, setTheme, toggleTheme } = useTheme();

  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button type="button" onClick={() => setTheme("light")}>
        Light
      </button>
      <button type="button" onClick={() => setTheme("dark")}>
        Dark
      </button>
      <button type="button" onClick={() => setTheme("dark-blue")}>
        Dark Blue
      </button>
      <button type="button" onClick={toggleTheme}>
        Toggle
      </button>
    </div>
  );
}

function renderThemeProbe() {
  return render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: createStorage(),
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove("dark", "dark-blue");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
  if (ORIGINAL_LOCAL_STORAGE) {
    Object.defineProperty(globalThis, "localStorage", ORIGINAL_LOCAL_STORAGE);
  }
});

describe("ThemeProvider", () => {
  it("applies the LastMile dark-blue class and keeps dark-mode compatibility", () => {
    renderThemeProbe();

    fireEvent.click(screen.getByRole("button", { name: "Dark Blue" }));

    expect(screen.getByTestId("theme").textContent).toBe("dark-blue");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("dark-blue")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark-blue");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(localStorage.getItem("thinkwork.theme")).toBe("dark-blue");
  });

  it("restores a stored dark-blue preference", () => {
    localStorage.setItem("thinkwork.theme", "dark-blue");

    renderThemeProbe();

    expect(screen.getByTestId("theme").textContent).toBe("dark-blue");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("dark-blue")).toBe(true);
  });

  it("cycles light, dark, and dark-blue from the toggle", () => {
    localStorage.setItem("thinkwork.theme", "light");

    renderThemeProbe();
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.getByTestId("theme").textContent).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.getByTestId("theme").textContent).toBe("dark-blue");

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.getByTestId("theme").textContent).toBe("light");
  });
});
