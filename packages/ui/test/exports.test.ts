import { describe, expect, it } from "vitest";
import {
  Avatar,
  Button,
  Dialog,
  Sidebar,
  ThemeProvider,
  cn,
  useIsMobile,
  useTheme,
} from "../src/index.js";

describe("@thinkwork/ui barrel exports", () => {
  it("exposes ThemeProvider as a function component", () => {
    expect(typeof ThemeProvider).toBe("function");
  });

  it("exposes useTheme as a hook function", () => {
    expect(typeof useTheme).toBe("function");
  });

  it("exposes cn that joins class names and drops falsy values", () => {
    expect(cn("a", "b")).toBe("a b");
    expect(cn("a", false, "b")).toBe("a b");
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("exposes useIsMobile hook from the barrel", () => {
    expect(typeof useIsMobile).toBe("function");
  });

  it("exposes representative shadcn primitives from the root barrel", () => {
    expect(Button).toBeDefined();
    expect(Dialog).toBeDefined();
    expect(Sidebar).toBeDefined();
    expect(Avatar).toBeDefined();
  });
});
