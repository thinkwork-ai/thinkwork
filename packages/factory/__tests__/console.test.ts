/**
 * U3 — the console routing spine: typed-verb parsing, per-state action sets,
 * the shared authorize → live-re-check → execute → ack pipeline (KTD2), and
 * the R4 help reply. Exercised through createSlackSync so the typed path and
 * the button path are proven to route through the SAME pipeline.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLogger, type Logger } from "../src/logger.js";
import type { PollCandidate } from "../src/linear/poller.js";
import {
  actionsForState,
  consoleButton,
  helpText,
  parseVerb,
  verbsForState,
  type ConsoleExecutor,
  type ConsoleVerb,
} from "../src/slack/console.js";
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
  dir = mkdtempSync(join(tmpdir(), "factory-console-test-"));
  store = openStore(dir);
  log = createLogger({ write: () => {}, level: "error" });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function candidateFor(issue: FakeIssue): PollCandidate {
  return {
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
        attempt: 0,
        blocker: null,
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

interface Harness {
  gateway: FakeGateway;
  slack: FakeSlackGateway;
  sync: SlackSync;
  threadTs: string;
}

/** Enroll an issue (thread mapped in the store) and return the harness. */
async function enrolled(
  issue: FakeIssue,
  executors: Partial<Record<ConsoleVerb, ConsoleExecutor>> = {},
): Promise<Harness> {
  const gateway = new FakeGateway([issue]);
  const slack = new FakeSlackGateway();
  const sync = createSlackSync({
    slack,
    store,
    gateway,
    channelId: CHANNEL,
    operatorUserIds: [OPERATOR],
    log,
    consoleExecutors: executors,
  });
  await sync.syncCandidate(candidateFor(issue), {
    kind: "advance",
    toStatus: issue.state,
    evidence: "seed",
  });
  const row = store.getSlackThreadByIssue(issue.id);
  if (row === undefined) throw new Error("enrollment did not map a thread");
  return { gateway, slack, sync, threadTs: row.thread_ts };
}

function typed(h: Harness, text: string, userId = OPERATOR) {
  return h.sync.handleInbound({
    channel: CHANNEL,
    threadTs: h.threadTs,
    ts: `${Date.now() / 1000}`,
    userId,
    text,
  });
}

function clicked(
  h: Harness,
  verb: ConsoleVerb,
  opts: { userId?: string; value?: string } = {},
) {
  return h.sync.handleAction({
    channel: CHANNEL,
    messageTs: "999.000001",
    threadTs: h.threadTs,
    userId: opts.userId ?? OPERATOR,
    actionId: `factory-console:${verb}`,
    value: opts.value ?? JSON.stringify({ v: verb }),
  });
}

function lastReply(h: Harness): string {
  const replies = h.slack.repliesIn(h.threadTs);
  return replies[replies.length - 1]?.text ?? "";
}

describe("parseVerb", () => {
  it("parses every verb, aliases, and args", () => {
    expect(parseVerb("result")).toEqual({ verb: "result" });
    expect(parseVerb("report")).toEqual({ verb: "result" });
    expect(parseVerb("approve")).toEqual({ verb: "approve" });
    expect(parseVerb("advance")).toEqual({ verb: "approve" });
    expect(parseVerb("logs")).toEqual({ verb: "logs" });
    expect(parseVerb("logs 50")).toEqual({ verb: "logs", arg: "50" });
    expect(parseVerb("merge 123")).toEqual({ verb: "merge", arg: "123" });
    expect(parseVerb("merge #123")).toEqual({ verb: "merge", arg: "123" });
    expect(parseVerb("Retry")).toEqual({ verb: "retry" });
    expect(parseVerb("pause")).toEqual({ verb: "pause" });
    expect(parseVerb("resume")).toEqual({ verb: "resume" });
    expect(parseVerb("release")).toEqual({ verb: "release" });
    expect(parseVerb("help")).toEqual({ verb: "help" });
    expect(parseVerb("<@UBOT> status? no — help")).toBeNull();
    expect(parseVerb("merge it plz")).toBeNull();
    expect(parseVerb("what about the tests")).toBeNull();
  });
});

