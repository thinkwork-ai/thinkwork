import { describe, expect, it } from "vitest";
import type { execFileSync } from "node:child_process";

import {
  checkEnterpriseDeployReadiness,
  runGitHubLogin,
} from "../src/commands/enterprise/preflight.js";

type CommandCall = {
  command: string;
  args: string[];
};

function runner(options: {
  missing?: string[];
  failing?: string[];
  calls?: CommandCall[];
}) {
  const exec: typeof execFileSync = ((command: string, args: string[]) => {
    options.calls?.push({ command, args });
    if (options.missing?.includes(command)) {
      const err = new Error(`${command} not found`) as Error & {
        code: string;
      };
      err.code = "ENOENT";
      throw err;
    }
    const key = `${command} ${args.join(" ")}`;
    if (options.failing?.includes(key)) {
      throw new Error(`${key} failed`);
    }
    return `${command} ok`;
  }) as typeof execFileSync;
  return { execFileSync: exec };
}

describe("enterprise deploy preflight", () => {
  it("reports ready when git and authenticated GitHub CLI are available", () => {
    const result = checkEnterpriseDeployReadiness(runner({}));

    expect(result.ready).toBe(true);
    expect(result.git.ok).toBe(true);
    expect(result.github.ok).toBe(true);
    expect(result.github.authenticated).toBe(true);
  });

  it("reports GitHub CLI missing without trying auth status", () => {
    const calls: CommandCall[] = [];
    const result = checkEnterpriseDeployReadiness(
      runner({ missing: ["gh"], calls }),
    );

    expect(result.ready).toBe(false);
    expect(result.github.ok).toBe(false);
    expect(result.github.authenticated).toBe(false);
    expect(result.github.remediation).toContain("Install GitHub CLI");
    expect(calls).not.toContainEqual({
      command: "gh",
      args: ["auth", "status"],
    });
  });

  it("reports installed but unauthenticated GitHub CLI", () => {
    const result = checkEnterpriseDeployReadiness(
      runner({ failing: ["gh auth status"] }),
    );

    expect(result.ready).toBe(false);
    expect(result.github.ok).toBe(true);
    expect(result.github.authenticated).toBe(false);
    expect(result.github.remediation).toBe(
      "Run `gh auth login` before enterprise deploy.",
    );
  });

  it("runs GitHub CLI login through the injected runner", () => {
    const calls: CommandCall[] = [];

    runGitHubLogin(runner({ calls }));

    expect(calls).toEqual([{ command: "gh", args: ["auth", "login"] }]);
  });
});
