import { describe, it, expect } from "vitest";
import { Command } from "commander";

import { registerInboxCommand } from "../src/commands/inbox.js";

describe("inbox command registration", () => {
  it("registers `inbox` with all 8 subcommands", () => {
    const program = new Command();
    registerInboxCommand(program);

    const inbox = program.commands.find((c) => c.name() === "inbox");
    expect(inbox, "inbox command is registered").toBeTruthy();
    expect(inbox!.description()).toMatch(/approval requests/i);

    const subNames = inbox!.commands.map((c) => c.name());
    expect(subNames).toEqual(
      expect.arrayContaining([
        "list",
        "get",
        "approve",
        "reject",
        "request-revision",
        "resubmit",
        "cancel",
        "comment",
      ]),
    );
  });

  it("inbox list carries --status, --entity-type, --entity-id, --mine", () => {
    const program = new Command();
    registerInboxCommand(program);
    const list = program.commands
      .find((c) => c.name() === "inbox")!
      .commands.find((c) => c.name() === "list")!;
    const help = list.helpInformation();
    expect(help).toMatch(/--status/);
    expect(help).toMatch(/--entity-type/);
    expect(help).toMatch(/--entity-id/);
    expect(help).toMatch(/--mine/);
  });

  it("inbox list defaults --status to PENDING", () => {
    const program = new Command();
    registerInboxCommand(program);
    const list = program.commands
      .find((c) => c.name() === "inbox")!
      .commands.find((c) => c.name() === "list")!;
    const statusOpt = list.options.find((o) => o.long === "--status");
    expect(statusOpt?.defaultValue).toBe("PENDING");
  });

  it("inbox approve and reject both carry --notes", () => {
    const program = new Command();
    registerInboxCommand(program);
    const inbox = program.commands.find((c) => c.name() === "inbox")!;
    for (const name of ["approve", "reject", "request-revision", "resubmit"]) {
      const cmd = inbox.commands.find((c) => c.name() === name)!;
      expect(cmd.helpInformation(), `${name} carries --notes`).toMatch(/--notes/);
    }
  });

  it("inbox comment carries --file", () => {
    const program = new Command();
    registerInboxCommand(program);
    const comment = program.commands
      .find((c) => c.name() === "inbox")!
      .commands.find((c) => c.name() === "comment")!;
    expect(comment.helpInformation()).toMatch(/--file/);
  });
});
