/**
 * Reserved folder names — Plan §008 U8.
 *
 * The constant exists so the recursive composer, the AGENTS.md routing
 * parser, and the bundle importer all reject the same folder names
 * without redeclaring the list. These tests lock in the canonical set,
 * its consumption pattern, and the AE7 acceptance behaviour (`memory/`
 * `skills/`, and `workspaces/` cannot be addressed as sub-agents at
 * any depth).
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RESERVED_FOLDER_NAMES,
  isReservedFolderSegment,
} from "../lib/reserved-folder-names.js";
import { parseAgentsMd } from "../lib/agents-md-parser.js";
import { buildWorkspaceAncestorPaths } from "../lib/workspace-overlay.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("RESERVED_FOLDER_NAMES — canonical set", () => {
  it("locks the canonical set to memory + skills + workspaces", () => {
    expect(Array.from(RESERVED_FOLDER_NAMES).sort()).toEqual([
      "memory",
      "skills",
      "workspaces",
    ]);
  });

  it("is a ReadonlySet at the type level (mutators are absent)", () => {
    // The Set runtime exposes add/delete; the export type is ReadonlySet
    // so callers can't accidentally mutate it through the public surface.
    // This test asserts the runtime instance is a Set (not an Array, not
    // undefined) — the type-level guarantee is verified by tsc.
    expect(RESERVED_FOLDER_NAMES).toBeInstanceOf(Set);
  });
});

describe("isReservedFolderSegment", () => {
  it("matches each canonical name with no trailing slash", () => {
    expect(isReservedFolderSegment("memory")).toBe(true);
    expect(isReservedFolderSegment("skills")).toBe(true);
    expect(isReservedFolderSegment("workspaces")).toBe(true);
  });

  it("does not match arbitrary folder names", () => {
    for (const name of [
      "expenses",
      "support",
      "escalation",
      "agents",
      "workflow",
      "",
    ]) {
      expect(isReservedFolderSegment(name)).toBe(false);
    }
  });

  it("treats trailing-slash forms as the caller's responsibility", () => {
    // The helper expects callers to strip a trailing slash first; an
    // unstripped value must not accidentally pass.
    expect(isReservedFolderSegment("memory/")).toBe(false);
    expect(isReservedFolderSegment("skills/")).toBe(false);
    expect(isReservedFolderSegment("workspaces/")).toBe(false);
  });

  it("is case-sensitive — uppercase variants are not reserved", () => {
    // Folder paths in the FOG / Fat layout are lower-kebab; uppercase
    // variants are operator-authored sub-agents that happen to share
    // a stem and should not be silently dropped.
    expect(isReservedFolderSegment("Memory")).toBe(false);
    expect(isReservedFolderSegment("SKILLS")).toBe(false);
    expect(isReservedFolderSegment("Workspaces")).toBe(false);
  });
});

describe("parseAgentsMd integration with reserved names", () => {
  it("rejects bare 'memory' as a sub-agent goTo (AE7)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const md = `## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Hidden mem | memory | memory/CONTEXT.md | x |
| Real | expenses/ | expenses/CONTEXT.md | x |
`;
    const result = parseAgentsMd(md);
    expect(result.routing).toHaveLength(1);
    expect(result.routing[0].goTo).toBe("expenses/");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("rejects 'skills/' (trailing slash form) as a sub-agent goTo (AE7)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const md = `## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Hidden skill | skills/ | skills/CONTEXT.md | x |
| Real | expenses/ | expenses/CONTEXT.md | x |
`;
    const result = parseAgentsMd(md);
    expect(result.routing).toHaveLength(1);
    expect(result.routing[0].goTo).toBe("expenses/");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("emits one warning per reserved row when both appear together", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const md = `## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Hidden mem | memory | memory/CONTEXT.md | x |
| Hidden skill | skills/ | skills/CONTEXT.md | x |
| Real | expenses/ | expenses/CONTEXT.md | x |
`;
    const result = parseAgentsMd(md);
    expect(result.routing).toHaveLength(1);
    expect(result.routing[0].goTo).toBe("expenses/");
    // Each rejected row gets its own warning so the operator can see
    // which row(s) the parser dropped, not a single rolled-up message.
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("rejects root 'workspaces/' as a sub-agent goTo while allowing nested workspace folders", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const md = `## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Hidden parent | workspaces/ | workspaces/CONTEXT.md | x |
| Real | workspaces/expenses/ | workspaces/expenses/CONTEXT.md | x |
`;
    const result = parseAgentsMd(md);
    expect(result.routing).toHaveLength(1);
    expect(result.routing[0].goTo).toBe("workspaces/expenses/");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("constant centralisation invariant", () => {
  it("workspace-overlay keeps pin inheritance boundaries narrower than reserved sub-agent names", () => {
    expect(
      buildWorkspaceAncestorPaths("workspaces/expenses/GUARDRAILS.md"),
    ).toEqual([
      "workspaces/expenses/GUARDRAILS.md",
      "workspaces/GUARDRAILS.md",
      "GUARDRAILS.md",
    ]);
    expect(buildWorkspaceAncestorPaths("memory/GUARDRAILS.md")).toEqual([
      "memory/GUARDRAILS.md",
    ]);

    const file = readFileSync(
      resolve(__dirname, "../lib/workspace-overlay.ts"),
      "utf8",
    );
    expect(file).not.toContain('from "./reserved-folder-names.js"');
    expect(file).not.toMatch(/const\s+RESERVED_FOLDER_NAMES\s*=/);
  });

  it("agents-md-parser imports from the shared module", () => {
    const file = readFileSync(
      resolve(__dirname, "../lib/agents-md-parser.ts"),
      "utf8",
    );
    expect(file).toContain(
      'import { RESERVED_FOLDER_NAMES } from "./reserved-folder-names.js"',
    );
    // No inlined literal left over from U6 — every `RESERVED_FOLDER_NAMES`
    // reference must come from the imported binding, not a local const.
    expect(file).not.toMatch(/const\s+RESERVED_FOLDER_NAMES\b/);
    // The parser still has to actually consult the set somewhere.
    expect(file).toMatch(/RESERVED_FOLDER_NAMES\.has\(/);
  });

  it("Python mirror declares the same set", () => {
    const file = readFileSync(
      resolve(
        __dirname,
        "../../../agentcore/agent-container/agents_md_parser.py",
      ),
      "utf8",
    );
    // The Python frozenset is the runtime mirror; this assertion
    // guards against a drift where the TS side adds a name and the
    // Python side falls behind.
    for (const name of RESERVED_FOLDER_NAMES) {
      expect(file).toContain(`"${name}"`);
    }
    expect(file).toMatch(/RESERVED_FOLDER_NAMES\s*:\s*frozenset/);
  });
});
