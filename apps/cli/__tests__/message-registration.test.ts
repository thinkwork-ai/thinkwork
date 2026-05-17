import { describe, it, expect } from "vitest";
import { Command } from "commander";

import { registerMessageCommand } from "../src/commands/message.js";

describe("message command registration", () => {
  it("registers `message` with `send` and `list`", () => {
    const program = new Command();
    registerMessageCommand(program);

    const msg = program.commands.find((c) => c.name() === "message");
    expect(msg, "message command is registered").toBeTruthy();
    expect(msg!.description()).toMatch(/inside a thread/i);

    const subNames = msg!.commands.map((c) => c.name());
    expect(subNames).toEqual(expect.arrayContaining(["send", "list"]));
  });

  it("message send carries --file and --as-agent flags", () => {
    const program = new Command();
    registerMessageCommand(program);
    const send = program.commands
      .find((c) => c.name() === "message")!
      .commands.find((c) => c.name() === "send")!;
    const help = send.helpInformation();
    expect(help).toMatch(/--file/);
    expect(help).toMatch(/--as-agent/);
  });

  it("message list carries --limit and --cursor", () => {
    const program = new Command();
    registerMessageCommand(program);
    const list = program.commands
      .find((c) => c.name() === "message")!
      .commands.find((c) => c.name() === "list")!;
    const help = list.helpInformation();
    expect(help).toMatch(/--limit/);
    expect(help).toMatch(/--cursor/);
  });

  it("aliases `messages` and `msg` resolve to the same command", () => {
    const program = new Command();
    registerMessageCommand(program);
    const cmd = program.commands.find((c) => c.name() === "message")!;
    expect(cmd.aliases()).toEqual(expect.arrayContaining(["messages", "msg"]));
  });
});
