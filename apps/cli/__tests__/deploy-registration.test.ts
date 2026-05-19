import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { registerDeployCommand } from "../src/commands/deploy.js";

describe("deploy command registration", () => {
  it("exposes enterprise deploy mode without required options", () => {
    const program = new Command();
    program.name("thinkwork");

    registerDeployCommand(program);

    const deploy = program.commands.find(
      (command) => command.name() === "deploy",
    );
    expect(deploy).toBeDefined();
    expect(deploy!.description()).toContain("Defaults to local Terraform");
    expect(deploy!.description()).toContain("enterprise CI");
    const flags = deploy!.options.map((option) => option.flags);

    expect(flags).toContain("--bootstrap");
    expect(flags).toContain("--customer <slug>");
    expect(flags).toContain("--repo <owner/name>");
    expect(flags).toContain("--create-repo");
    expect(flags).toContain("--checkout-dir <path>");
    expect(flags).toContain("--wait");
    expect(flags).toContain("--no-wait");
    expect(flags).toContain("--run-smokes");
    expect(flags).toContain("--no-run-smokes");
    expect(flags).toContain("--local-terraform");
    expect(flags).toContain("--release-version <version>");
    expect(flags).toContain("--manifest-url <url>");
    expect(flags).toContain("--manifest-sha256 <sha256>");
    expect(flags).toContain("--terraform-module-version <version>");
    expect(flags).toContain("--db-password <value>");
    expect(flags).toContain("--api-auth-secret <value>");
    expect(flags).toContain("--dry-run");
    expect(
      deploy!.options.find((option) => option.flags === "--bootstrap")
        ?.description,
    ).toContain("guided enterprise bootstrap");
    expect(deploy!.options.every((option) => option.mandatory !== true)).toBe(
      true,
    );
  });
});
