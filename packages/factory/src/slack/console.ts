/**
 * The operator console's routing spine (U3, KTD1/KTD2): per-state action
 * sets, `factory-console:*` button dispatch, typed-verb parsing, and the one
 * shared action pipeline every verb runs through —
 *
 *   authorize (R17) → live Linear re-check → execute → explicit ack (R11)
 *
 * Buttons and typed verbs are the SAME verb through the same pipeline; a
 * button's `value` carries only `{ v, arg? }` and the THREAD MAPPING resolves
 * the issue (KTD1) — a click on a stale message can never act on a stale
 * issue id.
 *
 * Verb EXECUTORS are injected (U4–U8 fill them in); a verb whose executor is
 * absent acks "not yet available" instead of silently dying — the pipeline,
 * refusals, and help are all live from this unit on.
 */

import type { LinearGateway, LinearIssueSnapshot } from "../linear/client.js";
import type { Logger } from "../logger.js";
import type { FactoryStore } from "../store/db.js";
import { actions, section, type ButtonSpec, type SlackBlock } from "./blocks.js";
import type { SlackGateway } from "./client.js";

/** Action-id prefix for every console button (gateway filters on `factory-`). */
export const CONSOLE_ACTION_PREFIX = "factory-console";

export type ConsoleVerb =
  | "approve"
  | "merge"
  | "retry"
  | "pause"
  | "resume"
  | "release"
  | "release-confirm"
  | "release-cancel"
  | "result"
  | "logs"
  | "help";

/** JSON payload carried in a console button's `value` (KTD1: minimal). */
export interface ConsoleButtonValue {
  v: ConsoleVerb;
  arg?: string;
}

export interface ParsedVerb {
  verb: ConsoleVerb;
  arg?: string;
}

/**
 * Parse a typed in-thread message as a console verb, or null when it is not
 * one. `report` and `advance` are pure aliases of `result` and `approve` —
 * they inherit those verbs' executors and behavior wholesale.
 */
