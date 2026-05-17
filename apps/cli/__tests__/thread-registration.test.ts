import { describe, it, expect } from "vitest";
import { Command } from "commander";

import { registerThreadCommand } from "../src/commands/thread.js";
import { parseIdOrNumber } from "../src/commands/thread/helpers.js";

describe("thread command registration", () => {
  it("registers `thread` with all 10 subcommands", () => {
    const program = new Command();
    registerThreadCommand(program);

    const thread = program.commands.find((c) => c.name() === "thread");
    expect(thread, "thread command is registered").toBeTruthy();
    expect(thread!.description()).toMatch(/threads in a tenant/i);

    const subNames = thread!.commands.map((c) => c.name());
    expect(subNames).toEqual(
      expect.arrayContaining([
        "list",
        "get",
        "create",
        "update",
        "checkout",
        "release",
        "comment",
        "label",
        "escalate",
        "delegate",
        "delete",
      ]),
    );
  });

  it("every thread subcommand has a non-empty description", () => {
    const program = new Command();
    registerThreadCommand(program);
    const thread = program.commands.find((c) => c.name() === "thread")!;
    for (const cmd of thread.commands) {
      expect(cmd.description(), `${cmd.name()} description`).toBeTruthy();
    }
  });

  it("thread list carries --assignee, --agent, --search, --limit, --archived", () => {
    const program = new Command();
    registerThreadCommand(program);
    const list = program.commands
      .find((c) => c.name() === "thread")!
      .commands.find((c) => c.name() === "list")!;
    const help = list.helpInformation();
    expect(help).toMatch(/--assignee/);
    expect(help).toMatch(/--agent/);
    expect(help).toMatch(/--search/);
    expect(help).toMatch(/--limit/);
    expect(help).toMatch(/--archived/);
  });

  it("thread release carries --run-id (required by API)", () => {
    const program = new Command();
    registerThreadCommand(program);
    const release = program.commands
      .find((c) => c.name() === "thread")!
      .commands.find((c) => c.name() === "release")!;
    const help = release.helpInformation();
    expect(help).toMatch(/--run-id/);
  });

  it("thread delete carries --yes (destructive verb)", () => {
    const program = new Command();
    registerThreadCommand(program);
    const del = program.commands
      .find((c) => c.name() === "thread")!
      .commands.find((c) => c.name() === "delete")!;
    const help = del.helpInformation();
    expect(help).toMatch(/--yes/);
  });

  it("alias `threads` resolves to the same command", () => {
    const program = new Command();
    registerThreadCommand(program);
    const cmd = program.commands.find(
      (c) => c.name() === "thread" || c.aliases().includes("threads"),
    );
    expect(cmd).toBeTruthy();
    expect(cmd!.aliases()).toContain("threads");
  });
});

describe("parseIdOrNumber helper", () => {
  it("treats pure-integer input as a thread number", () => {
    expect(parseIdOrNumber("42")).toEqual({ kind: "number", number: 42 });
  });

  it("treats alphanumeric input as a thread ID", () => {
    expect(parseIdOrNumber("thr-abc123")).toEqual({ kind: "id", id: "thr-abc123" });
  });

  it("treats UUID input as a thread ID", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(parseIdOrNumber(uuid)).toEqual({ kind: "id", id: uuid });
  });
});
