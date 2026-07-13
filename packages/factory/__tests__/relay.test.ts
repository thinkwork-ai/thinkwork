/**
 * The inbound round-trip — U8's PROOF (R19 + KTD-7 amendment).
 *
 * An operator answers a daemon question by replying in the issue's Slack
 * thread; the reply must (1) append to the relaunch baton, (2) clear the
 * `Needs User` blocker, (3) mirror the resolution to Linear, and (4) ack in
 * the thread — and ONLY when the replier is on the operator allowlist. A
 * reply from anyone else is acknowledged but NEVER injected. A reply on an
 * issue with no open question is a polite no-op. Duplicate delivery relays
 * once.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLogger, type Logger } from "../src/logger.js";
import { handoffMarker } from "../src/phases/prompts.js";
import {
  relayAnswer,
  relayInboundMessage,
  SLACK_RELAY_MARKER_PREFIX,
  type RelayDeps,
} from "../src/slack/relay.js";
import { openStore, type FactoryStore } from "../src/store/db.js";
import { FakeGateway, makeIssue, type FakeIssue } from "./fake-gateway.js";
import { FakeSlackGateway } from "./fake-slack.js";

const CHANNEL = "C_FACTORY";
const THREAD_TS = "1700.000100";
const OPERATOR = "UOPERATOR";
const INTRUDER = "UINTRUDER";

let dir: string;
let store: FactoryStore;
let log: Logger;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-relay-test-"));
  store = openStore(dir);
  log = createLogger({ write: () => {}, level: "error" });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A Ready-to-Work issue blocked on Needs User, with a mapped Slack thread. */
function setup(overrides: Partial<FakeIssue> = {}): {
  issue: FakeIssue;
  linear: FakeGateway;
  slack: FakeSlackGateway;
  deps: RelayDeps;
} {
  const issue = makeIssue({
    identifier: "THINK-500",
    state: "Ready to Work",
    labels: ["Claude", "Needs User"],
    comments: [
      {
        id: "baton-1",
        body: `${handoffMarker("THINK-500", "Ready to Work")}\n\nGoal: implement the widget.`,
        authorId: "viewer-daemon",
      },
      {
        id: "q-1",
        body: "@eric1 1. Which auth provider? (recommend: Cognito)",
        authorId: "worker-user",
      },
    ],
    ...overrides,
  });
  const linear = new FakeGateway([issue]);
  const slack = new FakeSlackGateway();
  store.upsertSlackThread({
    issueId: issue.id,
    identifier: issue.identifier,
    channelId: CHANNEL,
    threadTs: THREAD_TS,
  });
  const deps: RelayDeps = {
    gateway: linear,
    slack,
    store,
    operatorUserIds: [OPERATOR],
    log,
  };
  return { issue, linear, slack, deps };
}

