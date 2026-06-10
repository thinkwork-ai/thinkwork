/**
 * Graph-mode CLI surfaces (plan 2026-06-09-004 U14):
 *   - `wiki status` tolerates tenant-keyed (null-owner) job rows
 *   - `wiki compile` exposes --tenant-scope and documents the graph
 *     re-semantics; `wiki rebuild` documents the graph-mode rebuild note
 */

import { describe, it, expect } from "vitest";
import { Command } from "commander";

import { registerWikiCommand } from "../src/commands/wiki.js";
import { ownerColumnLabel } from "../src/commands/wiki/status.js";

describe("wiki status — tenant-keyed (null-owner) job rows", () => {
  const names = { "agent-1": "Eric's Agent" };

  it("renders null ownerId as 'tenant' instead of crashing", () => {
    expect(ownerColumnLabel(null, names)).toBe("tenant");
    expect(ownerColumnLabel(undefined, names)).toBe("tenant");
  });

  it("keeps named-agent and short-id rendering for owner-scoped jobs", () => {
    expect(ownerColumnLabel("agent-1", names)).toBe("Eric's Agent");
    expect(ownerColumnLabel("0123456789abcdef", names)).toBe("01234567");
  });
});

describe("wiki compile — graph-mode flags and help", () => {
  it("registers --tenant-scope on compile", () => {
    const program = new Command();
    registerWikiCommand(program);
    const compile = program.commands
      .find((c) => c.name() === "wiki")!
      .commands.find((c) => c.name() === "compile")!;
    const flags = compile.options.map((o) => o.long);
    expect(flags).toContain("--tenant-scope");
  });

  it("rebuild help carries the graph-mode rebuild note", () => {
    const program = new Command();
    registerWikiCommand(program);
    const rebuild = program.commands
      .find((c) => c.name() === "wiki")!
      .commands.find((c) => c.name() === "rebuild")!;
    // addHelpText("after", …) registers an afterHelp event listener whose
    // payload renders on --help. Fire it and capture the output.
    let rendered = "";
    rebuild.configureOutput({ writeOut: (s) => void (rendered += s) });
    rebuild.outputHelp({ error: false });
    expect(rendered).toMatch(/wiki source is graph/i);
    expect(rendered).toMatch(/Cognee graph full-rebuild/i);
  });
});
