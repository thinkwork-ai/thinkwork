import { execSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ClaudeRunner,
  buildScrubbedEnv,
  parseClaudeStreamEvents,
} from "../src/workers/claude-runner.js";
import { LocalTransport } from "../src/workers/transport.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-workers-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** List pids belonging to a process group (portable macOS/Linux). */
function pgidMembers(pgid: number): number[] {
  const out = execSync("ps -eo pid=,pgid=", { encoding: "utf-8" });
  return out
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter(([pid, g]) => g === pgid && Number.isFinite(pid))
    .map(([pid]) => pid);
}

async function waitFor(
  cond: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  pollMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error("waitFor timed out");
}

describe("LocalTransport", () => {
  it("kill path terminates the whole process group, not just the shell", async () => {
    const transport = new LocalTransport();
    const logPath = join(dir, "kill-test.log");
    const { pid } = await transport.spawnDetached({
      command: "sh",
      args: ["-c", "sleep 60 & wait"],
      env: { PATH: "/usr/bin:/bin" },
      logPath,
    });

    // Detached spawn makes the shell its own process-group leader; the
    // backgrounded sleep joins that group.
    await waitFor(() => pgidMembers(pid).length >= 2);
    expect(await transport.pidAlive(pid)).toBe(true);

    expect(await transport.killPidGroup(pid, "SIGKILL")).toBe(true);
    await waitFor(() => pgidMembers(pid).length === 0);
    expect(await transport.pidAlive(pid)).toBe(false);
  });

  it("pidAlive is false for a nonsense pid and killPidGroup reports it", async () => {
    const transport = new LocalTransport();
    expect(await transport.pidAlive(999999)).toBe(false);
    expect(await transport.killPidGroup(999999)).toBe(false);
  });

  it("readTail returns the last N lines of a file", async () => {
    const transport = new LocalTransport();
    const p = join(dir, "tail.log");
    writeFileSync(p, ["l1", "l2", "l3", "l4", "l5"].join("\n") + "\n");
    expect(await transport.readTail(p, 2)).toBe("l4\nl5");
    expect(await transport.readTail(p, 100)).toBe("l1\nl2\nl3\nl4\nl5");
    expect(await transport.readTail(join(dir, "absent.log"), 3)).toBe("");
  });

  it("exec captures exit code, stdout, and stderr", async () => {
    const transport = new LocalTransport();
    const ok = await transport.exec("sh", ["-c", "echo out; echo err >&2"]);
    expect(ok.code).toBe(0);
    expect(ok.stdout.trim()).toBe("out");
    expect(ok.stderr.trim()).toBe("err");
    const bad = await transport.exec("sh", ["-c", "exit 7"]);
    expect(bad.code).toBe(7);
  });

  it("probe reports the local host reachable", async () => {
    expect(await new LocalTransport().probe()).toBe(true);
  });
});

describe("buildScrubbedEnv", () => {
  it("contains ONLY the allowlisted vars — daemon secrets never leak", () => {
    const sourceEnv = {
      HOME: "/Users/tester",
      USER: "tester",
      LOGNAME: "tester",
      TMPDIR: "/tmp/xyz/",
      PATH: "/opt/homebrew/bin:/Users/tester/.local/bin:/usr/bin",
      LINEAR_API_KEY: "lin_api_SECRET",
      SLACK_BOT_TOKEN: "xoxb-SECRET",
      SSH_AUTH_SOCK: "/private/tmp/ssh-agent.sock",
      AWS_SECRET_ACCESS_KEY: "aws-SECRET",
      FACTORY_CANARY_SECRET: "canary",
    };
    const env = buildScrubbedEnv({
      binDir: "/Users/tester/.local/bin",
      worktreePath: "/tmp/wt",
      sourceEnv,
    });
    expect(Object.keys(env).sort()).toEqual(
      ["HOME", "LOGNAME", "PATH", "PWD", "TMPDIR", "USER"].sort(),
    );
    // PATH is rebuilt from scratch — never inherited from the daemon.
    expect(env.PATH).toBe(
      "/usr/bin:/bin:/usr/sbin:/sbin:/Users/tester/.local/bin",
    );
    expect(env.PWD).toBe("/tmp/wt");
    expect(JSON.stringify(env)).not.toMatch(/SECRET|canary|xoxb|lin_api/);
  });

  it("merges explicit per-phase additions only", () => {
    const env = buildScrubbedEnv({
      binDir: "/b",
      worktreePath: "/w",
      sourceEnv: { HOME: "/h", EXTRA_LEAK: "no" },
      extra: { PHASE_FLAG: "yes" },
    });
    expect(env.PHASE_FLAG).toBe("yes");
    expect(env).not.toHaveProperty("EXTRA_LEAK");
  });

  it("omits allowlisted keys that are unset rather than inventing them", () => {
    const env = buildScrubbedEnv({
      binDir: "/b",
      worktreePath: "/w",
      sourceEnv: { HOME: "/h" },
    });
    expect(env).not.toHaveProperty("TMPDIR");
    expect(env).not.toHaveProperty("USER");
    expect(env.HOME).toBe("/h");
  });
});

