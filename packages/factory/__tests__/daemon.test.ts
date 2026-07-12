/**
 * Poll-loop tests (U5 wiring slice): one tick end-to-end with the REAL
 * executor against fakes, plus the shutdown contract (stop mid-tick →
 * current issue finishes, remaining candidates skipped, loop exits).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_PHASES, type FactoryConfig, type HostConfig } from "../src/config.js";
import {
  buildStoreView,
  createDaemonController,
  runDaemon,
  runTick,
  type DaemonDeps,
} from "../src/daemon.js";
import { createLogger, type Logger } from "../src/logger.js";
import type { PollCandidate } from "../src/linear/poller.js";
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
  slack: {},
  hosts: [host],
  phases: DEFAULT_PHASES,
  pollIntervalSeconds: 1,
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
  it("advances a lane-labeled Todo issue to Brainstorming and writes the ledger", async () => {
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
      log,
    };
    const deps = makeDeps(gateway, (action, candidate) =>
      executeAction(action, candidate, execDeps),
    );

    const tick = await runTick(deps);

    expect(tick.decisions).toEqual([{ issue: "THINK-10", kind: "advance" }]);
    expect(issue.state).toBe("Brainstorming");
    expect(
      issue.comments.some((c) =>
        c.body.includes("automation-ledger:THINK-10"),
      ),
    ).toBe(true);
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
      makeIssue({ identifier: "THINK-20", state: "Todo", labels: ["Claude"] }),
      makeIssue({ identifier: "THINK-21", state: "Todo", labels: ["Claude"] }),
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
      makeIssue({ identifier: "THINK-22", state: "Todo", labels: ["Claude"] }),
    ]);
    const executed: string[] = [];
    const deps = makeDeps(gateway, async (_a, c) => {
      executed.push(c.issue.identifier);
    });

    await runDaemon(deps, { pollIntervalSeconds: 60, once: true });
    expect(executed).toEqual(["THINK-22"]);
  });
});
