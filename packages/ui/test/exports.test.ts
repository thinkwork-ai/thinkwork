import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { generatedAppPolicy } from "../generated-app-policy.js";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const generatedAppRegistry = JSON.parse(
  readFileSync(
    join(repoRoot, "packages/ui/registry/generated-app-components.json"),
    "utf8",
  ),
) as {
  version: string;
  components: Array<{
    id: string;
    exportName: string;
    importSpecifier: string;
    approvedForGeneratedApps: boolean;
    role: string;
    replaces: string[];
    dependencies: string[];
    registryDependencies: string[];
    description: string;
    example: string;
  }>;
};
const shadcnRegistry = JSON.parse(
  readFileSync(join(repoRoot, "packages/ui/registry.json"), "utf8"),
) as {
  items: Array<{ name: string; description: string }>;
};

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

  it("publishes generated-app registry metadata for core primitives", () => {
    const components = new Map(
      generatedAppRegistry.components.map((component) => [
        component.id,
        component,
      ]),
    );

    for (const id of [
      "button",
      "card",
      "tabs",
      "table",
      "badge",
      "data-table",
      "select",
      "dropdown-menu",
      "combobox",
      "chart-container",
      "host-map",
    ]) {
      const component = components.get(id);
      expect(component, id).toBeDefined();
      expect(component?.approvedForGeneratedApps).toBe(true);
      expect(component?.role).toBeTruthy();
      expect(component?.replaces.length).toBeGreaterThan(0);
      expect(component?.dependencies).toBeDefined();
      expect(component?.registryDependencies).toBeDefined();
      expect(component?.example).toContain("import");
    }
  });

  it("keeps generated-app registry exports aligned with the import policy", () => {
    const policyExports = new Set<string>(
      generatedAppPolicy.packages["@thinkwork/ui"].namedExports,
    );
    const registryExports = generatedAppRegistry.components
      .filter((component) => component.importSpecifier === "@thinkwork/ui")
      .map((component) => component.exportName);

    for (const exportName of registryExports) {
      expect(policyExports.has(exportName), exportName).toBe(true);
    }
  });

  it("publishes a shadcn-compatible registry index", () => {
    const names = new Set(shadcnRegistry.items.map((item) => item.name));

    expect(names.has("generated-app-surface")).toBe(true);
    expect(names.has("button")).toBe(true);
    expect(names.has("host-map")).toBe(true);
    expect(shadcnRegistry.items.every((item) => item.description)).toBe(true);
  });
});
