/**
 * Parity tests for workspace-defaults.
 *
 * The 11 canonical files are exported as inline TypeScript string constants
 * from `src/index.ts` (so the Lambda bundle is self-contained). But the
 * authoritative content for those files lives in source-controlled `.md`
 * files — either in the two pre-existing content packages
 * (`packages/system-workspace/`, `packages/memory-templates/`) or, for the
 * 4 files authored in this package (ROUTER.md + the three `memory/` stubs),
 * in this package's own `files/` subdirectory.
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
const MONOREPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");

const SYSTEM_WORKSPACE_DIR = join(MONOREPO_ROOT, "packages", "system-workspace");
const MEMORY_TEMPLATES_DIR = join(MONOREPO_ROOT, "packages", "memory-templates");
const LOCAL_FILES_DIR = join(PACKAGE_ROOT, "files");

// Map canonical name → absolute path of its authoritative .md source.
const AUTHORITATIVE_SOURCES: Record<string, string> = {
	"SOUL.md": join(MEMORY_TEMPLATES_DIR, "SOUL.md"),
	"IDENTITY.md": join(MEMORY_TEMPLATES_DIR, "IDENTITY.md"),
	"USER.md": join(MEMORY_TEMPLATES_DIR, "USER.md"),
	"GUARDRAILS.md": join(SYSTEM_WORKSPACE_DIR, "GUARDRAILS.md"),
	"MEMORY_GUIDE.md": join(SYSTEM_WORKSPACE_DIR, "MEMORY_GUIDE.md"),
	"CAPABILITIES.md": join(SYSTEM_WORKSPACE_DIR, "CAPABILITIES.md"),
	"PLATFORM.md": join(SYSTEM_WORKSPACE_DIR, "PLATFORM.md"),
	"ROUTER.md": join(LOCAL_FILES_DIR, "ROUTER.md"),
	"memory/lessons.md": join(LOCAL_FILES_DIR, "memory", "lessons.md"),
	"memory/preferences.md": join(LOCAL_FILES_DIR, "memory", "preferences.md"),
	"memory/contacts.md": join(LOCAL_FILES_DIR, "memory", "contacts.md"),
};

describe("workspace-defaults parity", () => {
	it("exports exactly the 11 canonical file names", () => {
		expect([...CANONICAL_FILE_NAMES].sort()).toEqual(
			Object.keys(AUTHORITATIVE_SOURCES).sort(),
		);
	});

	it("loadDefaults() returns all 11 canonical files", () => {
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
});
