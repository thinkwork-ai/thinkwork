/**
 * launchd plist rendering + the unattended-reboot precondition check (U7, R16).
 * NO real launchctl runs here — only the template render and the best-effort
 * precondition inspection (with an injected command runner).
 *
 * The #1 launchd pitfall the render must defeat: a bare `node` or a `~` in the
 * plist. Every scenario asserts the output is fully substituted to ABSOLUTE
 * paths with no placeholder left behind.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { heartbeatPath } from "../src/heartbeat.js";
import { createLogger, type Logger } from "../src/logger.js";
import {
  DAEMON_LABEL,
  WATCHDOG_LABEL,
  checkUnattendedRebootPreconditions,
  installFactoryd,
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

// ---------------------------------------------------------------------------
// installFactoryd: argv-not-shell safety, fail-loud on launchctl error, and the
// seeded heartbeat (Fix 1 / Fix 2 / Fix 4).
// ---------------------------------------------------------------------------

interface RunCall {
  cmd: string;
  args: string[];
}

/** Fake launchctl that records every argv and returns a fixed exit code. */
function recordingLaunchctl(
  calls: RunCall[],
  codeFor: (args: string[]) => number = () => 0,
): CommandRunner {
  return async (cmd, args) => {
    calls.push({ cmd, args });
    return { code: codeFor(args), stdout: "", stderr: "" };
  };
}

/** Preconditions are irrelevant to these tests — keep them off the real host. */
const benignPreconditionRun: CommandRunner = async (cmd) => {
  if (cmd === "defaults") return { code: 0, stdout: "eric\n", stderr: "" };
  return { code: 0, stdout: "FileVault is Off.\n", stderr: "" };
};

describe("installFactoryd (imperative)", () => {
  let root: string;
  let log: Logger;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "factory-install-test-"));
    log = createLogger({ write: () => {}, level: "error" });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("passes a LaunchAgents path containing `&` and a space to launchctl as ONE argv element", async () => {
    // A home/state path with `&` and a space is the classic shell-injection trap:
    // built into a shell string it would split or disable BOTH agents. execFile
    // array args must deliver it intact.
    const agentsDir = join(root, "Home & Co", "Library", "LaunchAgents");
    const stateDir = join(root, "state & data", "factory");
    const calls: RunCall[] = [];

    await installFactoryd({
      stateDir,
      launchAgentsDir: agentsDir,
      log,
      run: recordingLaunchctl(calls),
      preconditionRun: benignPreconditionRun,
    });

    const daemonPlistPath = join(agentsDir, `${DAEMON_LABEL}.plist`);
    const bootstrap = calls.find(
      (c) => c.args[0] === "bootstrap" && c.args[2] === daemonPlistPath,
    );
    expect(bootstrap).toBeDefined();
    // The whole path — `&` and space included — is a SINGLE argv element.
    expect(bootstrap!.args).toHaveLength(3);
    expect(bootstrap!.args[2]).toBe(daemonPlistPath);
    expect(bootstrap!.args[2]).toContain("Home & Co");
    // bootout targets the fixed service label literal, never a path.
    const bootout = calls.find((c) => c.args[0] === "bootout");
    expect(bootout!.args[1]).toMatch(/^gui\/\d+\/com\.thinkwork\.factory$/);
    expect(bootout!.args.some((a) => a.includes("/"))).toBe(true); // gui/uid/label only
    expect(bootout!.args.some((a) => a.endsWith(".plist"))).toBe(false);
  });

  it("throws when launchctl bootstrap fails instead of exiting success", async () => {
    const calls: RunCall[] = [];
    await expect(
      installFactoryd({
        stateDir: join(root, "state"),
        launchAgentsDir: join(root, "LaunchAgents"),
        log,
        // bootstrap returns non-zero; bootout is best-effort and ignored.
        run: recordingLaunchctl(calls, (args) =>
          args[0] === "bootstrap" ? 1 : 0,
        ),
        preconditionRun: benignPreconditionRun,
      }),
    ).rejects.toThrow(/install failed/i);
  });

  it("seeds a fresh daemon.heartbeat so the watchdog's first tick is not a false alarm", async () => {
    const stateDir = join(root, "state");
    await installFactoryd({
      stateDir,
      launchAgentsDir: join(root, "LaunchAgents"),
      log,
      run: recordingLaunchctl([]),
      preconditionRun: benignPreconditionRun,
    });
    const hb = heartbeatPath(stateDir);
    expect(existsSync(hb)).toBe(true);
    // Self-describing ISO content (the watchdog reads mtime, humans read this).
    expect(readFileSync(hb, "utf-8").trim()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