describe("parseClaudeStreamEvents", () => {
  it("detects a successful result event", () => {
    const events = parseClaudeStreamEvents(
      [
        '{"type":"system","subtype":"init","session_id":"s1"}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"OK"}]}}',
        '{"type":"result","subtype":"success","is_error":false,"result":"OK"}',
      ].join("\n"),
    );
    const completion = events.find((e) => e.kind === "completion");
    expect(completion).toBeDefined();
    expect(completion!.success).toBe(true);
  });

  it("detects an unsuccessful result event", () => {
    const events = parseClaudeStreamEvents(
      '{"type":"result","subtype":"error_during_execution","is_error":true}',
    );
    const completion = events.find((e) => e.kind === "completion");
    expect(completion!.success).toBe(false);
  });

  it("classifies rate-limit / quota signals on error result lines separately from errors", () => {
    for (const line of [
      '{"type":"result","subtype":"error","is_error":true,"result":"Claude AI usage limit reached|1770000000"}',
      '{"type":"result","subtype":"error","is_error":true,"result":"API Error: 429 rate_limit_error"}',
    ]) {
      const events = parseClaudeStreamEvents(line);
      expect(
        events.some((e) => e.kind === "rate-limit"),
        `expected rate-limit signal in: ${line}`,
      ).toBe(true);
      expect(
        events.some((e) => e.kind === "error"),
        `quota signal must not also be a plain error: ${line}`,
      ).toBe(false);
    }
  });

  it("does NOT rate-limit-classify incidental quota/429 text in content lines of a healthy run", () => {
    // This repo does budget/cost work — healthy transcripts legitimately
    // mention "quota" and "429" in assistant text and tool results. The
    // substring heuristic must only run on genuine outcome/error lines.
    const events = parseClaudeStreamEvents(
      [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"The tenant quota table shows 429 rows affected by the rate limit fix."}]}}',
        '{"type":"user","message":{"content":[{"type":"tool_result","content":"HTTP 429 handling verified; quota reconciliation test passed"}]}}',
        '{"type":"result","subtype":"success","is_error":false,"result":"Done: documented quota behavior"}',
      ].join("\n"),
    );
    expect(events.some((e) => e.kind === "rate-limit")).toBe(false);
    const completion = events.find((e) => e.kind === "completion");
    expect(completion).toBeDefined();
    expect(completion!.success).toBe(true);
  });

  it("does not misread the CLI's routine allowed rate_limit_event telemetry", () => {
    const events = parseClaudeStreamEvents(
      [
        '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1783880400,"rateLimitType":"five_hour"}}',
        '{"type":"result","subtype":"success","is_error":false,"result":"OK"}',
      ].join("\n"),
    );
    expect(events.some((e) => e.kind === "rate-limit")).toBe(false);
    expect(events.find((e) => e.kind === "completion")!.success).toBe(true);
  });

  it("classifies a non-allowed rate_limit_event as a quota signal", () => {
    const events = parseClaudeStreamEvents(
      '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1783880400}}',
    );
    expect(events.some((e) => e.kind === "rate-limit")).toBe(true);
  });

  it("ignores unparseable lines without throwing", () => {
    const events = parseClaudeStreamEvents("not json\n\n{broken");
    expect(events).toEqual([]);
  });
});

