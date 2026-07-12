/**
 * launchd plist rendering + the unattended-reboot precondition check (U7, R16).
 * NO real launchctl runs here — only the template render and the best-effort
 * precondition inspection (with an injected command runner).
 *
 * The #1 launchd pitfall the render must defeat: a bare `node` or a `~` in the
 * plist. Every scenario asserts the output is fully substituted to ABSOLUTE
 * paths with no placeholder left behind.
 */

import { describe, expect, it } from "vitest";

import {
  DAEMON_LABEL,
  WATCHDOG_LABEL,
  checkUnattendedRebootPreconditions,
  renderDaemonPlist,
  renderWatchdogPlist,
  resolveInstallContext,
  type CommandRunner,
  type InstallContext,
} from "../src/cli-install.js";

const ctx: InstallContext = {
  programBin: "/opt/node/bin/node",
  entry: "/Users/eric/repo/packages/factory/dist/cli.js",
  stateDir: "/Users/eric/.thinkwork-factory",
  workingDir: "/Users/eric/repo",
  logDir: "/Users/eric/.thinkwork-factory/logs",
  pathEnv: "/opt/node/bin:/opt/homebrew/bin:/usr/bin:/bin",
  uid: 501,
  fromSource: false,
};

function assertNoLaunchdPitfalls(plist: string): void {
  // No home-relative paths.
  expect(plist).not.toContain("~");
  // No bare `node` program argument (must be an absolute binary).
  expect(plist).not.toContain("<string>node</string>");
  // No unsubstituted template placeholder remains.
  expect(plist).not.toMatch(/__[A-Z_]+__/);
}

describe("daemon plist render", () => {
  const plist = renderDaemonPlist(ctx, 15);

  it("substitutes only absolute paths — no ~, no bare node, no leftover placeholders", () => {
    assertNoLaunchdPitfalls(plist);
    expect(plist).toContain("<string>/opt/node/bin/node</string>");
    expect(plist).toContain(
      "<string>/Users/eric/repo/packages/factory/dist/cli.js</string>",
    );
    expect(plist).toContain(
      "<string>/Users/eric/.thinkwork-factory</string>",
    );
    expect(plist).toContain("/opt/node/bin:/opt/homebrew/bin:/usr/bin:/bin");
  });

  it("is a LaunchAgent: KeepAlive on unclean exit, RunAtLoad, ThrottleInterval, absolute logs", () => {
    expect(plist).toContain(`<string>${DAEMON_LABEL}</string>`);
    // KeepAlive = { SuccessfulExit: false }
    expect(plist).toMatch(
      /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/,
    );
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>ThrottleInterval<\/key>\s*<integer>15<\/integer>/);
    expect(plist).toContain(
      "<string>/Users/eric/.thinkwork-factory/logs/daemon.log</string>",
    );
    // Runs the `run` subcommand.
    expect(plist).toContain("<string>run</string>");
  });
});

describe("watchdog plist render", () => {
  const plist = renderWatchdogPlist(ctx, 300);

  it("substitutes absolute paths only and runs on a StartInterval", () => {
    assertNoLaunchdPitfalls(plist);
    expect(plist).toContain(`<string>${WATCHDOG_LABEL}</string>`);
    expect(plist).toMatch(/<key>StartInterval<\/key>\s*<integer>300<\/integer>/);
    expect(plist).toContain("<string>watchdog</string>");
    expect(plist).toContain(
      "<string>/Users/eric/.thinkwork-factory/logs/watchdog.log</string>",
    );
    // The watchdog is an interval job, not KeepAlive.
    expect(plist).not.toContain("<key>KeepAlive</key>");
  });
});

describe("resolveInstallContext", () => {
  it("resolves absolute node/entry/PATH and the real uid", () => {
    const resolved = resolveInstallContext({
      stateDir: "/Users/eric/.thinkwork-factory",
    });
    expect(resolved.programBin.startsWith("/")).toBe(true);
    expect(resolved.entry.startsWith("/")).toBe(true);
    expect(resolved.entry).toMatch(/cli\.(js|ts)$/);
    expect(resolved.pathEnv).not.toContain("~");
    expect(resolved.logDir).toBe("/Users/eric/.thinkwork-factory/logs");
    if (typeof process.getuid === "function") {
      expect(resolved.uid).toBe(process.getuid());
    }
  });
});

// ---------------------------------------------------------------------------
// The reboot-survival amendment: auto-login + FileVault inspection.
// ---------------------------------------------------------------------------

function runnerFor(map: Record<string, { code: number; stdout: string }>): CommandRunner {
  return async (cmd) => {
    const hit = map[cmd] ?? { code: 1, stdout: "" };
    return { code: hit.code, stdout: hit.stdout, stderr: "" };
  };
}

describe("unattended-reboot preconditions", () => {
  it("auto-login ON + FileVault OFF → guaranteed, no warnings", async () => {
    const pre = await checkUnattendedRebootPreconditions(
      runnerFor({
        defaults: { code: 0, stdout: "eric\n" },
        fdesetup: { code: 0, stdout: "FileVault is Off.\n" },
      }),
    );
    expect(pre.autoLoginEnabled).toBe(true);
    expect(pre.autoLoginUser).toBe("eric");
    expect(pre.fileVaultOn).toBe(false);
    expect(pre.guaranteed).toBe(true);
    expect(pre.warnings).toHaveLength(0);
  });

  it("auto-login OFF → not guaranteed, warns about the missing GUI session", async () => {
    const pre = await checkUnattendedRebootPreconditions(
      runnerFor({
        defaults: { code: 1, stdout: "" }, // key unset → read fails
        fdesetup: { code: 0, stdout: "FileVault is Off.\n" },
      }),
    );
    expect(pre.autoLoginEnabled).toBe(false);
    expect(pre.guaranteed).toBe(false);
    expect(pre.warnings.join(" ")).toMatch(/Automatic login is DISABLED/);
  });

  it("FileVault ON → not guaranteed, warns about the pre-boot unlock screen", async () => {
    const pre = await checkUnattendedRebootPreconditions(
      runnerFor({
        defaults: { code: 0, stdout: "eric\n" },
        fdesetup: { code: 0, stdout: "FileVault is On.\n" },
      }),
    );
    expect(pre.fileVaultOn).toBe(true);
    expect(pre.guaranteed).toBe(false);
    expect(pre.warnings.join(" ")).toMatch(/FileVault is ON/);
  });

  it("FileVault status undeterminable → warns rather than assuming safe", async () => {
    const pre = await checkUnattendedRebootPreconditions(
      runnerFor({
        defaults: { code: 0, stdout: "eric\n" },
        fdesetup: { code: 127, stdout: "" }, // command missing
      }),
    );
    expect(pre.fileVaultOn).toBeNull();
    expect(pre.guaranteed).toBe(false);
    expect(pre.warnings.join(" ")).toMatch(/Could not determine FileVault/);
  });
});