describe("verbsForState / actionsForState", () => {
  it("a Verification milestone carries Approve (primary) + Result + Logs", () => {
    expect(verbsForState("Verification", [])).toEqual([
      "approve",
      "result",
      "logs",
      "retry",
      "pause",
    ]);
    const block = actionsForState("Verification", [])!;
    const els = block.elements as { action_id: string; style?: string }[];
    expect(els[0].action_id).toBe("factory-console:approve");
    expect(els[0].style).toBe("primary");
  });

  it("a Paused issue offers Resume, not Pause", () => {
    expect(verbsForState("In Progress", ["Paused"])).toContain("resume");
    expect(verbsForState("In Progress", ["Paused"])).not.toContain("pause");
  });

  it("Done offers only result", () => {
    expect(verbsForState("Done", [])).toEqual(["result"]);
  });

  it("consoleButton embeds the verb (+arg) as JSON value", () => {
    const b = consoleButton("merge", { arg: "123" });
    expect(JSON.parse(b.value!)).toEqual({ v: "merge", arg: "123" });
  });
});

describe("the action pipeline (KTD2)", () => {
  it("R17: a non-operator TYPED read verb is refused verbatim", async () => {
    const issue = makeIssue({ identifier: "THINK-40", state: "In Progress", labels: ["Claude"] });
    const h = await enrolled(issue, {
      result: async () => ({ text: "should never run" }),
    });
    await typed(h, "result", STRANGER);
    expect(lastReply(h)).toContain("only an authorized operator");
    expect(lastReply(h)).not.toContain("should never run");
  });

  it("R17: a non-operator BUTTON click is refused through the same pipeline", async () => {
    const issue = makeIssue({ identifier: "THINK-41", state: "In Progress", labels: ["Claude"] });
    let ran = false;
    const h = await enrolled(issue, {
      logs: async () => {
        ran = true;
        return { text: "tail" };
      },
    });
    await clicked(h, "logs", { userId: STRANGER });
    expect(ran).toBe(false);
    expect(lastReply(h)).toContain("only an authorized operator");
  });

  it("stale Approve (issue already Done) → polite no-op naming the current state", async () => {
    const issue = makeIssue({ identifier: "THINK-42", state: "In Progress", labels: ["Claude"] });
    const h = await enrolled(issue, {
      approve: async () => ({ text: "advanced" }),
    });
    issue.state = "Done"; // the live re-check must see the CURRENT state
    await clicked(h, "approve");
    expect(lastReply(h)).toContain("Done");
    expect(lastReply(h)).not.toContain("advanced");
  });

  it("typed verb and button run the SAME executor (R6 parity)", async () => {
    const issue = makeIssue({ identifier: "THINK-43", state: "Verification", labels: ["Claude"] });
    const calls: string[] = [];
    const h = await enrolled(issue, {
      approve: async (ctx) => {
        calls.push(`${ctx.identifier}:${ctx.userId}`);
        return { text: "✅ moved to Done" };
      },
    });
    await typed(h, "approve");
    await clicked(h, "approve");
    expect(calls).toEqual(["THINK-43:UOP", "THINK-43:UOP"]);
  });

  it("KTD2: a slow verb posts the interim ⏳ line, then edits it into the ack", async () => {
    const issue = makeIssue({ identifier: "THINK-44", state: "Verification", labels: ["Claude"] });
    let progressSeen = false;
    const h = await enrolled(issue, {
      result: async () => {
        progressSeen = h.slack
          .repliesIn(h.threadTs)
          .some((p) => p.text.startsWith("⏳"));
        return { text: "here is the result" };
      },
    });
    await typed(h, "result");
    expect(progressSeen).toBe(true);
    // The final ack EDITS the progress line (chat.update), not a new post.
    expect(h.slack.updates.some((u) => u.text === "here is the result")).toBe(true);
  });

  it("an executor failure is ACKED with the error (R11), never silent", async () => {
    const issue = makeIssue({ identifier: "THINK-45", state: "In Progress", labels: ["Claude"] });
    const h = await enrolled(issue, {
      retry: async () => {
        throw new Error("gh exploded");
      },
    });
    await typed(h, "retry");
    expect(lastReply(h)).toContain("gh exploded");
    expect(lastReply(h)).toContain("❌");
  });

  it("a verb with no executor acks 'not yet available'", async () => {
    const issue = makeIssue({ identifier: "THINK-46", state: "In Progress", labels: ["Claude"] });
    const h = await enrolled(issue, {});
    await typed(h, "pause");
    expect(lastReply(h)).toContain("isn't available yet");
  });

  it("malformed console value JSON is ignored with a log, nothing posts", async () => {
    const issue = makeIssue({ identifier: "THINK-47", state: "In Progress", labels: ["Claude"] });
    const h = await enrolled(issue, {
      result: async () => ({ text: "ran" }),
    });
    const before = h.slack.posts.length;
    await clicked(h, "result", { value: "{not json" });
    expect(h.slack.posts.length).toBe(before);
  });

  it("`logs 50` carries the count into the executor arg", async () => {
    const issue = makeIssue({ identifier: "THINK-48", state: "In Progress", labels: ["Claude"] });
    let arg: string | undefined;
    const h = await enrolled(issue, {
      logs: async (ctx) => {
        arg = ctx.arg;
        return { text: "tail" };
      },
    });
    await typed(h, "logs 50");
    expect(arg).toBe("50");
  });
});

