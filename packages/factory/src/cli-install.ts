/**
 * `factoryd install` / `factoryd uninstall` (U7, R16, KTD-6).
 *
 * Renders the two launchd LaunchAgent templates (daemon + watchdog) with
 * ABSOLUTE paths and bootstraps them into the per-user GUI domain.
 *
 * The #1 launchd pitfall: a LaunchAgent runs with NO shell rc, so a bare
 * `node` or a `~` in the plist fails silently. Every substituted value here is
 * absolute — `process.execPath` for node (or the tsx shim when running from
 * source), the resolved entry script, the state dir, an explicit PATH.
 *
 * THE UNATTENDED-REBOOT AMENDMENT (doc review): a LaunchAgent only runs inside
 * a logged-in GUI session. After a cold reboot that means automatic login must
 * be enabled AND FileVault must be off (or set to auto-unlock) — otherwise the
 * machine sits at the login/unlock screen and the daemon never starts. `install`
 * inspects both and prints a LOUD warning when unattended reboot survival is
 * not guaranteed. It never hard-fails: the daemon still starts at the next
 * interactive login.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { heartbeatPath, writeHeartbeat } from "./heartbeat.js";
import type { Logger } from "./logger.js";

const execFileAsync = promisify(execFile);

export const DAEMON_LABEL = "com.thinkwork.factory";
export const WATCHDOG_LABEL = "com.thinkwork.factory-watchdog";

/** Default watchdog cadence: check the heartbeat every 5 minutes. */
export const DEFAULT_WATCHDOG_INTERVAL_SECONDS = 300;
/** Default daemon KeepAlive throttle (launchd minimum-respawn window). */
export const DEFAULT_THROTTLE_INTERVAL_SECONDS = 15;

