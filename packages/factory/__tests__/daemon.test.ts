/**
 * Poll-loop tests (U5 wiring slice): one tick end-to-end with the REAL
 * executor against fakes, plus the shutdown contract (stop mid-tick →
 * current issue finishes, remaining candidates skipped, loop exits).
 */

import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { heartbeatPath, readHeartbeatAgeMs } from "../src/heartbeat.js";

import { DEFAULT_PHASES, DEFAULT_PROJECT, type FactoryConfig, type HostConfig } from "../src/config.js";
import { DEFAULT_RELEASE } from "../src/domain/release.js";
import {
  buildStoreView,
  createDaemonController,
  isRateLimitError,
  runDaemon,
  runTick,
  type DaemonDeps,
} from "../src/daemon.js";
import { createLogger, type Logger } from "../src/logger.js";
import { PollAbortedError, type PollCandidate } from "../src/linear/poller.js";
import { executeAction, type ExecutorDeps } from "../src/phases/executor.js";
import type { EngineAction } from "../src/phases/engine.js";
import { openStore, type FactoryStore } from "../src/store/db.js";
import { createAttemptMachine } from "../src/workers/attempts.js";
import type {
  ExecResult,
  HostTransport,
  SpawnDetachedRequest,
} from "../src/workers/transport.js";
import { preflightMarker } from "../src/linear/preflight.js";
import { FakeGateway, makeIssue } from "./fake-gateway.js";

let stateDir: string;
let store: FactoryStore;
let log: Logger;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "factory-daemon-test-"));
  store = openStore(stateDir);
  log = createLogger({ write: () => {}, level: "error" });
});

afterEach(() => {
  store.close();
  rmSync(stateDir, { recursive: true, force: true });
});

class FakeTransport implements HostTransport {
  pids = new Set<number>();
  worktreeListing = "";

