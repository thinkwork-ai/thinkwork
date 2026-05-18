import { describe, it, expect } from "vitest";
import { Command } from "commander";

import { registerKbCommand } from "../src/commands/kb.js";

describe("kb command registration", () => {
  it("registers `kb` with all 8 subcommands", () => {
    const program = new Command();
    registerKbCommand(program);

    const kb = program.commands.find((c) => c.name() === "kb");
    expect(kb, "kb command is registered").toBeTruthy();

    const subNames = kb!.commands.map((c) => c.name());
    expect(subNames).toEqual(
      expect.arrayContaining([
        "list",
        "get",
        "create",
        "update",
        "delete",
        "sync",
        "attach",
        "detach",
      ]),
    );
  });

  it("kb create carries --s3-uri, --description, --embedding-model", () => {
    const program = new Command();
    registerKbCommand(program);
    const create = program.commands
      .find((c) => c.name() === "kb")!
      .commands.find((c) => c.name() === "create")!;
    const help = create.helpInformation();
    expect(help).toMatch(/--s3-uri/);
    expect(help).toMatch(/--description/);
    expect(help).toMatch(/--embedding-model/);
  });

  it("kb sync carries --wait", () => {
    const program = new Command();
    registerKbCommand(program);
    const sync = program.commands
      .find((c) => c.name() === "kb")!
      .commands.find((c) => c.name() === "sync")!;
    expect(sync.helpInformation()).toMatch(/--wait/);
  });

  it("kb attach/detach carry --agent", () => {
    const program = new Command();
    registerKbCommand(program);
    const kb = program.commands.find((c) => c.name() === "kb")!;
    for (const name of ["attach", "detach"]) {
      const cmd = kb.commands.find((c) => c.name() === name)!;
      expect(cmd.helpInformation(), `${name} carries --agent`).toMatch(/--agent/);
    }
  });

  it("kb delete carries --yes (destructive verb)", () => {
    const program = new Command();
    registerKbCommand(program);
    const del = program.commands
      .find((c) => c.name() === "kb")!
      .commands.find((c) => c.name() === "delete")!;
    expect(del.helpInformation()).toMatch(/--yes/);
  });

  it("alias `knowledge-base` resolves to the same command", () => {
    const program = new Command();
    registerKbCommand(program);
    const cmd = program.commands.find((c) => c.name() === "kb")!;
    expect(cmd.aliases()).toContain("knowledge-base");
  });
});
