import { afterEach, describe, expect, it } from "vitest";
import { buildMcpAppHostContext } from "./mcp-app-host-context";

const root = document.documentElement;

afterEach(() => {
  root.removeAttribute("style");
});

describe("MCP App host context", () => {
  it("maps dark-blue to portable dark theme with computed host variables", () => {
    root.style.setProperty("--background", "hsl(217 33% 12%)");
    root.style.setProperty("--card", "hsl(217 33% 14%)");
    root.style.setProperty("--foreground", "hsl(213 31% 91%)");
    root.style.setProperty("--muted-foreground", "hsl(215 20% 65%)");
    root.style.setProperty("--border", "hsl(217 30% 20%)");
    root.style.setProperty("--ring", "hsl(213 94% 68%)");
    root.style.setProperty("--radius-md", "0.5rem");

    const context = buildMcpAppHostContext("dark-blue", root);

    expect(context.theme).toBe("dark");
    expect(context.styles.variables["--color-background-primary"]).toBe(
      "hsl(217 33% 12%)",
    );
    expect(context.styles.variables["--color-background-secondary"]).toBe(
      "hsl(217 33% 14%)",
    );
    expect(context.styles.variables["--color-text-primary"]).toBe(
      "hsl(213 31% 91%)",
    );
    expect(context.styles.variables["--color-border-primary"]).toBe(
      "hsl(217 30% 20%)",
    );
    expect(context.styles.variables["--color-ring-primary"]).toBe(
      "hsl(213 94% 68%)",
    );
    expect(context.styles.variables["--border-radius-md"]).toBe("0.5rem");
  });

  it("maps light to portable light theme", () => {
    root.style.setProperty("--background", "#ffffff");
    root.style.setProperty("--foreground", "#111111");

    const context = buildMcpAppHostContext("light", root);

    expect(context.theme).toBe("light");
    expect(context.styles.variables["--color-background-primary"]).toBe(
      "#ffffff",
    );
    expect(context.styles.variables["--color-text-primary"]).toBe("#111111");
  });

  it("omits missing or blank source tokens", () => {
    root.style.setProperty("--background", "   ");
    root.style.setProperty("--foreground", "#111111");

    const context = buildMcpAppHostContext("dark", root);

    expect(context.theme).toBe("dark");
    expect(context.styles.variables).not.toHaveProperty(
      "--color-background-primary",
    );
    expect(context.styles.variables["--color-text-primary"]).toBe("#111111");
  });

  it("does not include identity, tenant, credential, or authorization fields", () => {
    root.style.setProperty("--background", "#ffffff");
    root.style.setProperty("--foreground", "#111111");

    const serialized = JSON.stringify(buildMcpAppHostContext("light", root));

    expect(serialized).not.toMatch(
      /tenant|user|credential|authorization|token|secret/i,
    );
  });
});