export function parseVerb(text: string): ParsedVerb | null {
  const t = text
    .replace(/<@[^>]+>/g, "")
    .trim()
    .toLowerCase();
  if (/^(result|report)$/.test(t)) return { verb: "result" };
  if (/^(approve|advance)$/.test(t)) return { verb: "approve" };
  const logs = /^logs?(?:\s+(\d+))?$/.exec(t);
  if (logs) return { verb: "logs", ...(logs[1] ? { arg: logs[1] } : {}) };
  const merge = /^merge(?:\s+#?(\S+))?$/.exec(t);
  if (merge) return { verb: "merge", ...(merge[1] ? { arg: merge[1] } : {}) };
  if (/^retry$/.test(t)) return { verb: "retry" };
  if (/^pause$/.test(t)) return { verb: "pause" };
  if (/^resume$/.test(t)) return { verb: "resume" };
  if (/^release$/.test(t)) return { verb: "release" };
  if (/^(help|commands)\??$/.test(t)) return { verb: "help" };
  return null;
}

const PAUSED_LABEL = "Paused";

/** The three human gates `approve` advances, and where each one goes (R7). */
export const APPROVE_TARGETS: Readonly<Record<string, string>> = {
  "Requirements Review": "Planning",
  "Plan Review": "Ready to Work",
  Verification: "Done",
  Review: "Done",
};

interface VerbHelp {
  verb: ConsoleVerb;
  usage: string;
  blurb: string;
}

const VERB_HELP: readonly VerbHelp[] = [
  { verb: "approve", usage: "`approve`", blurb: "advance through the current review gate" },
  { verb: "result", usage: "`result`", blurb: "newest handoff, PRs, report + screenshots" },
  { verb: "logs", usage: "`logs [n]`", blurb: "tail of the newest worker log" },
  { verb: "merge", usage: "`merge <pr#>`", blurb: "squash-merge a factory PR" },
  { verb: "retry", usage: "`retry`", blurb: "relaunch the current phase from its baton" },
  { verb: "pause", usage: "`pause`", blurb: "suspend automation on this issue" },
  { verb: "resume", usage: "`resume`", blurb: "restore automation on this issue" },
  { verb: "release", usage: "`release`", blurb: "cut a web canary (confirm required)" },
];

/**
 * The verbs that make sense for an issue's current state — drives both the
 * per-message button set (R5) and the help reply (R4). Order = render order.
 */
export function verbsForState(
  state: string,
  labels: readonly string[],
): ConsoleVerb[] {
  const paused = labels.includes(PAUSED_LABEL);
  const pauseOrResume: ConsoleVerb = paused ? "resume" : "pause";
  if (state === "Done") return ["result"];
  if (APPROVE_TARGETS[state] !== undefined) {
    return ["approve", "result", "logs", "retry", pauseOrResume];
  }
  // Working states (Brainstorming/Planning/Ready to Work/In Progress/Debug…).
  return ["result", "logs", "retry", pauseOrResume];
}

const BUTTON_LABELS: Readonly<Record<string, string>> = {
  approve: "✅ Approve",
  result: "📄 Result",
  logs: "🪵 Logs",
  retry: "🔁 Retry",
  pause: "⏸️ Pause",
  resume: "▶️ Resume",
  merge: "🔀 Merge",
  release: "🚢 Cut release",
};

/** One console button. Exported so later units (merge/release) build theirs. */
export function consoleButton(
  verb: ConsoleVerb,
  opts: { arg?: string; label?: string; style?: "primary" | "danger" } = {},
): ButtonSpec {
  const value: ConsoleButtonValue = { v: verb, ...(opts.arg !== undefined ? { arg: opts.arg } : {}) };
  return {
    actionId: `${CONSOLE_ACTION_PREFIX}:${verb}`,
    label: opts.label ?? BUTTON_LABELS[verb] ?? verb,
    value: JSON.stringify(value),
    ...(opts.style !== undefined ? { style: opts.style } : {}),
  };
}

/**
 * The action buttons valid for an issue's state at post time (R5). Approve is
 * styled primary at a review gate — it is the one the operator came to tap.
 */
export function actionsForState(
  state: string,
  labels: readonly string[],
): SlackBlock | null {
  const verbs = verbsForState(state, labels);
  if (verbs.length === 0) return null;
  return actions(
    verbs.map((v) =>
      consoleButton(v, v === "approve" ? { style: "primary" } : {}),
    ),
  );
}

/**
 * The R4 help text: the commands valid for this issue's current state. `ref`
 * is rendered verbatim (pass a Slack link or a bare identifier). Merge and
 * release are always listed — they act on PRs/tags, not the issue's state.
 */
export function helpText(
  ref: string,
  state: string,
  labels: readonly string[],
): string {
  const verbs = new Set(verbsForState(state, labels));
  const lines = VERB_HELP.filter(
    (h) => verbs.has(h.verb) || h.verb === "merge" || h.verb === "release",
  ).map((h) => `• ${h.usage} — ${h.blurb}`);
  return `${ref} (${state}) — commands:\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// The action pipeline (KTD2)
// ---------------------------------------------------------------------------

/** What an executor hands back for the ack (R11: explicit, always). */
export interface ConsoleAck {
  text: string;
  blocks?: SlackBlock[];
}

export interface ConsoleActionContext {
  issueId: string;
  identifier: string;
  channel: string;
  threadTs: string;
  userId: string;
  arg?: string;
  /** LIVE issue snapshot from the pipeline's re-check — never a stored row. */
  issue: LinearIssueSnapshot;
  /**
   * Replace the interim progress line (slow verbs) or post a fresh reply with
   * intermediate output (e.g. merge's checks summary) BEFORE the final ack.
   */
  post(text: string, blocks?: SlackBlock[]): Promise<void>;
}

export type ConsoleExecutor = (
  ctx: ConsoleActionContext,
) => Promise<ConsoleAck>;

/**
 * Verbs whose executor is expected to exceed ~2s (KTD2): the pipeline posts
 * an immediate `⏳ <verb>…` line before executing and edits it into the final
 * ack — a silent button on a phone reads as dead and invites a double-tap.
 */
const SLOW_VERBS = new Set<ConsoleVerb>(["merge", "result", "release", "release-confirm"]);

export interface ConsoleDeps {
  gateway: LinearGateway;
  slack: SlackGateway;
  store: FactoryStore;
  operatorUserIds: readonly string[];
  log: Logger;
  /** Per-verb executors — later units fill these in. */
  executors: Partial<Record<ConsoleVerb, ConsoleExecutor>>;
}

export interface ConsoleActionInput {
  channel: string;
  threadTs: string;
  userId: string;
  issueId: string;
  identifier: string;
  verb: ConsoleVerb;
  arg?: string;
}

/**
 * Per-verb live-state validity (the stale-button guard): `null` when the verb
 * applies; otherwise the polite no-op text naming the CURRENT state.
 */
function staleCheck(
  verb: ConsoleVerb,
  issue: LinearIssueSnapshot,
  link: string,
): string | null {
  if (verb === "approve" && APPROVE_TARGETS[issue.state] === undefined) {
    return `Approve doesn't apply — ${link} is in *${issue.state}*, not a review gate.`;
  }
  if ((verb === "retry" || verb === "pause" || verb === "resume") && issue.state === "Done") {
    return `${link} is Done — nothing to ${verb}.`;
  }
  return null;
}

