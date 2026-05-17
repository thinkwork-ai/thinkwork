import { describe, it, expect } from "vitest";
import { Command } from "commander";

import { registerTeamCommand } from "../src/commands/team.js";

describe("team command registration", () => {
  it("registers `team` with all 9 subcommands", () => {
    const program = new Command();
    registerTeamCommand(program);

    const team = program.commands.find((c) => c.name() === "team");
    expect(team, "team command is registered").toBeTruthy();
    expect(team!.description()).toMatch(/teams within a tenant/i);

    const subNames = team!.commands.map((c) => c.name());
    expect(subNames).toEqual(
      expect.arrayContaining([
        "list",
        "get",
        "create",
        "update",
        "delete",
        "add-agent",
        "remove-agent",
        "add-user",
        "remove-user",
      ]),
    );
  });

  it("team create carries --description and --budget-usd flags", () => {
    const program = new Command();
    registerTeamCommand(program);
    const create = program.commands
      .find((c) => c.name() === "team")!
      .commands.find((c) => c.name() === "create")!;
    const help = create.helpInformation();
    expect(help).toMatch(/--description/);
    expect(help).toMatch(/--budget-usd/);
  });

  it("team delete carries --yes (destructive verb)", () => {
    const program = new Command();
    registerTeamCommand(program);
    const del = program.commands
      .find((c) => c.name() === "team")!
      .commands.find((c) => c.name() === "delete")!;
    expect(del.helpInformation()).toMatch(/--yes/);
  });

  it("alias `teams` resolves to the same command", () => {
    const program = new Command();
    registerTeamCommand(program);
    const cmd = program.commands.find((c) => c.name() === "team")!;
    expect(cmd.aliases()).toContain("teams");
  });
});
