import { describe, expect, it } from "vitest";
import { sanitizeAppletThemeCss } from "../lib/applets/theme-sanitize.js";

describe("sanitizeAppletThemeCss (OQ1 server-side strip)", () => {
  it("leaves safe token declarations untouched", () => {
    const css =
      ":root { --background: oklch(1 0 0); --chart-1: oklch(0.6 0.2 30); }";
    expect(sanitizeAppletThemeCss(css)).toBe(css);
  });

  it("drops declarations with url() (cross-origin exfil vector)", () => {
    const out = sanitizeAppletThemeCss(
      ":root { --background: oklch(1 0 0); --bg-img: url(https://evil.example/p.gif); }",
    );
    expect(out).not.toMatch(/url\(/i);
    expect(out).toContain("--background: oklch(1 0 0)");
  });

  it("drops declarations with expression()", () => {
    const out = sanitizeAppletThemeCss(
      ":root { --x: expression(alert(1)); --safe: oklch(1 0 0); }",
    );
    expect(out).not.toMatch(/expression\(/i);
    expect(out).toContain("--safe: oklch(1 0 0)");
  });

  it("drops declarations with javascript: values", () => {
    const out = sanitizeAppletThemeCss(
      ":root { --u: javascript:alert(1); --safe: oklch(1 0 0); }",
    );
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain("--safe: oklch(1 0 0)");
  });

  it("strips @import at-rules", () => {
    const out = sanitizeAppletThemeCss(
      '@import "https://evil.example/x.css"; :root { --safe: oklch(1 0 0); }',
    );
    expect(out).not.toMatch(/@import/i);
    expect(out).toContain("--safe: oklch(1 0 0)");
  });

  it("is case-insensitive to the dangerous patterns", () => {
    const out = sanitizeAppletThemeCss(
      ":root { --u: URL(https://evil.example); --j: JavaScript:alert(1); }",
    );
    expect(out).not.toMatch(/url\(/i);
    expect(out).not.toMatch(/javascript:/i);
  });

  it("strips CSS comments so they cannot split a keyword (u/*c*/rl bypass)", () => {
    const out = sanitizeAppletThemeCss(
      ":root { --safe: oklch(1 0 0); --x: u/*c*/rl(https://evil.example/x); }",
    );
    expect(out).not.toMatch(/url\(/i);
    expect(out).toContain("--safe: oklch(1 0 0)");
  });

  it("drops image-set() / -webkit-image-set() URL vectors", () => {
    const out = sanitizeAppletThemeCss(
      ':root { --a: image-set("https://evil/x" 1x); --b: -webkit-image-set(url(https://evil/y) 1x); --safe: oklch(1 0 0); }',
    );
    expect(out).not.toMatch(/image-set\s*\(/i);
    expect(out).not.toMatch(/url\(/i);
    expect(out).toContain("--safe: oklch(1 0 0)");
  });

  it("retains the :root/.dark selector even when its first declaration is stripped", () => {
    const out = sanitizeAppletThemeCss(
      ":root { --x: url(https://evil/x); --safe: oklch(1 0 0); }",
    );
    // Block boundary preserved (the selector is never consumed) so the
    // downstream :root/.dark presence check still passes.
    expect(out).toContain(":root {");
    expect(out).toContain("--safe: oklch(1 0 0)");
  });
});