  async exec(command: string, args: string[]): Promise<ExecResult> {
    if (command === "git" && args.includes("worktree")) {
      return { code: 0, stdout: this.worktreeListing, stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  }
  async spawnDetached(_req: SpawnDetachedRequest): Promise<{ pid: number }> {
    return { pid: 9999 };
  }
  async probe(): Promise<boolean> {
    return true;
  }
  async pidAlive(pid: number): Promise<boolean> {
    return this.pids.has(pid);
  }
  async readFileText(): Promise<string> {
    return "";
  }
  async readTail(): Promise<string> {
    return "";
  }
  async statMtimeMs(): Promise<number | null> {
    return null;
  }
  async writeFileText(): Promise<void> {}
  async killPidGroup(): Promise<boolean> {
    return false;
  }
}

const host: HostConfig = {
  name: "local",
  kind: "local",
  repoPath: "/tmp/fake-repo",
  capabilities: ["claude"],
  maxConcurrent: 2,
  claudeBin: "/usr/local/bin/claude",
};

const config: FactoryConfig = {
  linear: { apiKey: "k", teamKey: "THINK" },
  project: DEFAULT_PROJECT,
  release: DEFAULT_RELEASE,
  slack: {},
  hosts: [host],
  phases: DEFAULT_PHASES,
  pollIntervalSeconds: 1,
  enforceBudgetUsd: false,
};

function makeDeps(
  gateway: FakeGateway,
  execute: DaemonDeps["execute"],
  transport: HostTransport = new FakeTransport(),
): DaemonDeps {
  return {
    gateway,
    store,
    transport,
    repoPath: host.repoPath,
    teamKey: "THINK",
    log,
    execute,
  };
}

describe("runTick — end-to-end with the real executor", () => {
  it("does NOT enroll a lane-labeled Todo issue — Todo is below the Brainstorming floor", async () => {
    // The enrollment floor is Brainstorming. A lane-labeled Todo issue is
    // ideation the operator still owns (ce-ideate); the daemon must not touch
    // it — no decision, no state change, no ledger. The operator moving it to
    // Brainstorming is the "start the factory" gesture.
    const issue = makeIssue({
      identifier: "THINK-10",
      state: "Todo",
      labels: ["Claude"],
    });
    const gateway = new FakeGateway([issue]);
    const machine = createAttemptMachine(store);
    const execDeps: ExecutorDeps = {
      gateway,
      store,
      machine,
      config,
      host,
      teamKey: "THINK",
      worktreesDir: join(stateDir, "worktrees"),
      bootstrapScript: "/fake/worker-bootstrap.sh",
      runBootstrap: async () => ({ code: 0, stdout: "", stderr: "" }),
      runnerFor: () => null,
      awaitLaunches: true,
      log,
    };
    const deps = makeDeps(gateway, (action, candidate) =>
      executeAction(action, candidate, execDeps),
    );

    const tick = await runTick(deps);

    expect(tick.decisions).toEqual([]);
    expect(issue.state).toBe("Todo"); // untouched
    expect(
      issue.comments.some((c) =>
        c.body.includes("automation-ledger:THINK-10"),
      ),
    ).toBe(false);
  });

  it("preflight-blocks credential work before the engine ever decides", async () => {
    const issue = makeIssue({
      identifier: "THINK-11",
      state: "Planning",
      labels: ["Claude"],
      description: "Rotate the OAuth client secrets for the Slack app",
    });
    const gateway = new FakeGateway([issue]);
    const executed: string[] = [];
    const deps = makeDeps(gateway, async (_a, c) => {
      executed.push(c.issue.identifier);
    });

    const tick = await runTick(deps);

    expect(tick.decisions).toEqual([{ issue: "THINK-11", kind: "block" }]);
    expect(executed).toEqual([]); // engine/executor never ran
    expect(issue.labels).toContain("Needs Credentials");
  });

  it("onlyIssues scope processes the in-scope issue and skips every other candidate", async () => {
    const inScope = makeIssue({
      identifier: "THINK-20",
      state: "Brainstorming",
      labels: ["Claude"],
    });
    const outOfScope = makeIssue({
      identifier: "THINK-21",
      state: "Brainstorming",
      labels: ["Codex"],
    });
    const gateway = new FakeGateway([inScope, outOfScope]);
    const executed: string[] = [];
    const deps: DaemonDeps = {
      ...makeDeps(gateway, async (_a, c) => {
        executed.push(c.issue.identifier);
      }),
      onlyIssues: new Set(["THINK-20"]),
    };

    const tick = await runTick(deps);

    // Only the scoped issue is decided/executed; the out-of-scope Codex issue
    // is never touched (never fetched, no state change).
    expect(tick.decisions).toEqual([{ issue: "THINK-20", kind: "launch" }]);
    expect(executed).toEqual(["THINK-20"]);
    expect(outOfScope.state).toBe("Brainstorming");
    expect(
      outOfScope.comments.some((c) => c.body.includes("automation-ledger")),
    ).toBe(false);
  });
});

describe("runTick — preflight operator override", () => {
  it("marker comment present + blocker label absent → routes normally, never re-blocks", async () => {
    const issue = makeIssue({
      identifier: "THINK-30",
      state: "Planning",
      labels: ["Claude"], // operator removed "Needs Credentials"
      description: "Rotate the OAuth client secrets for the Slack app",
      comments: [
        {
          id: "c-pf",
          body: `${preflightMarker("THINK-30")}\n\nblocked on an earlier tick`,
        },
      ],
    });
    const gateway = new FakeGateway([issue]);
    const executed: string[] = [];
    const deps = makeDeps(gateway, async (_a, c) => {
      executed.push(c.issue.identifier);
    });

    const tick = await runTick(deps);

    // The engine decided (launch), not the preflight block path.
    expect(tick.decisions).toEqual([{ issue: "THINK-30", kind: "launch" }]);
    expect(executed).toEqual(["THINK-30"]);
    expect(issue.labels).not.toContain("Needs Credentials");
    // No second preflight comment.
    expect(
      issue.comments.filter((c) =>
        c.body.startsWith(preflightMarker("THINK-30")),
      ),
    ).toHaveLength(1);
  });

  it("still blocks on the first encounter (no marker yet)", async () => {
    const issue = makeIssue({
      identifier: "THINK-31",
      state: "Planning",
      labels: ["Claude"],
      description: "Rotate the OAuth client secrets for the Slack app",
    });
    const gateway = new FakeGateway([issue]);
    const deps = makeDeps(gateway, async () => {});

    const tick = await runTick(deps);
    expect(tick.decisions).toEqual([{ issue: "THINK-31", kind: "block" }]);
    expect(issue.labels).toContain("Needs Credentials");
  });
});

describe("buildStoreView — duplicate-worker guard", () => {
  it("flags dead-pid active attempts and unknown worktrees as external signals", async () => {
    const issue = makeIssue({
      identifier: "THINK-12",
      state: "In Progress",
      labels: ["Claude"],
    });
    const gateway = new FakeGateway([issue]);
    // Active attempt with a dead pid.
    store.insertAttempt({
      issueId: issue.id,
      phase: "implement",
      attemptNumber: 1,
      state: "Running",
      pid: 4242,
      worktreePath: "/wt/auto-think-12-implement-a1",
    });
    const transport = new FakeTransport(); // 4242 not in pids → dead
    transport.worktreeListing = [
      "worktree /repo",
      "HEAD abc",
      "",
      "worktree /wt/auto-think-12-implement-a1", // known to the store
      "HEAD def",
      "",
      "worktree /wt/auto-think-12-verify-a9", // NOT known → signal
      "HEAD ghi",
    ].join("\n");

    const candidate: PollCandidate = {
      issue,
      lane: "Claude",
      hasLfg: false,
      isVerification: false,
      blockerLabels: [],
      ledger: {
        ledger: {
          phase: "implement",
          lane: "Claude",
          worker: null,
          attempt: 1,
          blocker: null,
          compounded: false,
        },
        prose: "",
        synthesized: true,
        warnings: [],
      },
      ledgerCommentId: null,
      comments: [],
    };

    const view = await buildStoreView(
      { gateway, store, transport, repoPath: "/repo" },
      candidate,
    );

    expect(view.activeAttempt).toBeNull();
    expect(view.externalWorkerSignals).toEqual([
      "stale-active-attempt:1 pid:4242 dead",
      "unknown-worktree:/wt/auto-think-12-verify-a9",
    ]);
  });

  it("bounds `git worktree list` with a timeout and skips the scan on timeout", async () => {
    const issue = makeIssue({
      identifier: "THINK-40",
      state: "In Progress",
      labels: ["Claude"],
    });
    const gateway = new FakeGateway([issue]);

    class HangingGitTransport extends FakeTransport {
      lastGitOpts: { timeoutMs?: number } | undefined;
      async exec(
        command: string,
        args: string[],
        opts?: { timeoutMs?: number },
      ): Promise<ExecResult> {
        if (command === "git" && args.includes("worktree")) {
          this.lastGitOpts = opts;
          if (opts?.timeoutMs === undefined) {
            // Unbounded call would hang the daemon forever.
            await new Promise(() => {});
          }
          // Simulate the transport-level timeout kill: code null.
          return { code: null, stdout: "", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      }
    }
    const transport = new HangingGitTransport();

    const candidate: PollCandidate = {
      issue,
      lane: "Claude",
      hasLfg: false,
      isVerification: false,
      blockerLabels: [],
      ledger: {
        ledger: {
          phase: "implement",
          lane: "Claude",
          worker: null,
          attempt: 1,
          blocker: null,
          compounded: false,
        },
        prose: "",
        synthesized: true,
        warnings: [],
      },
      ledgerCommentId: null,
      comments: [],
    };

    const view = await buildStoreView(
      { gateway, store, transport, repoPath: "/repo" },
      candidate,
    );

    expect(transport.lastGitOpts?.timeoutMs).toBeGreaterThan(0);
    // Timed-out scan is skipped, not fatal: no external signals fabricated.
    expect(view.externalWorkerSignals).toEqual([]);
  }, 5_000);

  it("reports a live-pid attempt as active", async () => {
    const issue = makeIssue({
      identifier: "THINK-13",
      state: "In Progress",
      labels: ["Claude"],
    });
    const gateway = new FakeGateway([issue]);
    store.insertAttempt({
      issueId: issue.id,
      phase: "implement",
      attemptNumber: 1,
      state: "Running",
      pid: 777,
    });
    const transport = new FakeTransport();
    transport.pids.add(777);

    const candidate = {
      issue,
      lane: "Claude" as const,
      hasLfg: false,
      isVerification: false,
      blockerLabels: [],
      ledger: {
        ledger: {
          phase: "implement",
          lane: "Claude",
          worker: null,
          attempt: 1,
          blocker: null,
          compounded: false,
        },
        prose: "",
        synthesized: true,
        warnings: [],
      },
      ledgerCommentId: null,
      comments: [],
    };

    const view = await buildStoreView(
      { gateway, store, transport, repoPath: "/repo" },
      candidate,
    );
    expect(view.activeAttempt).toEqual({ phase: "implement", state: "Running" });
    expect(view.externalWorkerSignals).toEqual([]);
  });
});

describe("runDaemon — shutdown contract", () => {
  it("stop mid-tick: current issue finishes, remaining skipped, loop exits", async () => {
    const issues = [
      makeIssue({ identifier: "THINK-20", state: "Brainstorming", labels: ["Claude"] }),
      makeIssue({ identifier: "THINK-21", state: "Brainstorming", labels: ["Claude"] }),
    ];
    const gateway = new FakeGateway(issues);
    const controller = createDaemonController();
    const executed: string[] = [];

    const deps = makeDeps(gateway, async (_action: EngineAction, candidate) => {
      executed.push(candidate.issue.identifier);
      // Signal arrives while the FIRST issue is being executed.
      controller.stop();
    });

    await runDaemon(deps, {
      pollIntervalSeconds: 60, // would hang the test if the loop kept going
      controller,
      sleepGranularityMs: 5,
    });

    expect(executed).toEqual(["THINK-20"]); // second candidate never ran
  });

  it("--once mode runs exactly one tick and returns", async () => {
    const gateway = new FakeGateway([
      makeIssue({ identifier: "THINK-22", state: "Brainstorming", labels: ["Claude"] }),
    ]);
    const executed: string[] = [];
    const deps = makeDeps(gateway, async (_a, c) => {
      executed.push(c.issue.identifier);
    });

    await runDaemon(deps, { pollIntervalSeconds: 60, once: true });
    expect(executed).toEqual(["THINK-22"]);
  });
});

describe("runDaemon — heartbeat decoupled from tick progress (KTD-6)", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("keeps the heartbeat fresh while a tick is awaiting a long worker", async () => {
    const gateway = new FakeGateway([
      makeIssue({ identifier: "THINK-30", state: "Brainstorming", labels: ["Claude"] }),
    ]);
    // Hang the tick: listTeamIssues awaits a gate the test controls, so the
    // whole tick is stuck in an await (as it would be during a 120-min worker).
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const origList = gateway.listTeamIssues.bind(gateway);
    gateway.listTeamIssues = async (teamKey: string) => {
      await gate;
      return origList(teamKey);
    };

    const hbPath = heartbeatPath(stateDir);
    const controller = createDaemonController();
    const deps: DaemonDeps = {
      ...makeDeps(gateway, async () => {}),
      heartbeatPath: hbPath,
    };

    const done = runDaemon(deps, {
      pollIntervalSeconds: 60,
      controller,
      sleepGranularityMs: 5,
      heartbeatIntervalMs: 10, // stamp every 10ms regardless of tick progress
    });

    // The immediate boot stamp exists...
    expect(readHeartbeatAgeMs(hbPath)).not.toBeNull();
    const firstMtime = statSync(hbPath).mtimeMs;

    // ...and while the tick is STILL awaiting `gate`, the independent interval
    // keeps advancing the file's mtime (a per-cycle-only stamp would be frozen).
    await sleep(80);
    const laterMtime = statSync(hbPath).mtimeMs;
    expect(laterMtime).toBeGreaterThan(firstMtime);
    // The file is nowhere near the interval-stale threshold.
    expect(readHeartbeatAgeMs(hbPath)!).toBeLessThan(60);

    release(); // let the hung tick complete
    controller.stop();
    await done;
  });
});

describe("runDaemon — Linear rate-limit backoff", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const RATE_LIMIT_MESSAGE =
    "Rate limit exceeded. Only 2500 requests are allowed per 1 hour. For more " +
    "information see our developer docs at: https://linear.app/developers/rate-limiting";

  class RateLimitedGateway extends FakeGateway {
    polls = 0;
    override async listTeamIssues(): Promise<never> {
      this.polls += 1;
      throw new Error(RATE_LIMIT_MESSAGE);
    }
  }

  it("isRateLimitError matches SDK 429 messages (also wrapped in PollAbortedError) and rejects others", () => {
    expect(isRateLimitError(new Error(RATE_LIMIT_MESSAGE))).toBe(true);
    expect(
      isRateLimitError(new PollAbortedError(new Error(RATE_LIMIT_MESSAGE))),
    ).toBe(true);
    // Raw-GraphQL extension code shape.
    expect(isRateLimitError(new Error("GraphQL error: RATELIMITED"))).toBe(true);
    // Nested cause chain.
    const inner = new Error(RATE_LIMIT_MESSAGE);
    const outer = new Error("tick failed");
    outer.cause = inner;
    expect(isRateLimitError(outer)).toBe(true);
    expect(isRateLimitError(new Error("upstream connect error (503)"))).toBe(false);
    expect(isRateLimitError(new PollAbortedError(new Error("boom")))).toBe(false);
  });

  it("a rate-limited tick sleeps the cooldown, not the poll interval (no hammering)", async () => {
    const gateway = new RateLimitedGateway([]);
    const controller = createDaemonController();
    const deps = makeDeps(gateway, async () => {});

    const done = runDaemon(deps, {
      pollIntervalSeconds: 0.01, // would re-poll every ~10ms without backoff
      rateLimitCooldownSeconds: 60,
      controller,
      sleepGranularityMs: 5,
    });

    // Enough wall-clock for ~10 poll intervals; the cooldown must hold at 1.
    await sleep(120);
    expect(gateway.polls).toBe(1);

    controller.stop();
    await done;
  });

  it("a NON-rate-limit tick failure retries at the normal poll interval", async () => {
    class FlakyGateway extends FakeGateway {
      polls = 0;
      override async listTeamIssues(): Promise<never> {
        this.polls += 1;
        throw new Error("upstream connect error (503)");
      }
    }
    const gateway = new FlakyGateway([]);
    const controller = createDaemonController();
    const deps = makeDeps(gateway, async () => {});

    const done = runDaemon(deps, {
      pollIntervalSeconds: 0.01,
      rateLimitCooldownSeconds: 60,
      controller,
      sleepGranularityMs: 5,
    });

    await sleep(120);
    expect(gateway.polls).toBeGreaterThan(1);

    controller.stop();
    await done;
  });
});

describe("buildStoreView — children and dependencies (LFG never-stuck)", () => {
  it("resolves child states so the engine can wait/resume the parent", async () => {
    const parent = makeIssue({
      identifier: "THINK-70",
      state: "Ready to Work",
      labels: ["Claude", "LFG"],
      childStates: ["Done", "In Progress"],
    });
    const gateway = new FakeGateway([parent]);
    const deps = makeDeps(gateway, async () => {});
    const view = await buildStoreView(deps, {
      issue: parent,
      lane: "Claude",
      hasLfg: true,
      isVerification: false,
      blockerLabels: [],
      ledger: {
        ledger: { phase: "implement", lane: "Claude", worker: null, attempt: 0, blocker: null, compounded: false },
        prose: "",
        synthesized: true,
        warnings: [],
      },
      ledgerCommentId: null,
      comments: [],
    });
    expect(view.hasChildIssues).toBe(true);
    expect(view.childStates).toEqual(["Done", "In Progress"]);
    expect(view.dependency).toBeNull();
  });

  it("resolves a waiting-on dependency's LIVE state", async () => {
    const dep = makeIssue({ identifier: "THINK-73", state: "Done", labels: ["Claude"] });
    const issue = makeIssue({
      identifier: "THINK-74",
      state: "Ready to Work",
      labels: ["Claude", "LFG"],
    });
    const gateway = new FakeGateway([dep, issue]);
    const deps = makeDeps(gateway, async () => {});
    const view = await buildStoreView(deps, {
      issue,
      lane: "Claude",
      hasLfg: true,
      isVerification: false,
      blockerLabels: [],
      ledger: {
        ledger: { phase: "implement", lane: "Claude", worker: null, attempt: 2, blocker: "waiting-on: THINK-73", compounded: false },
        prose: "",
        synthesized: false,
        warnings: [],
      },
      ledgerCommentId: "lc-1",
      comments: [],
    });
    expect(view.dependency).toEqual({ identifier: "THINK-73", state: "Done", done: true });
  });

  it("an unreachable dependency read keeps WAITING (never a false resume)", async () => {
    const issue = makeIssue({
      identifier: "THINK-74",
      state: "Ready to Work",
      labels: ["Claude", "LFG"],
    });
    const gateway = new FakeGateway([issue]);
    gateway.failNextListIssues = true;
    const deps = makeDeps(gateway, async () => {});
    const view = await buildStoreView(deps, {
      issue,
      lane: "Claude",
      hasLfg: true,
      isVerification: false,
      blockerLabels: [],
      ledger: {
        ledger: { phase: "implement", lane: "Claude", worker: null, attempt: 2, blocker: "waiting-on: THINK-73", compounded: false },
        prose: "",
        synthesized: false,
        warnings: [],
      },
      ledgerCommentId: "lc-1",
      comments: [],
    });
    expect(view.dependency).toEqual({ identifier: "THINK-73", state: "unknown", done: false });
  });
});
