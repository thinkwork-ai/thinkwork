import { describe, it, expect } from "vitest";
import { Command } from "commander";

import { registerTemplateCommand } from "../src/commands/template.js";

describe("template command registration", () => {
  it("registers `template` with all 8 subcommands", () => {
    const program = new Command();
    registerTemplateCommand(program);

    const tpl = program.commands.find((c) => c.name() === "template");
    expect(tpl, "template command is registered").toBeTruthy();

    const subNames = tpl!.commands.map((c) => c.name());
    expect(subNames).toEqual(
      expect.arrayContaining([
        "list",
        "get",
        "create",
        "update",
        "delete",
        "diff",
        "sync-agent",
        "sync-all",
      ]),
    );
  });

  it("template create carries --from-agent, --model, --description, --system-prompt-file", () => {
    const program = new Command();
    registerTemplateCommand(program);
    const create = program.commands
      .find((c) => c.name() === "template")!
      .commands.find((c) => c.name() === "create")!;
    const help = create.helpInformation();
    expect(help).toMatch(/--from-agent/);
    expect(help).toMatch(/--model/);
    expect(help).toMatch(/--description/);
    expect(help).toMatch(/--system-prompt-file/);
  });

  it("template delete + sync-agent + sync-all all carry --yes", () => {
    const program = new Command();
    registerTemplateCommand(program);
    const tpl = program.commands.find((c) => c.name() === "template")!;
    for (const name of ["delete", "sync-agent", "sync-all"]) {
      const cmd = tpl.commands.find((c) => c.name() === name)!;
      expect(cmd.helpInformation(), `${name} carries --yes`).toMatch(/--yes/);
    }
  });

  it("alias `templates` resolves to the same command", () => {
    const program = new Command();
    registerTemplateCommand(program);
    const cmd = program.commands.find((c) => c.name() === "template")!;
    expect(cmd.aliases()).toContain("templates");
  });
});
