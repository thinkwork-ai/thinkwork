import { describe, it, expect } from "vitest";
import { Command } from "commander";

import { registerMemberCommand } from "../src/commands/member.js";

describe("member command registration", () => {
  it("registers `member` with list, invite, update, remove", () => {
    const program = new Command();
    registerMemberCommand(program);

    const mem = program.commands.find((c) => c.name() === "member");
    expect(mem, "member command is registered").toBeTruthy();
    expect(mem!.description()).toMatch(/tenant members/i);

    const subNames = mem!.commands.map((c) => c.name());
    expect(subNames).toEqual(
      expect.arrayContaining(["list", "invite", "update", "remove"]),
    );
  });

  it("member list carries --principal-type and --role filters", () => {
    const program = new Command();
    registerMemberCommand(program);
    const list = program.commands
      .find((c) => c.name() === "member")!
      .commands.find((c) => c.name() === "list")!;
    const help = list.helpInformation();
    expect(help).toMatch(/--principal-type/);
    expect(help).toMatch(/--role/);
  });

  it("member invite carries --role (default member) and --name", () => {
    const program = new Command();
    registerMemberCommand(program);
    const invite = program.commands
      .find((c) => c.name() === "member")!
      .commands.find((c) => c.name() === "invite")!;
    const roleOpt = invite.options.find((o) => o.long === "--role");
    expect(roleOpt?.defaultValue).toBe("member");
    expect(invite.helpInformation()).toMatch(/--name/);
  });

  it("member remove carries --yes (destructive verb)", () => {
    const program = new Command();
    registerMemberCommand(program);
    const remove = program.commands
      .find((c) => c.name() === "member")!
      .commands.find((c) => c.name() === "remove")!;
    expect(remove.helpInformation()).toMatch(/--yes/);
  });

  it("alias `members` resolves to the same command", () => {
    const program = new Command();
    registerMemberCommand(program);
    const cmd = program.commands.find((c) => c.name() === "member")!;
    expect(cmd.aliases()).toContain("members");
  });
});
