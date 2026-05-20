import { describe, it, expect } from "vitest";
import { Command } from "commander";

import { registerAgentCommand } from "../src/commands/agent.js";

describe("agent command registration", () => {
  it("registers `agent` with the root verbs", () => {
    const program = new Command();
    registerAgentCommand(program);

    const agent = program.commands.find((c) => c.name() === "agent");
    expect(agent, "agent command is registered").toBeTruthy();

    const subNames = agent!.commands.map((c) => c.name());
    expect(subNames).toEqual(
      expect.arrayContaining([
        "list",
        "get",
        "create",
        "update",
        "delete",
        "status",
        "unpause",
        "capabilities",
        "skills",
        "budget",
        "api-key",
        "email",
      ]),
    );
  });

  it("agent capabilities + skills + budget + api-key + email all have their subcommands", () => {
    const program = new Command();
    registerAgentCommand(program);
    const agent = program.commands.find((c) => c.name() === "agent")!;
    const groups: Array<[string, string[]]> = [
      ["capabilities", ["set"]],
      ["skills", ["set"]],
      ["budget", ["set", "clear"]],
      ["api-key", ["list", "create", "revoke"]],
      ["email", ["enable", "disable", "allowlist"]],
    ];
    for (const [group, subs] of groups) {
      const g = agent.commands.find((c) => c.name() === group);
      expect(g, `subgroup ${group} exists`).toBeTruthy();
      const have = g!.commands.map((c) => c.name());
      expect(have, `${group} has ${subs.join("/")}`).toEqual(
        expect.arrayContaining(subs),
      );
    }
  });

  it("agent create carries --type and prompt overrides", () => {
    const program = new Command();
    registerAgentCommand(program);
    const create = program.commands
      .find((c) => c.name() === "agent")!
      .commands.find((c) => c.name() === "create")!;
    const help = create.helpInformation();
    expect(help).not.toMatch(/--template/);
    expect(help).toMatch(/--type/);
    expect(help).toMatch(/--system-prompt/);
  });

  it("destructive verbs (delete, api-key revoke) all carry --yes", () => {
    const program = new Command();
    registerAgentCommand(program);
    const agent = program.commands.find((c) => c.name() === "agent")!;

    const del = agent.commands.find((c) => c.name() === "delete")!;
    expect(del.helpInformation()).toMatch(/--yes/);

    const apiKey = agent.commands.find((c) => c.name() === "api-key")!;
    const revoke = apiKey.commands.find((c) => c.name() === "revoke")!;
    expect(revoke.helpInformation()).toMatch(/--yes/);
  });

  it("budget set has --limit-usd, --window, --action with sane defaults", () => {
    const program = new Command();
    registerAgentCommand(program);
    const set = program.commands
      .find((c) => c.name() === "agent")!
      .commands.find((c) => c.name() === "budget")!
      .commands.find((c) => c.name() === "set")!;
    const windowOpt = set.options.find((o) => o.long === "--window");
    expect(windowOpt?.defaultValue).toBe("monthly");
    const actionOpt = set.options.find((o) => o.long === "--action");
    expect(actionOpt?.defaultValue).toBe("PAUSE");
    expect(set.helpInformation()).toMatch(/--limit-usd/);
  });

  it("alias `agents` resolves to the same command", () => {
    const program = new Command();
    registerAgentCommand(program);
    const cmd = program.commands.find((c) => c.name() === "agent")!;
    expect(cmd.aliases()).toContain("agents");
  });
});