/**
 * Run one console action through the shared pipeline. Every reply is posted
 * into the issue thread; failures ack the failure (R11) rather than staying
 * silent. Never throws.
 */
export async function runConsoleAction(
  deps: ConsoleDeps,
  input: ConsoleActionInput,
): Promise<void> {
  const reply = (text: string, blocks?: SlackBlock[]) =>
    deps.slack
      .postThreadReply(input.channel, input.threadTs, text, {
        blocks: blocks ?? [section(text)],
      })
      .catch((e: unknown) =>
        deps.log.warn("slack console: reply post failed", {
          issue: input.identifier,
          verb: input.verb,
          error: String(e),
        }),
      );

  // (1) Authorization — R17: EVERY verb, reads included (log tails and
  // screenshots are disclosure), button or typed, gates on the allowlist.
  if (!deps.operatorUserIds.includes(input.userId)) {
    deps.log.warn("slack console: non-operator refused", {
      issue: input.identifier,
      verb: input.verb,
      userId: input.userId,
    });
    await reply(
      `Thanks <@${input.userId}> — only an authorized operator can use the console. Ask an operator to run this.`,
    );
    return;
  }

  // (2) Live Linear re-check — the store's issue row lags reality, and a
  // button can be tapped hours after its message posted.
  let issue: LinearIssueSnapshot | undefined;
  try {
    [issue] = await deps.gateway.getIssuesByIdentifier([input.identifier]);
  } catch (e) {
    deps.log.warn("slack console: live re-check failed", {
      issue: input.identifier,
      verb: input.verb,
      error: String(e),
    });
    await reply(
      `Couldn't reach Linear to check ${input.identifier}'s current state — try again in a moment.`,
    );
    return;
  }
  if (issue === undefined) {
    await reply(`${input.identifier} isn't in Linear anymore — nothing to do.`);
    return;
  }
  const link = issue.url ? `<${issue.url}|${issue.identifier}>` : `*${issue.identifier}*`;

  if (input.verb === "help") {
    await reply(helpText(link, issue.state, issue.labels));
    return;
  }

  // (3) Stale-button guard: the action must still apply to the LIVE state.
  const stale = staleCheck(input.verb, issue, link);
  if (stale !== null) {
    await reply(stale);
    return;
  }

  const executor = deps.executors[input.verb];
  if (executor === undefined) {
    await reply(`\`${input.verb}\` isn't available yet — coming in a later factory update.`);
    return;
  }

  // (4) Interim progress line for slow verbs, edited into the final ack.
  let progressTs: string | null = null;
  if (SLOW_VERBS.has(input.verb)) {
    const progress = `⏳ ${input.verb === "merge" ? `merging${input.arg !== undefined ? ` #${input.arg}` : ""}` : `running ${input.verb}`}…`;
    progressTs = await deps.slack
      .postThreadReply(input.channel, input.threadTs, progress, {
        blocks: [section(progress)],
      })
      .catch((e: unknown) => {
        deps.log.warn("slack console: progress line failed", {
          issue: input.identifier,
          error: String(e),
        });
        return null;
      });
  }

  const finalAck = async (ack: ConsoleAck): Promise<void> => {
    if (progressTs !== null) {
      try {
        await deps.slack.updateMessage(
          input.channel,
          progressTs,
          ack.text,
          ack.blocks ?? [section(ack.text)],
        );
        return;
      } catch (e) {
        deps.log.warn("slack console: progress edit failed — posting fresh", {
          issue: input.identifier,
          error: String(e),
        });
      }
    }
    await reply(ack.text, ack.blocks);
  };

  // (5) Execute → ack. An executor failure is ACKED (R11), never silent.
  try {
    const ack = await executor({
      issueId: input.issueId,
      identifier: input.identifier,
      channel: input.channel,
      threadTs: input.threadTs,
      userId: input.userId,
      arg: input.arg,
      issue,
      post: async (text, blocks) => {
        await reply(text, blocks);
      },
    });
    await finalAck(ack);
    deps.log.info("slack console: verb executed", {
      issue: input.identifier,
      verb: input.verb,
      userId: input.userId,
    });
  } catch (e) {
    deps.log.warn("slack console: executor failed", {
      issue: input.identifier,
      verb: input.verb,
      error: String(e),
    });
    await finalAck({
      text: `❌ \`${input.verb}\` failed on ${link}: ${String(e).slice(0, 400)}`,
    });
  }
}
