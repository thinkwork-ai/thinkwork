import { describe, it, expect } from "vitest";
import { Command } from "commander";

import { registerTurnCommand } from "../src/commands/turn.js";
import { registerWakeupCommand } from "../src/commands/wakeup.js";
import { registerScheduledJobCommand } from "../src/commands/scheduled-job.js";
import { registerWebhookCommand } from "../src/commands/webhook.js";
import { registerRoutineCommand } from "../src/commands/routine.js";
import { registerSkillCommand } from "../src/commands/skill.js";

describe("Phase 3 command registration", () => {
  it("turn: list / get / cancel", () => {
    const program = new Command();
    registerTurnCommand(program);
    const cmd = program.commands.find((c) => c.name() === "turn")!;
    expect(cmd).toBeTruthy();
    expect(cmd.commands.map((c) => c.name())).toEqual(
      expect.arrayContaining(["list", "get", "cancel"]),
    );
  });

  it("wakeup: list / create", () => {
    const program = new Command();
    registerWakeupCommand(program);
    const cmd = program.commands.find((c) => c.name() === "wakeup")!;
    expect(cmd).toBeTruthy();
    expect(cmd.commands.map((c) => c.name())).toEqual(
      expect.arrayContaining(["list", "create"]),
    );
  });

  it("scheduled-job: list / get / create / update / delete / run", () => {
    const program = new Command();
    registerScheduledJobCommand(program);
    const cmd = program.commands.find((c) => c.name() === "scheduled-job")!;
    expect(cmd).toBeTruthy();
    expect(cmd.commands.map((c) => c.name())).toEqual(
      expect.arrayContaining(["list", "get", "create", "update", "delete", "run"]),
    );
  });

  it("webhook: list / get / create / update / delete / test / rotate / deliveries", () => {
    const program = new Command();
    registerWebhookCommand(program);
    const cmd = program.commands.find((c) => c.name() === "webhook")!;
    expect(cmd).toBeTruthy();
    expect(cmd.commands.map((c) => c.name())).toEqual(
      expect.arrayContaining([
        "list",
        "get",
        "create",
        "update",
        "delete",
        "test",
        "rotate",
        "deliveries",
      ]),
    );
  });

  it("routine: list / get / create / update / delete / trigger + run + trigger-config", () => {
    const program = new Command();
    registerRoutineCommand(program);
    const cmd = program.commands.find((c) => c.name() === "routine")!;
    expect(cmd).toBeTruthy();
    const subs = cmd.commands.map((c) => c.name());
    expect(subs).toEqual(
      expect.arrayContaining([
        "list",
        "get",
        "create",
        "update",
        "delete",
        "trigger",
        "run",
        "trigger-config",
      ]),
    );

    const run = cmd.commands.find((c) => c.name() === "run")!;
    expect(run.commands.map((c) => c.name())).toEqual(
      expect.arrayContaining(["list", "get"]),
    );

    const tc = cmd.commands.find((c) => c.name() === "trigger-config")!;
    expect(tc.commands.map((c) => c.name())).toEqual(
      expect.arrayContaining(["set", "delete"]),
    );
  });

  it("skill: catalog / list / install / upgrade / create / update / delete / push", () => {
    const program = new Command();
    registerSkillCommand(program);
    const cmd = program.commands.find((c) => c.name() === "skill")!;
    expect(cmd).toBeTruthy();
    expect(cmd.commands.map((c) => c.name())).toEqual(
      expect.arrayContaining([
        "catalog",
        "list",
        "install",
        "upgrade",
        "create",
        "update",
        "delete",
        "push",
      ]),
    );
  });

  it("destructive verbs across Phase 3 carry --yes", () => {
    const program = new Command();
    registerTurnCommand(program);
    registerScheduledJobCommand(program);
    registerWebhookCommand(program);
    registerRoutineCommand(program);
    registerSkillCommand(program);

    const checks: Array<[string, string[]]> = [
      ["turn", ["cancel"]],
      ["scheduled-job", ["delete"]],
      ["webhook", ["delete", "rotate"]],
      ["routine", ["delete"]],
      ["skill", ["delete"]],
    ];
    for (const [parent, verbs] of checks) {
      const p = program.commands.find((c) => c.name() === parent)!;
      for (const v of verbs) {
        const cmd = p.commands.find((c) => c.name() === v)!;
        expect(cmd.helpInformation(), `${parent} ${v} has --yes`).toMatch(/--yes/);
      }
    }
  });
});
