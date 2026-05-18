import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { registerEnterpriseCommand } from "../src/commands/enterprise.js";

describe("enterprise command registration", () => {
  it("exposes enterprise bootstrap without required options", () => {
    const program = new Command();
    program.name("thinkwork");
    registerEnterpriseCommand(program);

    const enterprise = program.commands.find(
      (cmd) => cmd.name() === "enterprise",
    );
    expect(enterprise).toBeDefined();
    const bootstrap = enterprise?.commands.find(
      (cmd) => cmd.name() === "bootstrap",
    );
    expect(bootstrap).toBeDefined();
    expect(bootstrap?.options.filter((option) => option.mandatory)).toEqual([]);
  });
});
