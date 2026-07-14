/**
 * THINK-286 — `deploy <target>`: config-driven targets, confirm round-trip,
 * detached execution with the outcome watcher, channel-root routing, and the
 * closed-thread reply.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeployTargetConfig } from "../src/config.js";
import { DEFAULT_RELEASE } from "../src/domain/release.js";
import { createLogger, type Logger } from "../src/logger.js";
import type { PollCandidate } from "../src/linear/poller.js";
import {
  createDeployExecutors,
  parseDeployArg,
  resumeDeployWatches,
  watchDeploy,
  DEPLOY_EXIT_MARKER,
  DEPLOY_OFFER_KEY,
  DEPLOY_RUNNING_KEY_PREFIX,
  type DeployDeps,
  type DeployTransport,
} from "../src/slack/deploy.js";
import { parseVerb } from "../src/slack/console.js";
import { createSlackSync, type SlackSync } from "../src/slack/sync.js";
import { openStore, type FactoryStore } from "../src/store/db.js";
import { FakeGateway, makeIssue, type FakeIssue } from "./fake-gateway.js";
import { FakeSlackGateway } from "./fake-slack.js";

const CHANNEL = "C_FACTORY";
const OPERATOR = "UOP";
const STRANGER = "UNOBODY";

let dir: string;
let store: FactoryStore;
let log: Logger;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-deploy-test-"));
  store = openStore(dir);
  log = createLogger({ write: () => {}, level: "error" });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const TARGETS: Record<string, DeployTargetConfig> = {
  tei: {
    argv: ["pnpm", "--dir", "apps/cli", "dev", "release", "deploy", "<VERSION>", "--stage", "tei-e2e", "--yes"],
    env: { AWS_PROFILE: "tei", AWS_REGION: "us-east-1" },
    note: "TEI customer stage",
  },
  mcpherson: {
    argv: ["pnpm", "--dir", "apps/cli", "dev", "release", "deploy", "<VERSION>", "--stage", "mcpherson", "--yes"],
    env: { AWS_PROFILE: "mcpherson", AWS_REGION: "us-east-1" },
  },
};

interface FakeTransport extends DeployTransport {
  spawns: { command: string; args: string[]; env: Record<string, string>; logPath: string; cwd?: string }[];
  alive: Set<number>;
}

function fakeTransport(): FakeTransport {
  const spawns: FakeTransport["spawns"] = [];
  const alive = new Set<number>();
  let nextPid = 5000;
  return {
    spawns,
    alive,
    async exec(cmd: string, args: string[]) {
      if (cmd === "git" && args[0] === "fetch") return { code: 0, stdout: "", stderr: "" };
      if (cmd === "git" && args[0] === "tag") {
        return { code: 0, stdout: "v0.1.0-canary.355\nv0.1.0-canary.354\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    async spawnDetached(req: FakeTransport["spawns"][number]) {
      spawns.push(req);
      const pid = nextPid++;
      alive.add(pid);
      return { pid };
    },
    async pidAlive(pid: number) {
      return alive.has(pid);
    },
    async readTail(path: string) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return "";
      }
    },
  };
}

function makeDeps(transport: FakeTransport, slack: FakeSlackGateway): DeployDeps {
  return {
    store,
    slack,
    transport,
    release: DEFAULT_RELEASE,
    repoPath: "/fake/repo",
    stateDir: dir,
    channelId: CHANNEL,
    targets: TARGETS,
    log,
    watchIntervalMs: 10,
  };
}

function harness(transport: FakeTransport): { slack: FakeSlackGateway; sync: SlackSync } {
  const slack = new FakeSlackGateway();
  const gateway = new FakeGateway([]);
  const sync = createSlackSync({
    slack,
    store,
    gateway,
    channelId: CHANNEL,
    operatorUserIds: [OPERATOR],
    log,
    repoExecutors: createDeployExecutors(makeDeps(transport, slack)),
  });
  return { slack, sync };
}

function rootMsg(sync: SlackSync, text: string, userId = OPERATOR) {
  return sync.handleInbound({ channel: CHANNEL, threadTs: null, ts: `${Math.random()}`, userId, text });
}

function offerToken(): string {
  return (JSON.parse(store.getMeta(DEPLOY_OFFER_KEY)!) as { token: string }).token;
}

describe("parseVerb / parseDeployArg", () => {
  it("parses deploy with target and optional version", () => {
    expect(parseVerb("deploy tei")).toEqual({ verb: "deploy", arg: "tei" });
    expect(parseVerb("Deploy mcpherson v0.1.0-canary.356")).toEqual({
      verb: "deploy",
      arg: "mcpherson v0.1.0-canary.356",
    });
    expect(parseDeployArg("tei", DEFAULT_RELEASE)).toEqual({ target: "tei" });
    expect(parseDeployArg("tei v0.1.0-canary.356", DEFAULT_RELEASE)).toEqual({ target: "tei", version: "v0.1.0-canary.356" });
    expect(parseDeployArg("tei not-a-version", DEFAULT_RELEASE)).toBeNull();
    expect(parseDeployArg(undefined, DEFAULT_RELEASE)).toBeNull();
  });
});

describe("deploy offer round-trip (channel root)", () => {
  it("`deploy tei` at the channel root offers the exact command + latest canary", async () => {
    const t = fakeTransport();
    const h = harness(t);
    await rootMsg(h.sync, "deploy tei");
    // Slow verb: ⏳ posted at root, then edited into the offer.
    const offer = h.slack.updates[h.slack.updates.length - 1];
    expect(offer.text).toContain("deploy tei");
    expect(offer.text).toContain("v0.1.0-canary.355");
    const body = JSON.stringify(offer.blocks);
    expect(body).toContain("AWS_PROFILE=tei");
    expect(body).toContain("--stage tei-e2e");
    expect(body).toContain("factory-console:deploy-confirm");
    expect(t.spawns).toHaveLength(0); // nothing runs before confirm
  });

  it("unknown target lists the configured ones", async () => {
    const t = fakeTransport();
    const h = harness(t);
    await rootMsg(h.sync, "deploy prod-oops");
    const final = h.slack.updates[h.slack.updates.length - 1];
    expect(final.text).toContain("Unknown deploy target");
    expect(final.text).toContain("`deploy tei`");
    expect(final.text).toContain("`deploy mcpherson`");
  });

  it("non-operator deploy is refused at the root; nothing offered", async () => {
    const t = fakeTransport();
    const h = harness(t);
    await rootMsg(h.sync, "deploy tei", STRANGER);
    expect(store.getMeta(DEPLOY_OFFER_KEY)).toBeUndefined();
    const last = h.slack.posts[h.slack.posts.length - 1];
    expect(last.text).toContain("only an authorized operator");
  });

  it("confirm spawns DETACHED with the confirmed argv/env and records the run", async () => {
    const t = fakeTransport();
    const h = harness(t);
    await rootMsg(h.sync, "deploy tei v0.1.0-canary.356");
    const token = offerToken();
    await h.sync.handleAction({
      channel: CHANNEL, messageTs: "1.1", threadTs: null, userId: OPERATOR,
      actionId: "factory-console:deploy-confirm",
      value: JSON.stringify({ v: "deploy-confirm", arg: token }),
    });
    expect(t.spawns).toHaveLength(1);
    const spawn = t.spawns[0];
    expect(spawn.command).toBe("/bin/bash");
    expect(spawn.args[1]).toContain("v0.1.0-canary.356");
    expect(spawn.args[1]).toContain("'--stage' 'tei-e2e'");
    expect(spawn.args[1]).toContain(DEPLOY_EXIT_MARKER);
    expect(spawn.env.AWS_PROFILE).toBe("tei");
    expect(spawn.env.PATH).toBeTruthy();
    const run = JSON.parse(store.getMeta(`${DEPLOY_RUNNING_KEY_PREFIX}tei`)!) as { pid: number };
    expect(t.alive.has(run.pid)).toBe(true);
    // Offer consumed; buttons stripped.
    expect(store.getMeta(DEPLOY_OFFER_KEY)).toBeUndefined();
  });

  it("a second `deploy tei` while one runs is refused with the log path", async () => {
    const t = fakeTransport();
    const h = harness(t);
    await rootMsg(h.sync, "deploy tei");
    await h.sync.handleAction({
      channel: CHANNEL, messageTs: "1.1", threadTs: null, userId: OPERATOR,
      actionId: "factory-console:deploy-confirm",
      value: JSON.stringify({ v: "deploy-confirm", arg: offerToken() }),
    });
    await rootMsg(h.sync, "deploy tei");
    const final = h.slack.updates[h.slack.updates.length - 1];
    expect(final.text).toContain("already running");
    expect(final.text).toContain("deploy-tei-");
    expect(t.spawns).toHaveLength(1);
  });

  it("cancel consumes the offer; stale-token confirm is a polite no-op", async () => {
    const t = fakeTransport();
    const h = harness(t);
    await rootMsg(h.sync, "deploy mcpherson");
    const token = offerToken();
    await h.sync.handleAction({
      channel: CHANNEL, messageTs: "1.1", threadTs: null, userId: OPERATOR,
      actionId: "factory-console:deploy-cancel",
      value: JSON.stringify({ v: "deploy-cancel", arg: token }),
    });
    expect(store.getMeta(DEPLOY_OFFER_KEY)).toBeUndefined();
    await h.sync.handleAction({
      channel: CHANNEL, messageTs: "1.1", threadTs: null, userId: OPERATOR,
      actionId: "factory-console:deploy-confirm",
      value: JSON.stringify({ v: "deploy-confirm", arg: token }),
    });
    expect(t.spawns).toHaveLength(0);
  });
});

describe("outcome watcher", () => {
  it("posts success when the exited process left EXIT:0 in the log", async () => {
    vi.useFakeTimers();
    try {
      const t = fakeTransport();
      const slack = new FakeSlackGateway();
      const deps = makeDeps(t, slack);
      const logPath = join(dir, "logs", "deploy-tei-x.log");
      mkdirSync(join(dir, "logs"), { recursive: true });
      writeFileSync(logPath, `doing things\n${DEPLOY_EXIT_MARKER}0\n`);
      store.setMeta(
        `${DEPLOY_RUNNING_KEY_PREFIX}tei`,
        JSON.stringify({ pid: 4242, logPath, version: "v0.1.0-canary.356", startedAt: "now" }),
      );
      // pid 4242 is NOT alive → first poll resolves the outcome.
      watchDeploy(deps, "tei");
      await vi.advanceTimersByTimeAsync(25);
      expect(slack.posts.some((p) => p.text.includes("✅") && p.text.includes("deploy tei"))).toBe(true);
      expect(store.getMeta(`${DEPLOY_RUNNING_KEY_PREFIX}tei`)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("posts failure with the log tail when the exit marker is non-zero", async () => {
    vi.useFakeTimers();
    try {
      const t = fakeTransport();
      const slack = new FakeSlackGateway();
      const deps = makeDeps(t, slack);
      const logPath = join(dir, "logs", "deploy-mcpherson-x.log");
      mkdirSync(join(dir, "logs"), { recursive: true });
      writeFileSync(logPath, `Error: Unsupported argument\n${DEPLOY_EXIT_MARKER}1\n`);
      store.setMeta(
        `${DEPLOY_RUNNING_KEY_PREFIX}mcpherson`,
        JSON.stringify({ pid: 4243, logPath, version: "v0.1.0-canary.356", startedAt: "now" }),
      );
      watchDeploy(deps, "mcpherson");
      await vi.advanceTimersByTimeAsync(25);
      const fail = slack.posts.find((p) => p.text.includes("❌"));
      expect(fail).toBeDefined();
      expect(JSON.stringify(fail!.blocks)).toContain("Unsupported argument");
    } finally {
      vi.useRealTimers();
    }
  });

  it("resumeDeployWatches re-arms watchers from meta after a restart", async () => {
    vi.useFakeTimers();
    try {
      const t = fakeTransport();
      const slack = new FakeSlackGateway();
      const deps = makeDeps(t, slack);
      const logPath = join(dir, "logs", "deploy-tei-y.log");
      mkdirSync(join(dir, "logs"), { recursive: true });
      writeFileSync(logPath, `${DEPLOY_EXIT_MARKER}0\n`);
      store.setMeta(
        `${DEPLOY_RUNNING_KEY_PREFIX}tei`,
        JSON.stringify({ pid: 999999, logPath, version: "v0.1.0-canary.356", startedAt: "now" }),
      );
      resumeDeployWatches(deps);
      await vi.advanceTimersByTimeAsync(25);
      expect(slack.posts.some((p) => p.text.includes("deploy tei"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("closed-thread reply (THINK-286 paper cut)", () => {
  function candidateFor(issue: FakeIssue): PollCandidate {
    return {
      issue,
      lane: "Claude",
      hasLfg: false,
      isVerification: false,
      blockerLabels: [],
      ledger: {
        ledger: { phase: "implement", lane: "Claude", worker: null, attempt: 0, blocker: null, compounded: false },
        prose: "",
        synthesized: true,
        warnings: [],
      },
      ledgerCommentId: null,
      comments: issue.comments,
    };
  }

  it("an issue verb in an unmapped thread gets the closed-thread reply, not silence", async () => {
    const t = fakeTransport();
    const h = harness(t);
    await h.sync.handleInbound({
      channel: CHANNEL,
      threadTs: "1234.5678", // no mapping — e.g. a just-un-enrolled thread
      ts: "9.9",
      userId: OPERATOR,
      text: "retry",
    });
    const reply = h.slack.repliesIn("1234.5678");
    expect(reply).toHaveLength(1);
    expect(reply[0].text).toContain("isn't tracking an issue anymore");
  });

  it("a REPO verb in an unmapped thread still runs (release/deploy work anywhere)", async () => {
    const t = fakeTransport();
    const h = harness(t);
    await h.sync.handleInbound({
      channel: CHANNEL,
      threadTs: "1234.5678",
      ts: "9.8",
      userId: OPERATOR,
      text: "deploy tei",
    });
    // The deploy offer landed in that thread (⏳ edit), not a closed-thread refusal.
    expect(store.getMeta(DEPLOY_OFFER_KEY)).toBeDefined();
  });

  it("a MAPPED thread still routes issue verbs normally", async () => {
    const t = fakeTransport();
    const slack = new FakeSlackGateway();
    const gateway = new FakeGateway([
      makeIssue({ identifier: "THINK-90", state: "In Progress", labels: ["Claude"] }),
    ]);
    const issue = (await gateway.getIssuesByIdentifier(["THINK-90"]))[0] as FakeIssue;
    const sync = createSlackSync({
      slack,
      store,
      gateway,
      channelId: CHANNEL,
      operatorUserIds: [OPERATOR],
      log,
      consoleExecutors: { logs: async () => ({ text: "tail here" }) },
      repoExecutors: createDeployExecutors(makeDeps(t, slack)),
    });
    await sync.syncCandidate(candidateFor(issue), {
      kind: "advance",
      toStatus: "In Progress",
      evidence: "x",
    });
    const row = store.getSlackThreadByIssue(issue.id)!;
    await sync.handleInbound({
      channel: CHANNEL,
      threadTs: row.thread_ts,
      ts: "9.7",
      userId: OPERATOR,
      text: "logs",
    });
    const replies = slack.repliesIn(row.thread_ts);
    expect(replies.some((p) => p.text.includes("tail here"))).toBe(true);
  });
});
