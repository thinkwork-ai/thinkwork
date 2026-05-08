import { describe, expect, it } from "vitest";
import {
  Avatar,
  BadgeSelectorText,
  Button,
  ChartContainer,
  Combobox,
  CopyableRow,
  DataTable,
  Dialog,
  FilterBarSearch,
  InputGroup,
  MultiSelect,
  Sidebar,
  Spinner,
  ThemeProvider,
  Toaster,
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
    expect(Toaster).toBeDefined();
    expect(ChartContainer).toBeDefined();
  });

  it("exposes the 7 non-stock custom components from the root barrel", () => {
    expect(BadgeSelectorText).toBeDefined();
    expect(MultiSelect).toBeDefined();
    expect(CopyableRow).toBeDefined();
    expect(InputGroup).toBeDefined();
    expect(DataTable).toBeDefined();
    expect(FilterBarSearch).toBeDefined();
    expect(Combobox).toBeDefined();
    expect(Spinner).toBeDefined();
  });
});
