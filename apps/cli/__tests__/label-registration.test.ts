import { describe, it, expect } from "vitest";
import { Command } from "commander";

import { registerLabelCommand } from "../src/commands/label.js";

describe("label command registration", () => {
  it("registers `label` with list, create, update, delete", () => {
    const program = new Command();
    registerLabelCommand(program);

    const label = program.commands.find((c) => c.name() === "label");
    expect(label, "label command is registered").toBeTruthy();
    expect(label!.description()).toMatch(/tenant-wide thread labels/i);

    const subNames = label!.commands.map((c) => c.name());
    expect(subNames).toEqual(
      expect.arrayContaining(["list", "create", "update", "delete"]),
    );
  });

  it("label create carries --color and --description flags", () => {
    const program = new Command();
    registerLabelCommand(program);
    const create = program.commands
      .find((c) => c.name() === "label")!
      .commands.find((c) => c.name() === "create")!;
    const help = create.helpInformation();
    expect(help).toMatch(/--color/);
    expect(help).toMatch(/--description/);
  });

  it("label delete carries --yes (destructive verb)", () => {
    const program = new Command();
    registerLabelCommand(program);
    const del = program.commands
      .find((c) => c.name() === "label")!
      .commands.find((c) => c.name() === "delete")!;
    const help = del.helpInformation();
    expect(help).toMatch(/--yes/);
  });

  it("alias `labels` resolves to the same command", () => {
    const program = new Command();
    registerLabelCommand(program);
    const cmd = program.commands.find((c) => c.name() === "label")!;
    expect(cmd.aliases()).toContain("labels");
  });
});
