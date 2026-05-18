import { describe, it, expect } from "vitest";
import { Command } from "commander";

import { registerTenantCommand } from "../src/commands/tenant.js";

describe("tenant command registration", () => {
  it("registers `tenant` with list, get, create, update, settings", () => {
    const program = new Command();
    registerTenantCommand(program);

    const tenant = program.commands.find((c) => c.name() === "tenant");
    expect(tenant, "tenant command is registered").toBeTruthy();

    const subNames = tenant!.commands.map((c) => c.name());
    expect(subNames).toEqual(
      expect.arrayContaining(["list", "get", "create", "update", "settings"]),
    );
  });

  it("tenant settings has `get` and `set` subcommands", () => {
    const program = new Command();
    registerTenantCommand(program);
    const settings = program.commands
      .find((c) => c.name() === "tenant")!
      .commands.find((c) => c.name() === "settings")!;
    expect(settings, "settings group is registered").toBeTruthy();
    const subNames = settings.commands.map((c) => c.name());
    expect(subNames).toEqual(expect.arrayContaining(["get", "set"]));
  });

  it("tenant create carries --slug, --plan (default 'team'), --issue-prefix", () => {
    const program = new Command();
    registerTenantCommand(program);
    const create = program.commands
      .find((c) => c.name() === "tenant")!
      .commands.find((c) => c.name() === "create")!;
    const planOpt = create.options.find((o) => o.long === "--plan");
    expect(planOpt?.defaultValue).toBe("team");
    expect(create.helpInformation()).toMatch(/--slug/);
    expect(create.helpInformation()).toMatch(/--issue-prefix/);
  });

  it("tenant settings set carries the full flag set", () => {
    const program = new Command();
    registerTenantCommand(program);
    const setCmd = program.commands
      .find((c) => c.name() === "tenant")!
      .commands.find((c) => c.name() === "settings")!
      .commands.find((c) => c.name() === "set")!;
    const help = setCmd.helpInformation();
    expect(help).toMatch(/--default-model/);
    expect(help).toMatch(/--monthly-budget-usd/);
    expect(help).toMatch(/--max-agents/);
    expect(help).toMatch(/--auto-close-after-days/);
    expect(help).toMatch(/--feature/);
  });

  it("alias `tenants` resolves to the same command", () => {
    const program = new Command();
    registerTenantCommand(program);
    const cmd = program.commands.find((c) => c.name() === "tenant")!;
    expect(cmd.aliases()).toContain("tenants");
  });
});
