/**
 * Thread lifecycle (U8): one thread per issue, idempotent across restarts;
 * escalations @mention the operators, milestones do not.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLogger, type Logger } from "../src/logger.js";
import {
  openThreadForIssue,
  postEscalation,
  postMilestone,
  postNag,
  type ThreadDeps,
} from "../src/slack/threads.js";
import { openStore, type FactoryStore } from "../src/store/db.js";
import { FakeSlackGateway } from "./fake-slack.js";

const CHANNEL = "C_FACTORY";
const OPERATORS = ["UOP1", "UOP2"];

let dir: string;
let store: FactoryStore;
let log: Logger;
let slack: FakeSlackGateway;
let deps: ThreadDeps;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-threads-test-"));
  store = openStore(dir);
  log = createLogger({ write: () => {}, level: "error" });
  slack = new FakeSlackGateway();
  deps = {
    slack,
    store,
    channelId: CHANNEL,
    operatorUserIds: OPERATORS,
    log,
  };
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const target = {
  issueId: "uuid-THINK-700",
  identifier: "THINK-700",
  title: "Ship the thing",
};

describe("openThreadForIssue", () => {
  it("opens exactly one thread and persists the mapping", async () => {
    const ref = await openThreadForIssue(target, deps);
    expect(ref.channel).toBe(CHANNEL);
    expect(slack.posts).toHaveLength(1); // one root message
    const row = store.getSlackThreadByIssue(target.issueId);
    expect(row).toBeDefined();
    expect(row!.thread_ts).toBe(ref.threadTs);
    expect(row!.identifier).toBe("THINK-700");
  });

  it("is idempotent — a second call reuses the thread, posts nothing new", async () => {
    const first = await openThreadForIssue(target, deps);
    const second = await openThreadForIssue(target, deps);
    expect(second.threadTs).toBe(first.threadTs);
    expect(slack.posts).toHaveLength(1); // still just the one root message
  });

  it("reuses the mapping across a daemon restart (fresh store handle, same dir)", async () => {
    const first = await openThreadForIssue(target, deps);
    store.close();
    // Simulate a restart: reopen the same DB directory.
    store = openStore(dir);
    const slack2 = new FakeSlackGateway();
    const deps2: ThreadDeps = { ...deps, slack: slack2, store };
    const afterRestart = await openThreadForIssue(target, deps2);
    expect(afterRestart.threadTs).toBe(first.threadTs);
    expect(slack2.posts).toHaveLength(0); // no new root message after restart
  });
});

describe("outbound posts", () => {
  it("escalation @mentions the operators; milestone does not", async () => {
    const ref = await openThreadForIssue(target, deps);
    slack.posts.length = 0; // ignore the root message

    await postMilestone(ref, "Launched implement.", deps);
    await postEscalation(ref, "Needs an answer.", deps);

    const [milestone, escalation] = slack.posts;
    expect(milestone.mentionUserIds ?? []).toEqual([]);
    expect(milestone.threadTs).toBe(ref.threadTs);

    expect(escalation.mentionUserIds).toEqual(OPERATORS);
    // Rendered text carries the <@U…> mentions.
    expect(escalation.text).toContain("<@UOP1>");
    expect(escalation.text).toContain("<@UOP2>");
    expect(escalation.threadTs).toBe(ref.threadTs);
  });

  it("postNag (U6 seam) @mentions the operators", async () => {
    const ref = await openThreadForIssue(target, deps);
    slack.posts.length = 0;
    await postNag(ref, "Still waiting on your answer.", deps);
    expect(slack.posts[0].mentionUserIds).toEqual(OPERATORS);
  });
});

describe("root-message console buttons (gate-enrolled issues)", () => {
  it("carries the state's buttons when state is provided — a Verification enrollment is tappable from message one", async () => {
    await openThreadForIssue(
      {
        issueId: "uuid-1",
        identifier: "THINK-276",
        title: "console",
        url: "https://linear.test/THINK-276",
        state: "Verification",
        labels: [],
      },
      deps,
    );
    const root = slack.posts[0];
    const body = JSON.stringify(root.blocks);
    expect(body).toContain("factory-console:approve");
    expect(body).toContain("factory-console:result");
  });

  it("omits buttons when state is unknown (legacy callers unchanged)", async () => {
    await openThreadForIssue(
      { issueId: "uuid-2", identifier: "THINK-1", title: "t" },
      deps,
    );
    const root = slack.posts[0];
    expect(JSON.stringify(root.blocks ?? [])).not.toContain("factory-console:");
  });
});