describe("R4: help routing", () => {
  it("AE3: unknown text in a thread with NO open question lists state commands", async () => {
    const issue = makeIssue({ identifier: "THINK-50", state: "Verification", labels: ["Claude"] });
    const h = await enrolled(issue, {});
    await typed(h, "merge it plz");
    const reply = lastReply(h);
    expect(reply).not.toContain("isn't waiting on an answer (no");
    expect(reply).toContain("commands:");
    expect(reply).toContain("`approve`");
    expect(reply).toContain("`merge <pr#>`");
  });

  it("typed `help` answers with the state's command list", async () => {
    // Enroll while active (Done is terminal and never enrolls), then finish.
    const issue = makeIssue({ identifier: "THINK-51", state: "Verification", labels: ["Claude"] });
    const h = await enrolled(issue, {});
    issue.state = "Done";
    await typed(h, "help");
    expect(lastReply(h)).toContain("commands:");
    expect(lastReply(h)).toContain("`result`");
  });

  it("a VERB in a thread with an open question routes to the console, not the relay", async () => {
    const issue = makeIssue({
      identifier: "THINK-52",
      state: "In Progress",
      labels: ["Claude", "Needs User"],
      comments: [
        { id: "q1", body: "blocker:THINK-52:implement — which db?", authorId: "worker" },
      ],
    });
    let ran = false;
    const h = await enrolled(issue, {
      logs: async () => {
        ran = true;
        return { text: "tail" };
      },
    });
    await typed(h, "logs");
    expect(ran).toBe(true);
    // The blocker must NOT have been cleared — nothing was relayed.
    expect(issue.labels).toContain("Needs User");
  });

  it("NON-verb text in a blocked thread still relays as the answer", async () => {
    const issue = makeIssue({
      identifier: "THINK-53",
      state: "In Progress",
      labels: ["Claude", "Needs User"],
      comments: [
        { id: "q1", body: "blocker:THINK-53:implement — which db?", authorId: "worker" },
      ],
    });
    const h = await enrolled(issue, {});
    await typed(h, "use postgres with the shared cluster");
    expect(issue.labels).not.toContain("Needs User");
    expect(lastReply(h)).toContain("Relayed");
  });
});

describe("helpText", () => {
  it("renders the ref verbatim and only state-valid verbs (+merge/release)", () => {
    const text = helpText("<https://x|THINK-9>", "Done", []);
    expect(text).toContain("<https://x|THINK-9> (Done)");
    expect(text).toContain("`result`");
    expect(text).not.toContain("`approve`");
    expect(text).toContain("`merge <pr#>`");
  });
});
