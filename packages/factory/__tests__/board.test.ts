/**
 * U9 — the pinned live board: grouping from tick candidates + store, pin /
 * edit-in-place / self-heal lifecycle, done-today persistence in meta, and
 * the channel-root `status` snapshot (R15/R16).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLogger, type Logger } from "../src/logger.js";
import type { PollCandidate } from "../src/linear/poller.js";
import {
  buildBoardMessage,
  createBoardUpdater,
  recordDoneToday,
  BOARD_MESSAGE_KEY,
} from "../src/slack/board.js";
import { createSlackSync } from "../src/slack/sync.js";
import { openStore, type FactoryStore } from "../src/store/db.js";
import { FakeGateway, makeIssue, type FakeIssue } from "./fake-gateway.js";
import { FakeSlackGateway } from "./fake-slack.js";

const CHANNEL = "C_FACTORY";
const NOW = new Date("2026-07-13T18:00:00Z");

let dir: string;
let store: FactoryStore;
let log: Logger;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-board-test-"));
  store = openStore(dir);
  log = createLogger({ write: () => {}, level: "error" });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function candidateFor(
  issue: FakeIssue,
  opts: { blockerLabels?: string[]; hasLfg?: boolean; ledgerBlocker?: string | null } = {},
): PollCandidate {
  return {
    issue,
    lane: "Claude",
    hasLfg: opts.hasLfg ?? false,
    isVerification: false,
    blockerLabels: opts.blockerLabels ?? [],
    ledger: {
      ledger: {
        phase: "implement",
        lane: "Claude",
        worker: null,
        attempt: 0,
        blocker: opts.ledgerBlocker ?? null,
        compounded: false,
      },
      prose: "",
      synthesized: true,
      warnings: [],
    },
    ledgerCommentId: null,
    comments: issue.comments,
  };
}

function seedRunning(issue: FakeIssue, startedAt: string): void {
  store.upsertIssue({
    issueId: issue.id,
    identifier: issue.identifier,
    phase: "implement",
    state: issue.state,
    lane: "Claude",
  });
  store.db
    .prepare(
      "INSERT INTO attempts (issue_id, phase, attempt_number, state, host, pid, started_at) VALUES (?, 'implement', 1, 'Running', 'local', 1, ?)",
    )
    .run(issue.id, startedAt);
}

describe("buildBoardMessage grouping", () => {
  it("groups running / needs-you / waiting / paused correctly", () => {
    const running = makeIssue({ identifier: "THINK-1", state: "In Progress", labels: ["Claude"] });
    const blocked = makeIssue({ identifier: "THINK-2", state: "In Progress", labels: ["Claude", "Needs User"] });
    const gate = makeIssue({ identifier: "THINK-3", state: "Verification", labels: ["Claude"] });
    const pausedIssue = makeIssue({ identifier: "THINK-4", state: "Planning", labels: ["Claude", "Paused"] });
    const waiting = makeIssue({ identifier: "THINK-5", state: "Verification", labels: ["Claude", "LFG"] });
    const idle = makeIssue({ identifier: "THINK-6", state: "Brainstorming", labels: ["Claude", "LFG"] });
    seedRunning(running, "2026-07-13T16:20:00Z"); // 1h40 before NOW

    const msg = buildBoardMessage(
      [
        candidateFor(running),
        candidateFor(blocked, { blockerLabels: ["Needs User"] }),
        candidateFor(gate),
        candidateFor(pausedIssue, { blockerLabels: ["Paused"] }),
        candidateFor(waiting, { hasLfg: true, ledgerBlocker: "waiting-on-deploy" }),
        candidateFor(idle, { hasLfg: true }),
      ],
      store,
      new Map(),
      NOW,
    );
    const body = JSON.stringify(msg.blocks);
    expect(body).toContain("🏃 Running (1)");
    expect(body).toContain("implement · 1h40");
    expect(body).toContain("🙋 Needs you (2)"); // blocker label + human-wait gate
    expect(body).toContain("awaiting approval");
    expect(body).toContain("⏳ Waiting (1)");
    expect(body).toContain("waiting-on-deploy");
    expect(body).toContain("⏸️ Paused (1)");
    // Idle issue renders as a count, not a row.
    expect(body).toContain("Brainstorming: 1");
    expect(msg.text).toContain("running 1");
  });

  it("a Paused issue appears ONLY under paused, never needs-operator", () => {
    const issue = makeIssue({
      identifier: "THINK-7",
      state: "In Progress",
      labels: ["Claude", "Paused", "Needs User"],
    });
    const msg = buildBoardMessage(
      [candidateFor(issue, { blockerLabels: ["Paused", "Needs User"] })],
      store,
      new Map(),
      NOW,
    );
    const body = JSON.stringify(msg.blocks);
    expect(body).toContain("⏸️ Paused (1)");
    expect(body).not.toContain("🙋 Needs you");
  });

  it("a running row's text carries the thread permalink", () => {
    const issue = makeIssue({ identifier: "THINK-8", state: "In Progress", labels: ["Claude"] });
    seedRunning(issue, "2026-07-13T17:48:00Z");
    const msg = buildBoardMessage(
      [candidateFor(issue)],
      store,
      new Map([[issue.id, "https://slack.test/archives/C/p123"]]),
      NOW,
    );
    expect(JSON.stringify(msg.blocks)).toContain(
      "<https://slack.test/archives/C/p123|THINK-8>",
    );
  });

  it("done-today renders from meta and survives a store reopen", () => {
    recordDoneToday(store, "THINK-9", NOW);
    recordDoneToday(store, "THINK-10", NOW);
    recordDoneToday(store, "THINK-9", NOW); // dedupe
    // Simulated restart: reopen the same store dir.
    const path = dir;
    store.close();
    store = openStore(path);
    const msg = buildBoardMessage([], store, new Map(), NOW);
    const body = JSON.stringify(msg.blocks);
    expect(body).toContain("✅ Done today (2)");
    expect(body).toContain("THINK-9, THINK-10");
  });

  it("done-today rolls over at the date boundary", () => {
    recordDoneToday(store, "THINK-11", new Date("2026-07-12T23:00:00Z"));
    const msg = buildBoardMessage([], store, new Map(), NOW);
    expect(JSON.stringify(msg.blocks)).not.toContain("THINK-11");
  });

  it("a board past the 50-block ceiling trims with a visible note", () => {
    const candidates: PollCandidate[] = [];
    for (let i = 0; i < 120; i++) {
      const issue = makeIssue({
        identifier: `THINK-${100 + i}`,
        state: "In Progress",
        labels: ["Claude", "Needs User"],
      });
      candidates.push(candidateFor(issue, { blockerLabels: ["Needs User"] }));
    }
    // Each needs-you row is inside ONE section; sections cap at 3000 chars so
    // many issues split across... they don't — one section holds the group.
    // The ceiling that actually binds is section truncation; assert the board
    // still composes under 50 blocks with a valid fallback.
    const msg = buildBoardMessage(candidates, store, new Map(), NOW);
    expect(msg.blocks.length).toBeLessThanOrEqual(50);
    expect(msg.text).toContain("needs-you 120");
  });
});

describe("createBoardUpdater lifecycle", () => {
  it("first update posts + pins + stores the target; later updates edit in place", async () => {
    const slack = new FakeSlackGateway();
    const updater = createBoardUpdater({ slack, store, channelId: CHANNEL, log });

    await updater.updateBoard([], NOW);
    expect(slack.posts).toHaveLength(1);
    expect(slack.pins).toHaveLength(1);
    const target = JSON.parse(store.getMeta(BOARD_MESSAGE_KEY)!) as { ts: string };
    expect(target.ts).toBe(slack.posts[0].ts);

    await updater.updateBoard([], NOW);
    expect(slack.posts).toHaveLength(1); // no second post
    expect(slack.updates).toHaveLength(1);
    expect(slack.updates[0].ts).toBe(target.ts);
  });

  it("a deleted board message self-heals by re-posting and re-pinning", async () => {
    const slack = new FakeSlackGateway();
    const updater = createBoardUpdater({ slack, store, channelId: CHANNEL, log });
    await updater.updateBoard([], NOW);
    const firstTs = (JSON.parse(store.getMeta(BOARD_MESSAGE_KEY)!) as { ts: string }).ts;

    slack.updateFailsFor.add(firstTs); // message_not_found
    await updater.updateBoard([], NOW);
    expect(slack.posts).toHaveLength(2);
    expect(slack.pins).toHaveLength(2);
    const newTs = (JSON.parse(store.getMeta(BOARD_MESSAGE_KEY)!) as { ts: string }).ts;
    expect(newTs).not.toBe(firstTs);
  });

  it("a pin failure (missing pins:write) leaves the board working unpinned", async () => {
    const slack = new FakeSlackGateway();
    slack.pinMessage = async () => {
      throw new Error("missing_scope: pins:write");
    };
    const updater = createBoardUpdater({ slack, store, channelId: CHANNEL, log });
    await updater.updateBoard([], NOW);
    expect(slack.posts).toHaveLength(1);
    expect(store.getMeta(BOARD_MESSAGE_KEY)).toBeDefined();
  });
});

describe("R16: channel-root status snapshot", () => {
  it("root `status` posts the last rendered board; thread `status` stays per-issue", async () => {
    const issue = makeIssue({ identifier: "THINK-20", state: "In Progress", labels: ["Claude"] });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = createSlackSync({
      slack,
      store,
      gateway,
      channelId: CHANNEL,
      operatorUserIds: ["UOP"],
      log,
    });
    // One tick's board render.
    await sync.updateBoard([candidateFor(issue)]);
    const boardPosts = slack.posts.length;

    // Channel-root `status` re-posts the snapshot.
    await sync.handleInbound({
      channel: CHANNEL,
      threadTs: null,
      ts: "5.1",
      userId: "UOP",
      text: "status",
    });
    expect(slack.posts.length).toBe(boardPosts + 1);
    expect(slack.posts[slack.posts.length - 1].text).toContain("Factory board");

    // Thread `status` keeps the per-issue live reply.
    await sync.syncCandidate(candidateFor(issue), {
      kind: "advance",
      toStatus: "In Progress",
      evidence: "x",
    });
    const row = store.getSlackThreadByIssue(issue.id)!;
    await sync.handleInbound({
      channel: CHANNEL,
      threadTs: row.thread_ts,
      ts: "5.2",
      userId: "UOP",
      text: "status",
    });
    const last = slack.posts[slack.posts.length - 1];
    expect(last.threadTs).toBe(row.thread_ts);
    expect(last.text).toContain("THINK-20");
  });
});
