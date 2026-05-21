import { describe, expect, it } from "vitest";
import { parseShadcnThemeCss } from "./theme-tokens";

describe("shadcn applet theme tokens", () => {
  const css = `
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --chart-1: oklch(0.646 0.222 41.116);
}

.dark {
  --background: oklch(0.145 0 0);
  --chart-1: oklch(0.488 0.243 264.376);
}
`;

  it("parses shadcn Create theme CSS into light and dark token overrides", () => {
    expect(parseShadcnThemeCss(css, "light")).toMatchObject({
      "--background": "oklch(1 0 0)",
      "--chart-1": "oklch(0.646 0.222 41.116)",
    });
    expect(parseShadcnThemeCss(css, "dark")).toMatchObject({
      "--background": "oklch(0.145 0 0)",
      "--chart-1": "oklch(0.488 0.243 264.376)",
    });
  });

  it("rejects unsafe CSS values while preserving normal tokens", () => {
    const parsed = parseShadcnThemeCss(
      `:root { --background: oklch(1 0 0); --bad: url(javascript:alert(1)); }`,
      "light",
    );

    expect(parsed["--background"]).toBe("oklch(1 0 0)");
    expect(parsed["--bad"]).toBeUndefined();
  });

  it("does not read theme tokens from artifact metadata", () => {
    expect(
      parseShadcnThemeCss(
        ":root { --background: oklch(1 0 0); }",
        "light",
      ),
    ).toEqual({ "--background": "oklch(1 0 0)" });
  });
});
