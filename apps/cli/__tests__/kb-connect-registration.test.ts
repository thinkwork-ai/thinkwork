/**
 * `thinkwork kb connect` registration (external S3 KB source U5): the
 * connect subcommand exists with its bucket/prefix/filter flags, repeatable
 * --exclude/--include collectors accumulate, and sync gained a real --wait.
 */

import { describe, it, expect } from "vitest";
import { Command } from "commander";

import { registerKbCommand } from "../src/commands/kb.js";

function findKb(program: Command): Command {
  const kb = program.commands.find((c) => c.name() === "kb");
  expect(kb, "kb command is registered").toBeTruthy();
  return kb!;
}

describe("kb connect registration", () => {
  it("registers connect alongside the existing kb verbs", () => {
    const program = new Command();
    registerKbCommand(program);
    const names = findKb(program).commands.map((c) => c.name());
    expect(names).toEqual(
      expect.arrayContaining([
        "list",
        "get",
        "create",
        "update",
        "delete",
        "sync",
        "connect",
        "attach",
        "detach",
      ]),
    );
  });

  it("connect has the expected flags", () => {
    const program = new Command();
    registerKbCommand(program);
    const connect = findKb(program).commands.find(
      (c) => c.name() === "connect",
    )!;
    const flags = connect.options.map((option) => option.long);
    expect(flags).toEqual(
      expect.arrayContaining([
        "--bucket",
        "--prefix",
        "--exclude",
        "--include",
        "--bucket-owner",
        "--no-sync",
        "--timeout",
        "--stage",
        "--tenant",
      ]),
    );
  });

  it("repeated --exclude flags accumulate in order", () => {
    const program = new Command();
    registerKbCommand(program);
    const connect = findKb(program).commands.find(
      (c) => c.name() === "connect",
    )!;
    let captured: string[] | undefined;
    connect.action((_kbId: string, opts: { exclude: string[] }) => {
      captured = opts.exclude;
    });
    program.parse(
      [
        "kb",
        "connect",
        "kb-1",
        "--bucket",
        "cx-to-s3",
        "--prefix",
        "cx/files/",
        "--exclude",
        "*Retired Procedures/*",
        "--exclude",
        "*.tmp",
      ],
      { from: "user" },
    );
    expect(captured).toEqual(["*Retired Procedures/*", "*.tmp"]);
  });

  it("sync exposes --wait and --timeout", () => {
    const program = new Command();
    registerKbCommand(program);
    const sync = findKb(program).commands.find((c) => c.name() === "sync")!;
    const flags = sync.options.map((option) => option.long);
    expect(flags).toEqual(expect.arrayContaining(["--wait", "--timeout"]));
  });
});