/** Package root (…/packages/factory), where `launchd/` lives. */
function packageRoot(): string {
  // src/cli-install.ts → up one to package root.
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function launchdTemplateDir(): string {
  return join(packageRoot(), "launchd");
}

/** Everything the templates need, fully resolved to absolute paths. */
export interface InstallContext {
  /** __NODE_BIN__ — absolute node (or tsx shim for a source checkout). */
  programBin: string;
  /** __ENTRY__ — absolute entry script (dist/cli.js or src/cli.ts). */
  entry: string;
  /** __STATE_DIR__ — the factory state dir. */
  stateDir: string;
  /** __WORKING_DIR__ — daemon working directory (the repo checkout). */
  workingDir: string;
  /** Directory the daemon/watchdog logs are written under. */
  logDir: string;
  /** __PATH__ — explicit absolute PATH (launchd has none). */
  pathEnv: string;
  /** The GUI-domain uid used by `launchctl bootstrap gui/<uid>`. */
  uid: number;
  /** True when `entry` is a TS source file run through the tsx shim. */
  fromSource: boolean;
}

function resolveTsxBin(): string | null {
  const candidates = [
    join(packageRoot(), "node_modules", ".bin", "tsx"),
    join(packageRoot(), "..", "..", "node_modules", ".bin", "tsx"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

export interface ResolveInstallOptions {
  stateDir: string;
  /** Daemon working dir; defaults to the resolved repo checkout / package root. */
  workingDir?: string;
  /** Override PATH; defaults to node-dir + the standard absolute dirs. */
  pathEnv?: string;
  uid?: number;
}

/**
 * Resolve the absolute node/entry/PATH context for the plists. Prefers a built
 * `dist/cli.js` (production); falls back to running `src/cli.ts` through the
 * absolute tsx shim so an install from a source checkout still works.
 */
export function resolveInstallContext(
  opts: ResolveInstallOptions,
): InstallContext {
  const root = packageRoot();
  const distEntry = join(root, "dist", "cli.js");
  let programBin: string;
  let entry: string;
  let fromSource: boolean;
  if (existsSync(distEntry)) {
    programBin = process.execPath;
    entry = distEntry;
    fromSource = false;
  } else {
    const tsx = resolveTsxBin();
    // The tsx shim is itself an absolute executable (node script). Using it as
    // the program keeps the plist to two absolute slots and runs the TS entry.
    programBin = tsx ?? process.execPath;
    entry = join(root, "src", "cli.ts");
    fromSource = true;
  }

  const nodeDir = dirname(process.execPath);
  const pathEnv =
    opts.pathEnv ??
    [
      nodeDir,
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ].join(":");

  return {
    programBin,
    entry,
    stateDir: opts.stateDir,
    workingDir: opts.workingDir ?? root,
    logDir: join(opts.stateDir, "logs"),
    pathEnv,
    uid: opts.uid ?? (typeof process.getuid === "function" ? process.getuid() : 0),
    fromSource,
  };
}

function substitute(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(key, value);
  }
  return out;
}

function readTemplate(filename: string): string {
  return readFileSync(join(launchdTemplateDir(), filename), "utf-8");
}

/** Render the daemon LaunchAgent plist with absolute paths substituted in. */
export function renderDaemonPlist(
  ctx: InstallContext,
  throttleIntervalSeconds = DEFAULT_THROTTLE_INTERVAL_SECONDS,
): string {
  return substitute(readTemplate("com.thinkwork.factory.plist"), {
    __LABEL__: DAEMON_LABEL,
    __NODE_BIN__: ctx.programBin,
    __ENTRY__: ctx.entry,
    __WORKING_DIR__: ctx.workingDir,
    __STATE_DIR__: ctx.stateDir,
    __PATH__: ctx.pathEnv,
    __LOG_PATH__: join(ctx.logDir, "daemon.log"),
    __THROTTLE_INTERVAL__: String(throttleIntervalSeconds),
    __UID__: String(ctx.uid),
  });
}

/** Render the watchdog interval-job plist with absolute paths substituted in. */
export function renderWatchdogPlist(
  ctx: InstallContext,
  startIntervalSeconds = DEFAULT_WATCHDOG_INTERVAL_SECONDS,
): string {
  return substitute(readTemplate("com.thinkwork.factory-watchdog.plist"), {
    __LABEL__: WATCHDOG_LABEL,
    __NODE_BIN__: ctx.programBin,
    __ENTRY__: ctx.entry,
    __WORKING_DIR__: ctx.workingDir,
    __STATE_DIR__: ctx.stateDir,
    __PATH__: ctx.pathEnv,
    __LOG_PATH__: join(ctx.logDir, "watchdog.log"),
    __START_INTERVAL__: String(startIntervalSeconds),
    __UID__: String(ctx.uid),
  });
}

// ---------------------------------------------------------------------------
// Unattended-reboot precondition check (the amendment)
// ---------------------------------------------------------------------------

export interface CommandRunner {
  (
    cmd: string,
    args: string[],
  ): Promise<{ code: number | null; stdout: string; stderr: string }>;
}

const defaultRun: CommandRunner = async (cmd, args) => {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: 10_000,
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(e),
    };
  }
};

export interface RebootPreconditions {
  autoLoginEnabled: boolean;
  autoLoginUser: string | null;
  /** True/false when known; null when it could not be determined. */
  fileVaultOn: boolean | null;
  /** True only when the daemon is guaranteed to start after a cold reboot. */
  guaranteed: boolean;
  /** LOUD advisories to print when survival is not guaranteed. */
  warnings: string[];
}

/**
 * Best-effort inspection of automatic login + FileVault. A LaunchAgent only
 * runs inside a logged-in GUI session, so unattended reboot survival needs
 * auto-login ON and FileVault OFF (or auto-unlock). Never throws.
 */
export async function checkUnattendedRebootPreconditions(
  run: CommandRunner = defaultRun,
): Promise<RebootPreconditions> {
  // Auto-login: com.apple.loginwindow autoLoginUser is the user name macOS logs
  // in at boot; an unset key (read fails) means auto-login is off.
  let autoLoginUser: string | null = null;
  const al = await run("defaults", [
    "read",
    "/Library/Preferences/com.apple.loginwindow",
    "autoLoginUser",
  ]);
  if (al.code === 0 && al.stdout.trim() !== "") {
    autoLoginUser = al.stdout.trim();
  }
  const autoLoginEnabled = autoLoginUser !== null;

  // FileVault: `fdesetup status` prints "FileVault is On." / "…is Off."
  let fileVaultOn: boolean | null = null;
  const fv = await run("fdesetup", ["status"]);
  const fvText = `${fv.stdout} ${fv.stderr}`;
  if (/FileVault is On\./i.test(fvText)) fileVaultOn = true;
  else if (/FileVault is Off\./i.test(fvText)) fileVaultOn = false;

  const warnings: string[] = [];
  if (!autoLoginEnabled) {
    warnings.push(
      "Automatic login is DISABLED. After a cold reboot no GUI session exists, " +
        "so the factory LaunchAgent will NOT start until someone logs in " +
        "interactively. Enable auto-login (System Settings › Users & Groups › " +
        "Automatically log in as) for unattended reboot survival.",
    );
  }
  if (fileVaultOn === true) {
    warnings.push(
      "FileVault is ON. macOS disables automatic login behind the pre-boot " +
        "unlock screen, so after a reboot the disk sits locked and the daemon " +
        "never starts until the volume is unlocked. Turn FileVault off (or " +
        "configure a hardware/auto unlock) for guaranteed reboot survival.",
    );
  }
  if (fileVaultOn === null) {
    warnings.push(
      "Could not determine FileVault status (fdesetup unavailable or blocked) " +
        "— verify FileVault is off before relying on unattended reboot survival.",
    );
  }

  const guaranteed = autoLoginEnabled && fileVaultOn === false;
  return { autoLoginEnabled, autoLoginUser, fileVaultOn, guaranteed, warnings };
}

// ---------------------------------------------------------------------------
// Imperative install / uninstall (operator-run; not unit-tested)
// ---------------------------------------------------------------------------

function launchAgentsDir(): string {
  return join(homedir(), "Library", "LaunchAgents");
}

function plistTargetPath(label: string): string {
  return join(launchAgentsDir(), `${label}.plist`);
}

export interface InstallOptions {
  stateDir: string;
  workingDir?: string;
  watchdogIntervalSeconds?: number;
  throttleIntervalSeconds?: number;
  log: Logger;
  /** Injectable for tests; defaults to real launchctl via execFile. */
  run?: CommandRunner;
  /** Injectable precondition runner (defaults to the real one). */
  preconditionRun?: CommandRunner;
  /**
   * Injectable LaunchAgents directory (defaults to ~/Library/LaunchAgents).
   * Exists so tests can point plist writes/targets at a tmp dir — including a
   * path with `&`/spaces — without touching the real user directory.
   */
  launchAgentsDir?: string;
}

/**
 * Render + write both plists, warn on reboot preconditions, then bootstrap both
 * jobs into the GUI domain and kickstart the daemon. Prints guidance; does not
 * hard-fail on precondition gaps.
 */
export async function installFactoryd(opts: InstallOptions): Promise<void> {
  const { log } = opts;
  const run = opts.run ?? defaultRun;
  const ctx = resolveInstallContext({
    stateDir: opts.stateDir,
    workingDir: opts.workingDir,
  });

  if (ctx.fromSource) {
    log.warn(
      "installing from a SOURCE checkout (no dist/cli.js) — the LaunchAgent " +
        "runs src/cli.ts through the tsx shim. `pnpm --filter @thinkwork/factory " +
        "build` first for a production install.",
      { entry: ctx.entry, programBin: ctx.programBin },
    );
  }

  const agentsDir = opts.launchAgentsDir ?? launchAgentsDir();
  const targetPath = (label: string): string => join(agentsDir, `${label}.plist`);

  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(ctx.logDir, { recursive: true });

  const daemonPlist = renderDaemonPlist(ctx, opts.throttleIntervalSeconds);
  const watchdogPlist = renderWatchdogPlist(ctx, opts.watchdogIntervalSeconds);
  writeFileSync(targetPath(DAEMON_LABEL), daemonPlist);
  writeFileSync(targetPath(WATCHDOG_LABEL), watchdogPlist);
  log.info("wrote LaunchAgent plists", {
    daemon: targetPath(DAEMON_LABEL),
    watchdog: targetPath(WATCHDOG_LABEL),
  });

  // Seed an initial heartbeat so the watchdog's first RunAtLoad tick (which
  // fires immediately at install) sees a FRESH file instead of an absent one —
  // otherwise a boot-time watchdog run reads "daemon has not started" and pages
  // falsely while the daemon is still doing its pre-heartbeat boot reconcile.
  writeHeartbeat(heartbeatPath(ctx.stateDir));
  log.info("seeded daemon heartbeat", { path: heartbeatPath(ctx.stateDir) });

  // The reboot-survival amendment: inspect + warn LOUDLY, never block.
  const pre = await checkUnattendedRebootPreconditions(
    opts.preconditionRun ?? defaultRun,
  );
  if (pre.guaranteed) {
    log.info("unattended reboot survival OK", {
      autoLoginUser: pre.autoLoginUser,
      fileVaultOn: pre.fileVaultOn,
    });
  } else {
    log.error(
      "================ UNATTENDED REBOOT NOT GUARANTEED ================",
    );
    for (const w of pre.warnings) log.error(w);
    log.error(
      "The daemon WILL still start at the next interactive login — but a cold " +
        "reboot may leave the factory down until you log in. Fix the above for " +
        "true reboot survival.",
    );
    log.error(
      "=================================================================",
    );
  }

  const domain = `gui/${ctx.uid}`;
  // Track launchctl failures so a failed bootstrap/kickstart makes `install`
  // fail LOUDLY rather than logging an error under a success-looking exit.
  const failures: string[] = [];
  for (const label of [DAEMON_LABEL, WATCHDOG_LABEL]) {
    // Every launchctl call passes its arguments as a fixed argv array via
    // execFile (NO shell), so a `&`/space in a rendered path can never split an
    // argument or corrupt the command. bootout targets the fixed service label
    // literal (`gui/<uid>/<label>`), not a path.
    //
    // bootout first so a re-install cleanly replaces an existing definition; a
    // non-zero here is expected when the job isn't loaded yet, so it is ignored.
    await run("launchctl", ["bootout", `${domain}/${label}`]);
    const res = await run("launchctl", [
      "bootstrap",
      domain,
      targetPath(label),
    ]);
    if (res.code !== 0) {
      log.error("launchctl bootstrap failed", {
        label,
        code: res.code,
        stderr: res.stderr.trim(),
      });
      failures.push(
        `bootstrap ${label}: ${res.stderr.trim() || `exit ${res.code}`}`,
      );
    } else {
      log.info("bootstrapped LaunchAgent", { label, domain });
    }
  }
  // Kick the daemon so it starts now without waiting for the next login.
  const kick = await run("launchctl", [
    "kickstart",
    "-k",
    `${domain}/${DAEMON_LABEL}`,
  ]);
  if (kick.code !== 0) {
    log.error("launchctl kickstart failed", {
      code: kick.code,
      stderr: kick.stderr.trim(),
    });
    failures.push(
      `kickstart ${DAEMON_LABEL}: ${kick.stderr.trim() || `exit ${kick.code}`}`,
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `factoryd install failed — launchctl reported errors:\n  ${failures.join("\n  ")}`,
    );
  }
  log.info("factoryd installed", { domain });
}

export interface UninstallOptions {
  log: Logger;
  run?: CommandRunner;
  /** Also delete the plist files (default true). */
  removeFiles?: boolean;
}

/** Bootout both jobs and (optionally) delete the plist files. */
export async function uninstallFactoryd(opts: UninstallOptions): Promise<void> {
  const { log } = opts;
  const run = opts.run ?? defaultRun;
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const domain = `gui/${uid}`;
  for (const label of [DAEMON_LABEL, WATCHDOG_LABEL]) {
    const target = plistTargetPath(label);
    // Target the fixed service label literal (`gui/<uid>/<label>`), never a
    // path — a `&`/space in the plist path can then never corrupt the bootout.
    const res = await run("launchctl", ["bootout", `${domain}/${label}`]);
    log.info("booted out LaunchAgent", { label, code: res.code });
    if (opts.removeFiles !== false && existsSync(target)) {
      try {
        // Lazy import to avoid pulling rmSync into the render-only path.
        const { rmSync } = await import("node:fs");
        rmSync(target, { force: true });
      } catch (e) {
        log.warn("could not delete plist file", {
          label,
          error: String(e),
        });
      }
    }
  }
  log.info("factoryd uninstalled", { domain });
}
