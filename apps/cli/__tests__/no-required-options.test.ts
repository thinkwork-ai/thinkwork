import { describe, it, expect } from "vitest";
import { Command } from "commander";

import { registerMcpCommand } from "../src/commands/mcp.js";
import { registerToolsCommand } from "../src/commands/tools.js";
import { registerUserCommand } from "../src/commands/user.js";
import { registerPlanCommand } from "../src/commands/plan.js";
import { registerDeployCommand } from "../src/commands/deploy.js";
import { registerDestroyCommand } from "../src/commands/destroy.js";
import { registerDoctorCommand } from "../src/commands/doctor.js";
import { registerOutputsCommand } from "../src/commands/outputs.js";
import { registerBootstrapCommand } from "../src/commands/bootstrap.js";
import { registerConfigCommand } from "../src/commands/config.js";
import { registerInitCommand } from "../src/commands/init.js";

/**
 * Regression guard for the interactive-fallback contract.
 *
 * The CLI UX rule: every missing arg (stage, tenant, anything required for
 * the action) should fall through to an interactive prompt, not commander's
 * "required option '-s, --stage' not specified" hard error.
 *
 * That means NO subcommand may use `.requiredOption('-s, --stage')` or
 * `.requiredOption('--tenant')` — stage and tenant are always interactive-
 * fallback via `resolveStage` / `resolveTenantRest`. We walk the full
 * command tree and assert.
 *
 * Adding a new command that truly needs a required option on something
 * *other* than stage/tenant? Add it to `ALLOWED_REQUIRED_FLAGS` below with a
 * short justification comment.
 */

// Flags that may legitimately be .requiredOption — keep this list tight and
// justify every addition. The point is to prevent drift back to "error out on
// missing --stage" which humans hate.
const ALLOWED_REQUIRED_FLAGS: Array<[string, string]> = [
  // (cli-path-prefix, flag) — see `isAllowed()`.
];

function walkAll(program: Command, path: string[] = []): Array<{ path: string; options: Array<{ flags: string; required: boolean; long?: string }> }> {
  const out: Array<{ path: string; options: Array<{ flags: string; required: boolean; long?: string }> }> = [];
  const name = program.name();
  const fullPath = name ? [...path, name] : path;
  if (fullPath.length > 0) {
    out.push({
      path: fullPath.join(" "),
      options: program.options.map((o) => ({
        flags: o.flags,
        required: o.mandatory === true,
        long: o.long ?? undefined,
      })),
    });
  }
  for (const child of program.commands) {
    out.push(...walkAll(child, fullPath));
  }
  return out;
}

function registerEverything(): Command {
  const program = new Command();
  program.name("thinkwork");
  registerMcpCommand(program);
  registerToolsCommand(program);
  registerUserCommand(program);
  registerPlanCommand(program);
  registerDeployCommand(program);
  registerDestroyCommand(program);
  registerDoctorCommand(program);
  registerOutputsCommand(program);
  registerBootstrapCommand(program);
  registerConfigCommand(program);
  registerInitCommand(program);
  return program;
}

function isAllowed(path: string, long?: string): boolean {
  if (!long) return false;
  return ALLOWED_REQUIRED_FLAGS.some(
    ([p, flag]) => path.startsWith(p) && long === flag,
  );
}

describe("interactive fallback contract", () => {
  const tree = walkAll(registerEverything());

  it("no command has a required --stage option", () => {
    const violations = tree.filter((cmd) =>
      cmd.options.some(
        (o) =>
          o.required &&
          (o.long === "--stage" || o.flags.includes("--stage")) &&
          !isAllowed(cmd.path, o.long),
      ),
    );
    expect(violations, violationMessage(violations, "--stage")).toHaveLength(0);
  });

  it("no command has a required --tenant option", () => {
    const violations = tree.filter((cmd) =>
      cmd.options.some(
        (o) =>
          o.required &&
          (o.long === "--tenant" || o.flags.includes("--tenant")) &&
          !isAllowed(cmd.path, o.long),
      ),
    );
    expect(violations, violationMessage(violations, "--tenant")).toHaveLength(0);
  });

  it("no command has ANY required option without an ALLOWED_REQUIRED_FLAGS entry", () => {
    const violations = tree
      .flatMap((cmd) =>
        cmd.options
          .filter((o) => o.required && !isAllowed(cmd.path, o.long))
          .map((o) => ({ path: cmd.path, flag: o.long ?? o.flags })),
      );
    expect(
      violations,
      `Found required options without an allowlist entry. Either make them .option (with a resolver/prompt fallback) or add to ALLOWED_REQUIRED_FLAGS:\n${JSON.stringify(violations, null, 2)}`,
    ).toHaveLength(0);
  });
});

function violationMessage(
  violations: Array<{ path: string; options: Array<{ flags: string; required: boolean }> }>,
  flag: string,
): string {
  if (violations.length === 0) return "";
  return (
    `Found \`.requiredOption('${flag}')\` in: ${violations.map((v) => v.path).join(", ")}. ` +
    `Use .option() + resolveStage/resolveTenantRest instead so humans get an interactive picker.`
  );
}
