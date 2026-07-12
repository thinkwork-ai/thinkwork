/**
 * Host-transport interface (KTD-5): every way the daemon touches a worker
 * host — running commands, spawning detached workers, probing reachability,
 * reading logs, killing process groups — goes through this seam.
 *
 * U4 ships LocalTransport (the Mac mini itself). SshTransport lands in U10
 * behind the same interface; keep anything host-shaped OUT of runners.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface SpawnDetachedRequest {
  command: string;
  args: string[];
  /** Full worker environment — callers pass a SCRUBBED env, never process.env. */
  env: Record<string, string>;
  /** stdout+stderr are appended here. Parent dirs are created. */
  logPath: string;
  cwd?: string;
}

export interface HostTransport {
  /** Run a command to completion, capturing output. Never throws on non-zero exit. */
  exec(
    command: string,
    args: string[],
    opts?: ExecOptions,
  ): Promise<ExecResult>;
  /**
   * Spawn a long-lived worker detached from the daemon (own process group,
   * survives daemon restarts), with stdout/stderr redirected to logPath.
   * Resolves with the captured pid.
   */
  spawnDetached(req: SpawnDetachedRequest): Promise<{ pid: number }>;
  /** Is this host reachable right now? (Local: always true.) */
  probe(): Promise<boolean>;
  /** Is the given pid alive on this host? */
  pidAlive(pid: number): Promise<boolean>;
  /** Read a whole file; empty string when absent. */
  readFileText(path: string): Promise<string>;
  /** Last n lines of a file; empty string when absent. */
  readTail(path: string, lines: number): Promise<string>;
  /**
   * Modification time of a file in epoch-ms, or null when the file is absent
   * or unreadable. The daemon's heartbeat/stall detector (U6) uses a worker
   * log's mtime as its liveness signal: a live pid whose log has not grown
   * past the phase silence budget is Stalled, not healthy.
   */
  statMtimeMs(path: string): Promise<number | null>;
  /** Write a small file (pid sidecars etc.), creating parent dirs. */
  writeFileText(path: string, content: string): Promise<void>;
  /**
   * Kill the whole process GROUP led by pid (workers spawn shells that fork;
   * killing only the leader leaves orphans). Returns false when the group is
   * already gone.
   */
  killPidGroup(pid: number, signal?: NodeJS.Signals): Promise<boolean>;
}

export class LocalTransport implements HostTransport {
  async exec(
    command: string,
    args: string[],
    opts: ExecOptions = {},
  ): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: opts.cwd,
        env: opts.env ?? (process.env as Record<string, string>),
        timeout: opts.timeoutMs,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  }

  async spawnDetached(req: SpawnDetachedRequest): Promise<{ pid: number }> {
    mkdirSync(dirname(req.logPath), { recursive: true });
    const logFd = openSync(req.logPath, "a");
    try {
      const child = spawn(req.command, req.args, {
        cwd: req.cwd,
        env: req.env,
        detached: true, // new process group; leader pid === child.pid
        stdio: ["ignore", logFd, logFd],
      });
      const pid = await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("spawn", () => resolve(child.pid as number));
      });
      child.unref();
      return { pid };
    } finally {
      closeSync(logFd);
    }
  }

  async probe(): Promise<boolean> {
    return true;
  }

  async pidAlive(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      // EPERM means it exists but we can't signal it — still alive.
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  async readFileText(path: string): Promise<string> {
    if (!existsSync(path)) return "";
    return readFile(path, "utf-8");
  }

  async readTail(path: string, lines: number): Promise<string> {
    const text = await this.readFileText(path);
    if (text === "") return "";
    const all = text.replace(/\n$/, "").split("\n");
    return all.slice(-lines).join("\n");
  }

  async statMtimeMs(path: string): Promise<number | null> {
    try {
      const s = await stat(path);
      return s.mtimeMs;
    } catch {
      return null;
    }
  }

  async writeFileText(path: string, content: string): Promise<void> {
    mkdirSync(dirname(path), { recursive: true });
    await writeFile(path, content, "utf-8");
  }

  async killPidGroup(
    pid: number,
    signal: NodeJS.Signals = "SIGTERM",
  ): Promise<boolean> {
    try {
      // Negative pid → signal the whole process group.
      process.kill(-pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}
