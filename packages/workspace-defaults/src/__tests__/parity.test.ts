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
import { CANONICAL_FILE_NAMES, loadDefaults } from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..", "..");

const LOCAL_FILES_DIR = join(PACKAGE_ROOT, "files");

// Map canonical name → absolute path of its authoritative .md source.
const AUTHORITATIVE_SOURCES: Record<string, string> = {
  "SOUL.md": join(LOCAL_FILES_DIR, "SOUL.md"),
  "IDENTITY.md": join(LOCAL_FILES_DIR, "IDENTITY.md"),
  "USER.md": join(LOCAL_FILES_DIR, "USER.md"),
  "AGENTS.md": join(LOCAL_FILES_DIR, "AGENTS.md"),
  "CONTEXT.md": join(LOCAL_FILES_DIR, "CONTEXT.md"),
  "GUARDRAILS.md": join(LOCAL_FILES_DIR, "GUARDRAILS.md"),
  "MEMORY_GUIDE.md": join(LOCAL_FILES_DIR, "MEMORY_GUIDE.md"),
  "CAPABILITIES.md": join(LOCAL_FILES_DIR, "CAPABILITIES.md"),
  "PLATFORM.md": join(LOCAL_FILES_DIR, "PLATFORM.md"),
  "ROUTER.md": join(LOCAL_FILES_DIR, "ROUTER.md"),
  "memory/lessons.md": join(LOCAL_FILES_DIR, "memory", "lessons.md"),
  "memory/preferences.md": join(LOCAL_FILES_DIR, "memory", "preferences.md"),
  "memory/contacts.md": join(LOCAL_FILES_DIR, "memory", "contacts.md"),
  "skills/.gitkeep": join(LOCAL_FILES_DIR, "skills", ".gitkeep"),
  "skills/artifact-builder/SKILL.md": join(
    LOCAL_FILES_DIR,
    "skills",
    "artifact-builder",
    "SKILL.md",
  ),
  "skills/artifact-builder/references/crm-dashboard.md": join(
    LOCAL_FILES_DIR,
    "skills",
    "artifact-builder",
    "references",
    "crm-dashboard.md",
  ),
};

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
});
