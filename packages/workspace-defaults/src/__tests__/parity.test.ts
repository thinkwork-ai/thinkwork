/**
 * Parity tests for workspace-defaults.
 *
 * The canonical files are exported as inline TypeScript string constants
 * from `src/index.ts` (so the Lambda bundle is self-contained). The
 * authoritative content lives as source-controlled `.md` files under this
 * package's own `files/` subdirectory. Plan §008 U2 consolidated the old split
 * seed packages here; U28 removed those packages; U3 added `AGENTS.md` +
 * `CONTEXT.md` to the canonical set.
 *
 * This test asserts byte-for-byte equality between the inline constants and
 * the `.md` authoring sources, so a change in one without the other is
 * caught immediately.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_FILE_NAMES,
  DEFAULTS_VERSION,
  loadDefaults,
  loadFile,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..", "..");

const LOCAL_FILES_DIR = join(PACKAGE_ROOT, "files");

// Map canonical name -> absolute path of its authoritative source file.
const AUTHORITATIVE_SOURCES: Record<string, string> = Object.fromEntries(
  CANONICAL_FILE_NAMES.map((name) => [
    name,
    join(LOCAL_FILES_DIR, ...name.split("/")),
  ]),
);

describe("workspace-defaults parity", () => {
  it("exports exactly the canonical file names", () => {
    expect([...CANONICAL_FILE_NAMES].sort()).toEqual(
      Object.keys(AUTHORITATIVE_SOURCES).sort(),
    );
  });

  it("loadDefaults() returns all canonical files", () => {
    const loaded = loadDefaults();
    expect(Object.keys(loaded).sort()).toEqual(
      [...CANONICAL_FILE_NAMES].sort(),
    );
  });

  it("rejects retired legacy default files", () => {
    expect(() => loadFile("SOUL.md" as never)).toThrow(
      "Unknown workspace default file: SOUL.md",
    );
  });

  it.each(CANONICAL_FILE_NAMES)(
    "content for %s matches its authoritative .md source byte-for-byte",
    (name) => {
      const inline = loadDefaults()[name];
      const authoritative = readFileSync(AUTHORITATIVE_SOURCES[name], "utf8");
      expect(inline).toEqual(authoritative);
    },
  );

  it("includes deployment bypass guardrails in the default policy", () => {
    expect(loadDefaults()["GUARDRAILS.md"]).toContain(
      "Do not deploy, release, publish, migrate, or promote production changes outside",
    );
    expect(loadDefaults()["GUARDRAILS.md"]).toContain(
      "Do not suggest console, dashboard, local CLI, direct API, or other one-off",
    );
  });

  it("does not materialize upstream json-render runtime skills in workspace defaults", () => {
    const defaults = loadDefaults();
    const fileNames = Object.keys(defaults);
    const combined = Object.values(defaults).join("\n");

    expect(DEFAULTS_VERSION).toBe(27);
    expect(fileNames).not.toContain("skills/json-render/SKILL.md");
    expect(fileNames).not.toContain("skills/a2ui/SKILL.md");
    expect(fileNames).not.toContain("skills/ag-ui/SKILL.md");
    expect(combined).not.toContain("emit_json_render_ui");
    expect(combined).not.toContain("@json-render");
    expect(combined).toContain(
      "Upstream json-render developer skills are not runtime workspace skills",
    );
  });
});