describe("ClaudeRunner (stub binary through LocalTransport)", () => {
  function writeStub(name: string, body: string): string {
    const p = join(dir, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
    return p;
  }

  it("launches with the scrubbed env: canary daemon secret never reaches the worker", async () => {
    process.env.FACTORY_CANARY_SECRET = "super-secret-canary";
    try {
      const stub = writeStub("claude-env-stub", "env | sort");
      const logsDir = join(dir, "logs");
      const runner = new ClaudeRunner({
        claudeBin: stub,
        logsDir,
        transport: new LocalTransport(),
      });
      const handle = await runner.launch(
        {
          attemptId: 1,
          issueId: "THINK-999",
          phase: "implement",
          attemptNumber: 1,
        },
        "Reply OK",
        { model: "sonnet", cwd: dir },
      );
      expect(handle.pid).toBeGreaterThan(0);
      // pid sidecar next to the log, matching the established layout.
      expect(handle.pidPath).toBe(handle.logPath.replace(/\.log$/, ".pid"));
      expect(readFileSync(handle.pidPath, "utf-8").trim()).toBe(
        String(handle.pid),
      );
      expect(handle.logPath).toMatch(/THINK-999-implement-.*\.log$/);

      await runner.result(handle, { pollMs: 25, timeoutMs: 10_000 });
      const log = readFileSync(handle.logPath, "utf-8");
      expect(log).toContain("HOME=");
      expect(log).toContain("PATH=/usr/bin:/bin:/usr/sbin:/sbin:" + dir);
      expect(log).not.toContain("super-secret-canary");
      expect(log).not.toContain("FACTORY_CANARY_SECRET");
    } finally {
      delete process.env.FACTORY_CANARY_SECRET;
    }
  });

  it("passes the proven headless flags and per-phase model; budget flag when configured", async () => {
    const stub = writeStub("claude-args-stub", "printf '%s\\n' \"$@\"");
    const logsDir = join(dir, "logs");
    const runner = new ClaudeRunner({
      claudeBin: stub,
      logsDir,
      transport: new LocalTransport(),
    });
    const handle = await runner.launch(
      { attemptId: 2, issueId: "THINK-998", phase: "plan", attemptNumber: 1 },
      "Reply OK",
      { model: "opus", cwd: dir, budgetUsd: 5 },
    );
    await runner.result(handle, { pollMs: 25, timeoutMs: 10_000 });
    const args = readFileSync(handle.logPath, "utf-8").split("\n");
    expect(args).toContain("-p");
    expect(args).toContain("Reply OK");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--verbose");
    expect(args).toContain("--model");
    expect(args).toContain("opus");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("--max-budget-usd");
    expect(args).toContain("5");
  });

  it("result() reports completion + liveness goes false after exit; kill() works while running", async () => {
    const stubDone = writeStub(
      "claude-done-stub",
      `echo '{"type":"result","subtype":"success","is_error":false,"result":"OK"}'`,
    );
    const logsDir = join(dir, "logs");
    mkdirSync(logsDir, { recursive: true });
    const transport = new LocalTransport();
    const runner = new ClaudeRunner({
      claudeBin: stubDone,
      logsDir,
      transport,
    });
    const handle = await runner.launch(
      { attemptId: 3, issueId: "THINK-997", phase: "verify", attemptNumber: 1 },
      "p",
      { model: "sonnet", cwd: dir },
    );
    const result = await runner.result(handle, {
      pollMs: 25,
      timeoutMs: 10_000,
    });
    expect(result.exitObserved).toBe(true);
    expect(result.completed).toBe(true);
    expect(result.success).toBe(true);
    expect(result.rateLimited).toBe(false);
    expect(await runner.liveness(handle)).toBe(false);

    const stubHang = writeStub("claude-hang-stub", "sleep 60 & wait");
    const runner2 = new ClaudeRunner({
      claudeBin: stubHang,
      logsDir,
      transport,
    });
    const h2 = await runner2.launch(
      { attemptId: 4, issueId: "THINK-996", phase: "verify", attemptNumber: 1 },
      "p",
      { model: "sonnet", cwd: dir },
    );
    expect(await runner2.liveness(h2)).toBe(true);
    expect(await runner2.kill(h2)).toBe(true);
    await waitFor(async () => !(await runner2.liveness(h2)));
  });

  it("classifies a rate-limited run in result()", async () => {
    const stub = writeStub(
      "claude-quota-stub",
      `echo '{"type":"result","subtype":"error","is_error":true,"result":"Claude AI usage limit reached|1770000000"}'`,
    );
    const runner = new ClaudeRunner({
      claudeBin: stub,
      logsDir: join(dir, "logs"),
      transport: new LocalTransport(),
    });
    const handle = await runner.launch(
      {
        attemptId: 5,
        issueId: "THINK-995",
        phase: "implement",
        attemptNumber: 1,
      },
      "p",
      { model: "sonnet", cwd: dir },
    );
    const result = await runner.result(handle, {
      pollMs: 25,
      timeoutMs: 10_000,
    });
    expect(result.rateLimited).toBe(true);
    expect(result.success).toBe(false);
  });

  it("logTail returns the last lines of the worker log", async () => {
    const stub = writeStub(
      "claude-tail-stub",
      "echo one; echo two; echo three",
    );
    const runner = new ClaudeRunner({
      claudeBin: stub,
      logsDir: join(dir, "logs"),
      transport: new LocalTransport(),
    });
    const handle = await runner.launch(
      {
        attemptId: 6,
        issueId: "THINK-994",
        phase: "compound",
        attemptNumber: 1,
      },
      "p",
      { model: "sonnet", cwd: dir },
    );
    await runner.result(handle, { pollMs: 25, timeoutMs: 10_000 });
    expect(await runner.logTail(handle, 2)).toBe("two\nthree");
  });
});

describe("parseCodexJsonEvents", () => {
  it("classifies completion, errors, and rate limits across event shapes", async () => {
    const { parseCodexJsonEvents } = await import("../src/workers/codex-runner.js");
    const log = [
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Verification PASS — moved to Done." } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10 } }),
      "not json",
    ].join("\n");
    const events = parseCodexJsonEvents(log);
    const completion = events.find((e) => e.kind === "completion");
    expect(completion).toMatchObject({ success: true });
    expect((completion as { detail?: string }).detail).toContain("Verification PASS");

    const errored = parseCodexJsonEvents(
      [
        JSON.stringify({ msg: { type: "error", message: "something broke" } }),
        JSON.stringify({ type: "turn.completed" }),
      ].join("\n"),
    );
    expect(errored.find((e) => e.kind === "completion")).toMatchObject({ success: false });
    expect(errored.some((e) => e.kind === "error")).toBe(true);

    const limited = parseCodexJsonEvents(
      JSON.stringify({ type: "error", message: "429 rate limit exceeded, retry later" }),
    );
    expect(limited.some((e) => e.kind === "rate-limit")).toBe(true);
    // No completion event → incomplete run.
    expect(limited.some((e) => e.kind === "completion")).toBe(false);
  });
});

describe("CodexRunner (stub binary through LocalTransport)", () => {
  function writeStub(name: string, body: string): string {
    const p = join(dir, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
    return p;
  }

  it("launches `exec` with --json, -C worktree, -m model, and the sandbox bypass; scrubbed env", async () => {
    process.env.FACTORY_CANARY_SECRET = "super-secret-canary";
    try {
      const { CodexRunner } = await import("../src/workers/codex-runner.js");
      const stub = writeStub("codex-args-stub", "printf '%s\\n' \"$@\"; env | sort");
      const logsDir = join(dir, "logs");
      const runner = new CodexRunner({
        codexBin: stub,
        logsDir,
        transport: new LocalTransport(),
      });
      const handle = await runner.launch(
        { attemptId: 3, issueId: "THINK-997", phase: "verify", attemptNumber: 1 },
        "Verify it.",
        { model: "gpt-5.6-sol", cwd: dir, budgetUsd: 50 },
      );
      expect(handle.pidPath).toBe(handle.logPath.replace(/\.log$/, ".pid"));
      expect(handle.logPath).toMatch(/THINK-997-verify-.*\.log$/);
      await runner.result(handle, { pollMs: 25, timeoutMs: 10_000 });
      const log = readFileSync(handle.logPath, "utf-8");
      const lines = log.split("\n");
      expect(lines[0]).toBe("exec");
      expect(lines[1]).toBe("Verify it.");
      expect(log).toContain("--json");
      expect(log).toContain("-m\ngpt-5.6-sol");
      expect(log).toContain(`-C\n${dir}`);
      expect(log).toContain("--dangerously-bypass-approvals-and-sandbox");
      // Codex has no budget flag — budgetUsd must NOT leak into args.
      expect(log).not.toContain("--max-budget-usd");
      // Scrubbed env: daemon secrets never reach the worker.
      expect(log).not.toContain("super-secret-canary");
    } finally {
      delete process.env.FACTORY_CANARY_SECRET;
    }
  });
});