describe("relayInboundMessage — the answer round-trip", () => {
  it("allowlisted reply: appends to the baton, clears Needs User, mirrors, acks", async () => {
    const { issue, linear, slack, deps } = setup();

    const result = await relayInboundMessage(
      {
        channel: CHANNEL,
        threadTs: THREAD_TS,
        ts: "1700.000200",
        userId: OPERATOR,
        text: "Use Cognito.",
      },
      deps,
    );

    expect(result.relayed).toBe(true);
    expect(result.issueId).toBe(issue.id);

    // (1) A fresh, daemon-authored handoff baton carrying the answer verbatim
    // — newest wins, so the next relaunch injects it.
    const batonWrites = linear
      .writesOf("createComment")
      .filter((w) =>
        w.args[1].startsWith(handoffMarker("THINK-500", "Ready to Work")),
      );
    expect(batonWrites).toHaveLength(1);
    expect(batonWrites[0].args[1]).toContain("Use Cognito.");

    // (2) Needs User cleared.
    expect(linear.writesOf("removeLabel").map((w) => w.args)).toContainEqual([
      issue.id,
      "Needs User",
    ]);
    expect(issue.labels).not.toContain("Needs User");

    // (3) A mirror comment records the resolution on Linear.
    const mirror = linear
      .writesOf("createComment")
      .filter((w) => w.args[1].startsWith(SLACK_RELAY_MARKER_PREFIX));
    expect(mirror).toHaveLength(1);
    expect(mirror[0].args[1]).toContain("Use Cognito.");

    // (4) An ack lands in the thread.
    const replies = slack.repliesIn(THREAD_TS);
    expect(replies.length).toBeGreaterThanOrEqual(1);

    // High-water mark advanced for idempotency.
    expect(store.getSlackThreadByIssue(issue.id)!.last_relayed_ts).toBe(
      "1700.000200",
    );
  });

  it("non-allowlisted reply: acknowledged but NEVER injected — baton and blocker untouched", async () => {
    const { issue, linear, slack, deps } = setup();

    const result = await relayInboundMessage(
      {
        channel: CHANNEL,
        threadTs: THREAD_TS,
        ts: "1700.000200",
        userId: INTRUDER,
        text: "Use my sketchy provider.",
      },
      deps,
    );

    expect(result.relayed).toBe(false);
    expect(result.reason).toBe("unauthorized");

    // No baton write, no label removal — the blocker stays.
    expect(
      linear
        .writesOf("createComment")
        .filter((w) => w.args[1].startsWith("handoff:")),
    ).toHaveLength(0);
    expect(linear.writesOf("removeLabel")).toHaveLength(0);
    expect(issue.labels).toContain("Needs User");

    // But a polite ack was posted.
    expect(slack.repliesIn(THREAD_TS).length).toBeGreaterThanOrEqual(1);
  });

  it("issue not in a question state: polite no-op (no baton, no label change)", async () => {
    const { issue, linear, deps } = setup({
      labels: ["Claude"], // no Needs User
    });

    const result = await relayInboundMessage(
      {
        channel: CHANNEL,
        threadTs: THREAD_TS,
        ts: "1700.000200",
        userId: OPERATOR,
        text: "here's an answer nobody asked for",
      },
      deps,
    );

    expect(result.relayed).toBe(false);
    expect(result.reason).toBe("no-open-question");
    expect(
      linear
        .writesOf("createComment")
        .filter((w) => w.args[1].startsWith("handoff:")),
    ).toHaveLength(0);
    expect(linear.writesOf("removeLabel")).toHaveLength(0);
    void issue;
  });

  it("unmapped thread: ignored (no writes, no ack)", async () => {
    const { linear, slack, deps } = setup();

    const result = await relayInboundMessage(
      {
        channel: CHANNEL,
        threadTs: "9999.999999", // no mapping
        ts: "1700.000200",
        userId: OPERATOR,
        text: "hello?",
      },
      deps,
    );

    expect(result.relayed).toBe(false);
    expect(result.reason).toBe("no-thread-mapping");
    expect(linear.writes).toHaveLength(0);
    expect(slack.posts).toHaveLength(0);
  });

  it("root-level message (not a thread reply): ignored", async () => {
    const { deps } = setup();
    const result = await relayInboundMessage(
      {
        channel: CHANNEL,
        threadTs: null,
        ts: "1700.000200",
        userId: OPERATOR,
        text: "top-level chatter",
      },
      deps,
    );
    expect(result.relayed).toBe(false);
    expect(result.reason).toBe("not-a-thread-reply");
  });

  it("duplicate delivery of the same message relays exactly once", async () => {
    const { issue, linear, deps } = setup();
    const message = {
      channel: CHANNEL,
      threadTs: THREAD_TS,
      ts: "1700.000200",
      userId: OPERATOR,
      text: "Use Cognito.",
    };

    const first = await relayInboundMessage(message, deps);
    expect(first.relayed).toBe(true);

    const batonWritesAfterFirst = linear
      .writesOf("createComment")
      .filter((w) => w.args[1].startsWith("handoff:")).length;

    const second = await relayInboundMessage(message, deps);
    expect(second.relayed).toBe(false);
    expect(second.reason).toBe("duplicate");

    // No second baton write.
    expect(
      linear
        .writesOf("createComment")
        .filter((w) => w.args[1].startsWith("handoff:")).length,
    ).toBe(batonWritesAfterFirst);
    void issue;
  });

  it("relayAnswer via a button produces the same baton + mirror as a typed message", async () => {
    // Parity by construction: the button path calls the SAME core the typed
    // path does — assert the injected Linear artifacts are byte-identical.
    const typed = setup();
    await relayInboundMessage(
      {
        channel: CHANNEL,
        threadTs: THREAD_TS,
        ts: "1700.000200",
        userId: OPERATOR,
        text: "Q1: Read-only (drive.readonly)",
      },
      typed.deps,
    );

    // Fresh store row for the button run (same issue shape, separate fakes).
    store.deleteSlackThread(typed.issue.id);
    const clicked = setup();
    const result = await relayAnswer(clicked.deps, {
      channel: CHANNEL,
      threadTs: THREAD_TS,
      identifier: clicked.issue.identifier,
      issueId: clicked.issue.id,
      userId: OPERATOR,
      answer: "Q1: Read-only (drive.readonly)",
      source: "button",
    });
    expect(result.relayed).toBe(true);

    const artifacts = (linear: (typeof typed)["linear"]) =>
      linear.writesOf("createComment").map((w) => w.args[1]);
    expect(artifacts(clicked.linear)).toEqual(artifacts(typed.linear));

    // Buttons don't advance the message-ts high-water mark — that is the
    // typed path's idempotency; clicks rely on the no-open-question check.
    expect(
      store.getSlackThreadByIssue(clicked.issue.id)!.last_relayed_ts,
    ).toBeNull();
  });
});
