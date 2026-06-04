import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { registerSkillCommand } from "../src/commands/skill.js";

// Structural test: the behavior-bearing logic (auth gating, rescan) is tested
// server-side (rebuildSkillCatalogIndex.mutation.test.ts) and in the
// catalog-index library. Here we just guard the CLI wiring — that
// `skill catalog rebuild` exists with the flags operators rely on.

function findSubcommand(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

describe("thinkwork skill catalog rebuild (wiring)", () => {
  const program = new Command();
  registerSkillCommand(program);
  const skill = findSubcommand(program, "skill");
  const catalog = skill && findSubcommand(skill, "catalog");
  const rebuild = catalog && findSubcommand(catalog, "rebuild");

  it("registers the catalog rebuild subcommand", () => {
    expect(skill).toBeDefined();
    expect(catalog).toBeDefined();
    expect(rebuild).toBeDefined();
  });

  it("exposes the operator flags (--tenant, --all, --dry-run, --yes, --stage)", () => {
    const flags = (rebuild as Command).options.map((o) => o.long);
    expect(flags).toEqual(
      expect.arrayContaining([
        "--tenant",
        "--all",
        "--dry-run",
        "--yes",
        "--stage",
      ]),
    );
  });
});
