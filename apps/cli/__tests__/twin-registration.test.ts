import { describe, it, expect } from "vitest";
import { Command } from "commander";

import { registerTwinCommand } from "../src/commands/twin.js";

describe("twin command registration", () => {
  it("registers `twin` with the install subcommand", () => {
    const program = new Command();
    registerTwinCommand(program);

    const twin = program.commands.find((c) => c.name() === "twin");
    expect(twin, "twin command is registered").toBeTruthy();
    expect(twin!.commands.map((c) => c.name())).toContain("install");
  });

  it("twin install carries the expected flags", () => {
    const program = new Command();
    registerTwinCommand(program);
    const install = program.commands
      .find((c) => c.name() === "twin")!
      .commands.find((c) => c.name() === "install")!;
    const help = install.helpInformation();
    expect(help).toMatch(/--stage/);
    expect(help).toMatch(/--tenant/);
    expect(help).toMatch(/--etl-repo-dir/);
    expect(help).toMatch(/--etl-account/);
    expect(help).toMatch(/--rotate/);
    expect(help).toMatch(/--allow-changes/);
    expect(help).toMatch(/--dry-run/);
  });

  it("help names thinkwork-ai/company-brain as the etl repo (U8)", () => {
    const program = new Command();
    registerTwinCommand(program);
    const install = program.commands
      .find((c) => c.name() === "twin")!
      .commands.find((c) => c.name() === "install")!;
    const help = install.helpInformation();
    expect(help).toMatch(/thinkwork-ai\/company-brain/);
  });
});
