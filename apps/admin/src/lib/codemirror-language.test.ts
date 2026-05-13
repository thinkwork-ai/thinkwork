import { describe, expect, it } from "vitest";
import { languageForFile } from "./codemirror-language";

describe("languageForFile", () => {
  it("returns [] for null", () => {
    expect(languageForFile(null)).toEqual([]);
  });

  it("returns [] for undefined", () => {
    expect(languageForFile(undefined)).toEqual([]);
  });

  it("returns [] for empty string", () => {
    expect(languageForFile("")).toEqual([]);
  });

  it("returns [] for a file with no extension (Dockerfile)", () => {
    expect(languageForFile("Dockerfile")).toEqual([]);
  });

  it("returns [] for unknown extension (.foo)", () => {
    expect(languageForFile("notes.foo")).toEqual([]);
  });

  it("returns a non-empty extension for .md", () => {
    const exts = languageForFile("AGENTS.md");
    expect(exts).toHaveLength(1);
    expect(exts[0]).toBeDefined();
  });

  it("returns a non-empty extension for .markdown", () => {
    const exts = languageForFile("notes.markdown");
    expect(exts).toHaveLength(1);
  });

  it("returns a non-empty extension for .json", () => {
    const exts = languageForFile("thinkwork-runbook.json");
    expect(exts).toHaveLength(1);
  });

  it("returns a non-empty extension for .jsonc", () => {
    const exts = languageForFile("tsconfig.jsonc");
    expect(exts).toHaveLength(1);
  });

  it("returns a non-empty extension for .ts", () => {
    expect(languageForFile("recipe.ts")).toHaveLength(1);
  });

  it("returns a non-empty extension for .tsx", () => {
    expect(languageForFile("Component.tsx")).toHaveLength(1);
  });

  it("returns a non-empty extension for .js", () => {
    expect(languageForFile("legacy.js")).toHaveLength(1);
  });

  it("returns a non-empty extension for .jsx", () => {
    expect(languageForFile("legacy.jsx")).toHaveLength(1);
  });

  it("returns a non-empty extension for .mjs", () => {
    expect(languageForFile("module.mjs")).toHaveLength(1);
  });

  it("returns a non-empty extension for .cjs", () => {
    expect(languageForFile("module.cjs")).toHaveLength(1);
  });

  it("returns a non-empty extension for .py", () => {
    expect(languageForFile("script.py")).toHaveLength(1);
  });

  it("returns a non-empty extension for .pyi", () => {
    expect(languageForFile("stub.pyi")).toHaveLength(1);
  });

  it("returns a non-empty extension for .yaml", () => {
    expect(languageForFile("schedule.yaml")).toHaveLength(1);
  });

  it("returns a non-empty extension for .yml", () => {
    expect(languageForFile("schedule.yml")).toHaveLength(1);
  });

  it("matches case-insensitively (.JSON)", () => {
    expect(languageForFile("CONFIG.JSON")).toHaveLength(1);
  });

  it("matches the trailing extension on a nested path", () => {
    expect(
      languageForFile("skills/crm-dashboard/references/thinkwork-runbook.json"),
    ).toHaveLength(1);
  });

  it("ignores leading directories with dots (foo.bar/baz)", () => {
    // "baz" has no extension — should return [].
    expect(languageForFile("foo.bar/baz")).toEqual([]);
  });

  it("returns a different extension for .py than for .json", () => {
    const py = languageForFile("a.py");
    const js = languageForFile("a.json");
    expect(py[0]).not.toBe(js[0]);
  });
});
