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
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { GithubOps } from "../phases/evidence.js";
import {
  nextN,
  releaseTags,
  tagGlob,
  type ReleaseConfig,
} from "../domain/release.js";
import type { HostTransport } from "../workers/transport.js";
import type { Logger } from "../logger.js";
import { findNewestBaton } from "../phases/prompts.js";
import type { FactoryStore } from "../store/db.js";
import { actions, context, section, type ButtonSpec, type SlackBlock } from "./blocks.js";
import type { SlackGateway } from "./client.js";
import {
  buildAppendedBaton,
  relaunchReadStatus,
  RETRY_ANSWER_TEXT,
} from "./relay.js";
import { buildIssueStatus } from "./status.js";

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
  | "deploy"
  | "deploy-confirm"
  | "deploy-cancel"
  | "result"
  | "logs"
  | "help";

/**
 * Repo-scoped verbs (THINK-286): they act on the repo/stacks, not an issue,
 * so they work from ANY thread and from the channel root — no thread mapping
 * required. Everything else needs a live issue thread.
 */
export const REPO_VERBS: ReadonlySet<ConsoleVerb> = new Set([
  "release",
  "release-confirm",
  "release-cancel",
  "deploy",
  "deploy-confirm",
  "deploy-cancel",
]);

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
  const deploy = /^deploy(?:\s+(.+))?$/.exec(t);
  if (deploy) {
    return { verb: "deploy", ...(deploy[1] ? { arg: deploy[1].trim() } : {}) };
  }
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
  /**
   * Called with the ack MESSAGE's ts once posted/edited (null when the post
   * failed) — the release confirm stores it so a later click can strip the
   * offer's buttons (message state must match token state).
   */
  onPosted?(ts: string | null): void;
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
const SLOW_VERBS = new Set<ConsoleVerb>([
  "merge",
  "result",
  "release",
  "release-confirm",
  "deploy",
  "deploy-confirm",
]);

/** Context for a repo-scoped verb — no issue, maybe no thread. */
export interface RepoActionContext {
  channel: string;
  /** Present when invoked from inside a thread; null at the channel root. */
  threadTs: string | null;
  userId: string;
  arg?: string;
  /** Post an intermediate reply (same surface the ack lands on). */
  post(text: string, blocks?: SlackBlock[]): Promise<void>;
}

export type RepoExecutor = (ctx: RepoActionContext) => Promise<ConsoleAck>;

export interface ConsoleDeps {
  gateway: LinearGateway;
  slack: SlackGateway;
  store: FactoryStore;
  operatorUserIds: readonly string[];
  log: Logger;
  /** Per-verb executors — later units fill these in. */
  executors: Partial<Record<ConsoleVerb, ConsoleExecutor>>;
  /** Repo-scoped executors (release/deploy) — usable without an issue. */
  repoExecutors?: Partial<Record<ConsoleVerb, RepoExecutor>>;
}

export interface RepoActionInput {
  channel: string;
  threadTs: string | null;
  userId: string;
  verb: ConsoleVerb;
  arg?: string;
}

/**
 * The repo-scoped pipeline (THINK-286): authorize → execute → ack. No Linear
 * re-check (there is no issue), same allowlist gate, same interim ⏳ line for
 * slow verbs, same never-silent acks. Replies land in the invoking thread
 * when there is one, else the channel root.
 */
export async function runRepoAction(
  deps: ConsoleDeps,
  input: RepoActionInput,
): Promise<void> {
  const post = (text: string, blocks?: SlackBlock[]): Promise<string | null> =>
    (input.threadTs !== null
      ? deps.slack.postThreadReply(input.channel, input.threadTs, text, {
          blocks: blocks ?? [section(text)],
        })
      : deps.slack.postMessage(input.channel, text, {
          blocks: blocks ?? [section(text)],
        })
    ).catch((e: unknown) => {
      deps.log.warn("slack console: repo reply failed", {
        verb: input.verb,
        error: String(e),
      });
      return null;
    });

  if (!deps.operatorUserIds.includes(input.userId)) {
    deps.log.warn("slack console: non-operator refused (repo verb)", {
      verb: input.verb,
      userId: input.userId,
    });
    await post(
      `Thanks <@${input.userId}> — only an authorized operator can use the console. Ask an operator to run this.`,
    );
    return;
  }

  const executor = deps.repoExecutors?.[input.verb];
  if (executor === undefined) {
    await post(`\`${input.verb}\` isn't available yet — coming in a later factory update.`);
    return;
  }

  let progressTs: string | null = null;
  if (SLOW_VERBS.has(input.verb)) {
    progressTs = await post(`⏳ running ${input.verb}…`);
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
        ack.onPosted?.(progressTs);
        return;
      } catch (e) {
        deps.log.warn("slack console: repo progress edit failed — posting fresh", {
          error: String(e),
        });
      }
    }
    const ts = await post(ack.text, ack.blocks);
    ack.onPosted?.(ts);
  };

  try {
    const ack = await executor({
      channel: input.channel,
      threadTs: input.threadTs,
      userId: input.userId,
      arg: input.arg,
      post: async (text, blocks) => {
        await post(text, blocks);
      },
    });
    await finalAck(ack);
    deps.log.info("slack console: repo verb executed", {
      verb: input.verb,
      userId: input.userId,
    });
  } catch (e) {
    deps.log.warn("slack console: repo executor failed", {
      verb: input.verb,
      error: String(e),
    });
    await finalAck({
      text: `❌ \`${input.verb}\` failed: ${String(e).slice(0, 400)}`,
    });
  }
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
  const reply = (text: string, blocks?: SlackBlock[]): Promise<string | null> =>
    deps.slack
      .postThreadReply(input.channel, input.threadTs, text, {
        blocks: blocks ?? [section(text)],
      })
      .catch((e: unknown) => {
        deps.log.warn("slack console: reply post failed", {
          issue: input.identifier,
          verb: input.verb,
          error: String(e),
        });
        return null;
      });

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
        ack.onPosted?.(progressTs);
        return;
      } catch (e) {
        deps.log.warn("slack console: progress edit failed — posting fresh", {
          issue: input.identifier,
          error: String(e),
        });
      }
    }
    const ts = await reply(ack.text, ack.blocks);
    ack.onPosted?.(ts);
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

// ---------------------------------------------------------------------------
// Steering executors (U4): approve / retry / pause / resume
// ---------------------------------------------------------------------------

const NEEDS_USER_LABEL = "Needs User";
const VERIFICATION_FAILED_LABEL = "Verification Failed";

export interface SteeringDeps {
  gateway: LinearGateway;
  store: FactoryStore;
  log: Logger;
}

/** Human-short elapsed time, e.g. `1h40` / `12m` / `40s`. */
export function formatElapsed(startedAtIso: string, now: Date = new Date()): string {
  const seconds = Math.max(
    0,
    Math.round((now.getTime() - new Date(startedAtIso).getTime()) / 1000),
  );
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  return `${h}h${String(minutes % 60).padStart(2, "0")}`;
}

function refOf(issue: LinearIssueSnapshot): string {
  return issue.url ? `<${issue.url}|${issue.identifier}>` : `*${issue.identifier}*`;
}

/**
 * The issue-steering verbs (R7, R9). Wired into `SlackSyncDeps.consoleExecutors`
 * by the daemon bring-up; each returns the explicit R11 ack.
 */
export function createSteeringExecutors(
  deps: SteeringDeps,
): Partial<Record<ConsoleVerb, ConsoleExecutor>> {
  return {
    // R7: advance through the current human gate. The pipeline's staleCheck
    // already guaranteed the LIVE state is a gate in APPROVE_TARGETS.
    approve: async (ctx) => {
      const target = APPROVE_TARGETS[ctx.issue.state];
      if (target === undefined) {
        // Belt and suspenders — staleCheck should have refused already.
        return { text: `Approve doesn't apply — ${refOf(ctx.issue)} is in *${ctx.issue.state}*.` };
      }
      await deps.gateway.setState(ctx.issueId, target);
      return { text: `✅ Approved — ${refOf(ctx.issue)} → *${target}*.` };
    },

    // R9: relaunch the current phase from its newest baton. With a live
    // running attempt this is a polite no-op — the store's one-active-attempt
    // invariant makes a relaunch impossible, and killing the worker would
    // contradict the recoverable-single-click decision.
    retry: async (ctx) => {
      const status = buildIssueStatus(deps.store, ctx.issueId);
      const active = status?.activeAttempts[0];
      if (active !== undefined) {
        return {
          text: `${refOf(ctx.issue)} already has a running *${active.phase}* worker (attempt ${active.attemptNumber}, ${formatElapsed(active.startedAt)} in) — nothing relaunched. \`logs\` tails it.`,
        };
      }
      // Blocker cleanup + the retry baton note, so the next tick relaunches
      // with the operator's "no additional guidance" context on the baton.
      const cleared: string[] = [];
      for (const label of [NEEDS_USER_LABEL, VERIFICATION_FAILED_LABEL]) {
        if (ctx.issue.labels.includes(label)) {
          await deps.gateway.removeLabel(ctx.issueId, label);
          cleared.push(label);
        }
      }
      const readStatus = relaunchReadStatus(ctx.issue.state);
      if (readStatus !== null) {
        const comments = await deps.gateway
          .listComments(ctx.issueId)
          .catch(() => []);
        const prior = findNewestBaton(ctx.identifier, readStatus, comments);
        await deps.gateway.createComment(
          ctx.issueId,
          buildAppendedBaton(
            ctx.identifier,
            readStatus,
            prior?.body ?? null,
            ctx.userId,
            RETRY_ANSWER_TEXT,
          ),
        );
      }
      const clearedNote =
        cleared.length > 0 ? ` (cleared ${cleared.map((c) => `\`${c}\``).join(", ")})` : "";
      return {
        text: `🔁 Retry armed${clearedNote} — ${refOf(ctx.issue)} relaunches *${ctx.issue.state}* from its newest baton next tick.`,
      };
    },

    // R9 + KTD6: pause = the `Paused` blocker label. Visible and undoable in
    // Linear; the poller/engine's blocker-label handling does the rest.
    pause: async (ctx) => {
      if (ctx.issue.labels.includes("Paused")) {
        return { text: `${refOf(ctx.issue)} is already paused.` };
      }
      await deps.gateway.addLabel(ctx.issueId, "Paused");
      return {
        text: `⏸️ Paused — automation skips ${refOf(ctx.issue)} until \`resume\`. Running workers finish their current attempt.`,
      };
    },

    resume: async (ctx) => {
      if (!ctx.issue.labels.includes("Paused")) {
        return { text: `${refOf(ctx.issue)} isn't paused — nothing to resume.` };
      }
      await deps.gateway.removeLabel(ctx.issueId, "Paused");
      return { text: `▶️ Resumed — ${refOf(ctx.issue)} re-enters automation next tick.` };
    },
  };
}

// ---------------------------------------------------------------------------
// Merge executor (U5)
// ---------------------------------------------------------------------------

export interface MergeDeps {
  gateway: LinearGateway;
  store: FactoryStore;
  github: GithubOps;
  log: Logger;
}

/**
 * True when a PR belongs to this issue's factory work: its head is one of the
 * issue's attempt branches, or the PR is referenced (URL, `#N`, `/pull/N`) in
 * the issue's Linear comments. A typo'd number must never squash-merge an
 * arbitrary repo PR (R8's "factory PR" constraint, mechanized).
 */
async function prBelongsToIssue(
  deps: MergeDeps,
  issueId: string,
  pr: { number: number; url: string; headRefName: string },
): Promise<boolean> {
  const branches = (
    deps.store.db
      .prepare(
        "SELECT DISTINCT branch FROM attempts WHERE issue_id = ? AND branch IS NOT NULL",
      )
      .all(issueId) as { branch: string }[]
  ).map((r) => r.branch);
  if (branches.includes(pr.headRefName)) return true;
  const comments = await deps.gateway.listComments(issueId).catch(() => []);
  const needles = [pr.url, `#${pr.number}`, `/pull/${pr.number}`];
  return comments.some((c) => needles.some((n) => c.body.includes(n)));
}

/** `merge <pr#>` — checks visibility first, then squash + auto-merge (R8). */
export function createMergeExecutor(deps: MergeDeps): ConsoleExecutor {
  return async (ctx) => {
    const num = Number(ctx.arg);
    if (!Number.isInteger(num) || num <= 0) {
      return { text: "Usage: `merge <pr#>` — a numeric PR number is required." };
    }
    const pr = await deps.github.prView(num);
    if (pr === null) return { text: `PR #${num} not found in this repo.` };
    const prLink = `<${pr.url}|#${pr.number} ${pr.title}>`;
    if (pr.state === "MERGED") {
      return { text: `${prLink} is already merged — nothing to do.` };
    }
    if (pr.state === "CLOSED") {
      return { text: `${prLink} is closed — not merging.` };
    }
    if (!(await prBelongsToIssue(deps, ctx.issueId, pr))) {
      return {
        text: `⚠️ Refusing to merge ${prLink} (branch \`${pr.headRefName}\`) — it isn't associated with ${ctx.identifier} (no matching attempt branch, not referenced in its comments). Double-check the number.`,
      };
    }
    // Checks state BEFORE acting (R8) — the operator sees what they're arming.
    const checks = await deps.github.prChecks(num);
    const checksNote = checks.ok ? "checks green" : "checks NOT green";
    await ctx.post(
      `${prLink} — ${checksNote}:\n\`\`\`\n${checks.summary.slice(0, 2000)}\n\`\`\``,
    );
    const merge = await deps.github.prMerge(num);
    if (!merge.ok) {
      return {
        text: `❌ merge ${prLink} failed:\n\`\`\`\n${merge.output.slice(0, 1500)}\n\`\`\``,
      };
    }
    return {
      text: `🔀 ${prLink}: ${merge.output.split("\n")[0] || "auto-merge armed"} — merges (or merged) once checks pass.`,
    };
  };
}

/** The merged-PR note's buttons: Cut release + Result (F2 entry point). */
export function mergedPrNoteActions(): SlackBlock {
  return actions([
    consoleButton("release", { style: "primary" }),
    consoleButton("result"),
  ]);
}

/** A `Merge #N` button for surfaces that discovered an OPEN factory PR. */
export function mergeButton(pr: number): ButtonSpec {
  return consoleButton("merge", { arg: String(pr), label: `🔀 Merge #${pr}` });
}

// ---------------------------------------------------------------------------
// Inspection executors (U6): result / logs
// ---------------------------------------------------------------------------

export interface InspectionDeps {
  gateway: LinearGateway;
  store: FactoryStore;
  github: GithubOps;
  slack: SlackGateway;
  transport: HostTransport;
  /** Durable artifacts folder for an issue (config.getArtifactsDir). */
  artifactsDirFor(identifier: string): string;
  log: Logger;
}

/** Newest ≤`max` image files in a dir, by mtime desc. Missing dir → []. */
export function newestImages(dir: string, max: number): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f))
    .map((f) => {
      const path = join(dir, f);
      try {
        return { path, mtime: statSync(path).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((e): e is { path: string; mtime: number } => e !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, max)
    .map((e) => e.path);
}

const HANDOFF_SUMMARY_MAX = 1500;

/** URLs in comment bodies worth surfacing as result links. */
function collectLinks(comments: readonly { body: string }[]): {
  reports: string[];
  docs: string[];
} {
  const reports = new Set<string>();
  const docs = new Set<string>();
  for (const c of comments) {
    for (const m of c.body.matchAll(/https?:\/\/[^\s)>\]"']+/g)) {
      const url = m[0];
      if (/dogfood/i.test(url)) reports.add(url);
      else if (/linear\.app\/.+\/document\//.test(url)) docs.add(url);
    }
  }
  return { reports: [...reports].slice(-3), docs: [...docs].slice(-1) };
}

/**
 * The inspection verbs (R12–R14). Read-only, but STILL allowlist-gated by the
 * pipeline (R17): log tails and screenshots are disclosure.
 */
export function createInspectionExecutors(
  deps: InspectionDeps,
): Partial<Record<ConsoleVerb, ConsoleExecutor>> {
  return {
    // R12/R13: the newest phase artifact — handoff summary, merged PR links,
    // report/Progress links, then inline screenshot uploads (≤10 newest).
    result: async (ctx) => {
      const comments = await deps.gateway
        .listComments(ctx.issueId)
        .catch(() => []);
      // Newest handoff comment; the rolling ledger's prose as fallback.
      let summary: string | null = null;
      let summaryKind = "handoff";
      for (let i = comments.length - 1; i >= 0; i--) {
        const first = (comments[i].body.trimStart().split("\n", 1)[0] ?? "").trim();
        if (first.startsWith(`handoff:${ctx.identifier}:`)) {
          summary = comments[i].body;
          break;
        }
      }
      if (summary === null) {
        for (let i = comments.length - 1; i >= 0; i--) {
          const first = (comments[i].body.trimStart().split("\n", 1)[0] ?? "").trim();
          if (first.startsWith("automation-ledger:")) {
            summary = comments[i].body;
            summaryKind = "ledger";
            break;
          }
        }
      }

      // Merged PRs across this issue's attempt branches (newest 5 branches).
      const branches = (
        deps.store.db
          .prepare(
            "SELECT DISTINCT branch FROM attempts WHERE issue_id = ? AND branch IS NOT NULL ORDER BY id DESC LIMIT 5",
          )
          .all(ctx.issueId) as { branch: string }[]
      ).map((r) => r.branch);
      const prLinks: string[] = [];
      for (const branch of branches) {
        try {
          for (const pr of await deps.github.prsForBranch(branch)) {
            if (pr.state === "MERGED") prLinks.push(`<${pr.url}|#${pr.number}>`);
          }
        } catch {
          // GitHub unavailable — the rest of the result still renders.
        }
      }
      const { reports, docs } = collectLinks(comments);

      const ref = refOf(ctx.issue);
      const blocks: SlackBlock[] = [section(`*Result — ${ref}* (${ctx.issue.state})`)];
      if (summary !== null) {
        const body =
          summary.length > HANDOFF_SUMMARY_MAX
            ? summary.slice(0, HANDOFF_SUMMARY_MAX) + "\n_(truncated — full text in Linear)_"
            : summary;
        blocks.push(section(body));
      } else {
        blocks.push(section("_No handoff or ledger comment yet — no phase has completed._"));
      }
      const linkLines: string[] = [];
      if (prLinks.length > 0) linkLines.push(`Merged PRs: ${prLinks.join(", ")}`);
      if (reports.length > 0)
        linkLines.push(`Report: ${reports.map((u) => `<${u}|dogfood report>`).join(", ")}`);
      if (docs.length > 0) linkLines.push(`<${docs[0]}|Progress document>`);
      if (linkLines.length > 0) blocks.push(section(linkLines.join("\n")));

      // Screenshots: newest ≤10 from the durable artifacts folder (KTD5).
      const images = newestImages(deps.artifactsDirFor(ctx.identifier), 10);
      let uploadNote: string;
      if (images.length === 0) {
        uploadNote = "No screenshots on file for this issue (verify runs before the artifacts contract shipped leave none).";
      } else {
        try {
          await deps.slack.uploadFiles(ctx.channel, ctx.threadTs, images);
          uploadNote = `Uploaded ${images.length} screenshot${images.length === 1 ? "" : "s"} below.`;
        } catch (e) {
          uploadNote = `⚠️ Screenshot upload failed (${images.length} on file): ${String(e).slice(0, 300)}`;
          deps.log.warn("result: screenshot upload failed", {
            issue: ctx.identifier,
            error: String(e),
          });
        }
      }
      blocks.push(context(uploadNote));
      const fallback = `Result — ${ctx.identifier} (${summaryKind}${images.length > 0 ? `, ${images.length} screenshots` : ""})`;
      return { text: fallback, blocks };
    },

    // R14: the newest worker log's tail, sized for a phone.
    logs: async (ctx) => {
      const n = Math.min(Math.max(Number(ctx.arg) || 40, 5), 400);
      const attempt = deps.store.db
        .prepare(
          "SELECT phase, attempt_number, state, log_path FROM attempts WHERE issue_id = ? AND log_path IS NOT NULL ORDER BY active DESC, id DESC LIMIT 1",
        )
        .get(ctx.issueId) as
        | { phase: string; attempt_number: number; state: string; log_path: string }
        | undefined;
      if (attempt === undefined) {
        return { text: `${refOf(ctx.issue)} has no worker log yet.` };
      }
      const tail = await deps.transport.readTail(attempt.log_path, n);
      if (tail.trim() === "") {
        return {
          text: `${refOf(ctx.issue)}: log for ${attempt.phase} attempt ${attempt.attempt_number} is empty or gone (${attempt.log_path}).`,
        };
      }
      const header = `*Logs — ${ctx.identifier}* ${attempt.phase} attempt ${attempt.attempt_number} (${attempt.state}), last ${n} lines:`;
      // Fence the tail; section() truncates past the Slack limit with a note.
      return {
        text: `Logs — ${ctx.identifier} (${attempt.phase} #${attempt.attempt_number})`,
        blocks: [section(header), section("```\n" + tail + "\n```")],
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Release executors (U8, KTD3): confirm round-trip, sha-pinned
// ---------------------------------------------------------------------------

/** meta key holding the one-shot release-confirm offer (JSON ReleaseOffer). */
export const RELEASE_OFFER_KEY = "release-confirm-offer";

/** Confirm offers expire after 10 minutes — main moves while you decide. */
export const RELEASE_OFFER_TTL_MS = 10 * 60 * 1000;

interface ReleaseOffer {
  token: string;
  /** Every tag this cut mints (primary first), per the release scheme. */
  tags: string[];
  /** The exact origin/main sha shown to the operator — the sha that gets tagged. */
  sha: string;
  expiresAtMs: number;
  /** ts of the confirm MESSAGE (button-strip on resolve). */
  messageTs: string | null;
}

export interface ReleaseDeps {
  store: FactoryStore;
  slack: SlackGateway;
  transport: {
    exec(
      command: string,
      args: string[],
      opts?: { cwd?: string; timeoutMs?: number },
    ): Promise<{ code: number | null; stdout: string; stderr: string }>;
  };
  /** The daemon's repo checkout (tags are refs — no working-tree mutation). */
  repoPath: string;
  channelId: string;
  /** Tag scheme (templates with `<N>`), from config `release`. */
  release: ReleaseConfig;
  log: Logger;
}

/** Display form of a tag list: `` `a` + `b` ``. */
function fmtTags(tags: string[]): string {
  return tags.map((t) => `\`${t}\``).join(" + ");
}

async function git(
  deps: ReleaseDeps,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return deps.transport.exec("git", args, {
    cwd: deps.repoPath,
    timeoutMs: 60_000,
  });
}

function parseOffer(raw: string | undefined): ReleaseOffer | null {
  if (raw === undefined) return null;
  try {
    const o = JSON.parse(raw) as ReleaseOffer;
    return typeof o.token === "string" &&
      typeof o.sha === "string" &&
      Array.isArray(o.tags) &&
      o.tags.length > 0
      ? o
      : null;
  } catch {
    return null;
  }
}

/** Strip the confirm message's buttons and state the outcome (best-effort). */
async function resolveOfferMessage(
  deps: ReleaseDeps,
  offer: ReleaseOffer,
  outcome: string,
): Promise<void> {
  if (offer.messageTs === null) return;
  await deps.slack
    .updateMessage(deps.channelId, offer.messageTs, outcome, [section(outcome)])
    .catch((e: unknown) =>
      deps.log.warn("release: confirm-message update failed — stale buttons remain", {
        error: String(e),
      }),
    );
}

/**
 * The release verbs (R10, AE2). `release` posts a confirm offer naming the
 * exact tag pair AND the resolved origin/main sha; only a confirm click with
 * the matching one-shot token executes, and it tags THAT stored sha — if
 * origin/main has advanced, the offer is refused and a fresh one is required
 * (show-what-you-execute). Cancel and expiry consume the token harmlessly.
 */
export function createReleaseExecutors(
  deps: ReleaseDeps,
): Partial<Record<ConsoleVerb, RepoExecutor>> {
  return {
    release: async () => {
      const fetch = await git(deps, ["fetch", "--tags", "--quiet", "origin"]);
      if (fetch.code !== 0) {
        return {
          text: `❌ release: git fetch failed:\n\`\`\`\n${(fetch.stderr || fetch.stdout).slice(0, 800)}\n\`\`\``,
        };
      }
      const tagList = await git(deps, [
        "tag",
        "--list",
        tagGlob(deps.release.tagTemplate),
        "--sort=-version:refname",
      ]);
      const n = nextN(deps.release.tagTemplate, tagList.stdout);
      const cutTags = releaseTags(deps.release, n);
      const sha = (await git(deps, ["rev-parse", "origin/main"])).stdout.trim();
      if (!/^[0-9a-f]{7,40}$/.test(sha)) {
        return { text: `❌ release: couldn't resolve origin/main (${sha.slice(0, 120)}).` };
      }
      const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const offer: ReleaseOffer = {
        token,
        tags: cutTags,
        sha,
        expiresAtMs: Date.now() + RELEASE_OFFER_TTL_MS,
        messageTs: null,
      };
      deps.store.setMeta(RELEASE_OFFER_KEY, JSON.stringify(offer));
      const text = `Confirm cut ${fmtTags(cutTags)} at origin/main \`${sha.slice(0, 10)}\`? (expires in 10 min)`;
      return {
        text,
        blocks: [
          section(text),
          actions([
            consoleButton("release-confirm", {
              arg: token,
              label: "🚢 Confirm cut",
              style: "primary",
            }),
            consoleButton("release-cancel", { arg: token, label: "Cancel" }),
          ]),
        ],
        onPosted: (ts) => {
          if (ts === null) return;
          const stored = parseOffer(deps.store.getMeta(RELEASE_OFFER_KEY));
          if (stored !== null && stored.token === token) {
            deps.store.setMeta(
              RELEASE_OFFER_KEY,
              JSON.stringify({ ...stored, messageTs: ts }),
            );
          }
        },
      };
    },

    "release-confirm": async (ctx) => {
      const offer = parseOffer(deps.store.getMeta(RELEASE_OFFER_KEY));
      if (offer === null || offer.token !== ctx.arg) {
        return {
          text: "That release offer is no longer live (already used or superseded) — run `release` for a fresh one.",
        };
      }
      // One-shot: consume BEFORE executing — a double-tap must not double-tag.
      deps.store.deleteMeta(RELEASE_OFFER_KEY);
      if (Date.now() > offer.expiresAtMs) {
        await resolveOfferMessage(deps, offer, `⏰ Release offer for \`${offer.tags[0]}\` expired — run \`release\` again.`);
        return { text: `⏰ That offer expired — run \`release\` for a fresh one.` };
      }
      // Show-what-you-execute: refuse if origin/main advanced past the sha
      // the operator confirmed.
      await git(deps, ["fetch", "--quiet", "origin", "main"]);
      const head = (await git(deps, ["rev-parse", "origin/main"])).stdout.trim();
      if (head !== offer.sha) {
        await resolveOfferMessage(
          deps,
          offer,
          `⚠️ Offer for \`${offer.tags[0]}\` withdrawn — origin/main moved past \`${offer.sha.slice(0, 10)}\`.`,
        );
        return {
          text: `⚠️ origin/main advanced (\`${offer.sha.slice(0, 10)}\` → \`${head.slice(0, 10)}\`) since that offer — not tagging the new head silently. Run \`release\` again to confirm the current sha.`,
        };
      }
      // Collision guard, then tag THE STORED SHA and push every tag.
      for (const tag of offer.tags) {
        const exists = await git(deps, ["tag", "--list", tag]);
        if (exists.stdout.trim() !== "") {
          await resolveOfferMessage(deps, offer, `❌ Tag \`${tag}\` already exists — nothing cut.`);
          return { text: `❌ Tag \`${tag}\` already exists — nothing was cut. Run \`release\` to derive a fresh N.` };
        }
      }
      for (const tag of offer.tags) {
        const t = await git(deps, ["tag", tag, offer.sha]);
        if (t.code !== 0) {
          await resolveOfferMessage(deps, offer, `❌ \`git tag ${tag}\` failed — nothing pushed.`);
          return {
            text: `❌ \`git tag ${tag}\` failed:\n\`\`\`\n${(t.stderr || t.stdout).slice(0, 600)}\n\`\`\``,
          };
        }
      }
      const push = await git(deps, ["push", "origin", ...offer.tags]);
      if (push.code !== 0) {
        // Clean up the local tags so a retry can re-derive cleanly.
        for (const tag of offer.tags) await git(deps, ["tag", "-d", tag]);
        await resolveOfferMessage(deps, offer, `❌ Tag push failed — nothing cut.`);
        return {
          text: `❌ tag push failed (local tags cleaned up):\n\`\`\`\n${(push.stderr || push.stdout).slice(0, 800)}\n\`\`\``,
        };
      }
      await resolveOfferMessage(
        deps,
        offer,
        `🚢 Cut ${fmtTags(offer.tags)} at \`${offer.sha.slice(0, 10)}\` by <@${ctx.userId}>.`,
      );
      // Actions run URLs appear a few seconds after the push — short retry.
      const runLinks = await findRunLinks(deps, offer.tags);
      const runsNote =
        runLinks.length > 0
          ? `\nRuns: ${runLinks.join(" · ")}`
          : "\nRuns: not visible yet — check the Actions tab in a minute.";
      const schemeNote =
        deps.release.note !== undefined ? ` ${deps.release.note}` : "";
      return {
        text: `🚢 Cut ${fmtTags(offer.tags)} at \`${offer.sha.slice(0, 10)}\`.${schemeNote}${runsNote}`,
      };
    },

    "release-cancel": async (ctx) => {
      const offer = parseOffer(deps.store.getMeta(RELEASE_OFFER_KEY));
      if (offer === null || offer.token !== ctx.arg) {
        return { text: "That offer is already resolved — nothing to cancel." };
      }
      deps.store.deleteMeta(RELEASE_OFFER_KEY);
      await resolveOfferMessage(
        deps,
        offer,
        `🚫 Release offer for \`${offer.tags[0]}\` cancelled by <@${ctx.userId}>.`,
      );
      return { text: `🚫 Cancelled — no tag was cut.` };
    },
  };
}

/** Best-effort Actions run URLs for freshly pushed tags (3 tries, 4s apart). */
async function findRunLinks(
  deps: ReleaseDeps,
  tags: string[],
): Promise<string[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((r) => setTimeout(r, 4000));
    const links: string[] = [];
    for (const tag of tags) {
      const res = await deps.transport.exec(
        "gh",
        ["run", "list", "--branch", tag, "--limit", "1", "--json", "url"],
        { cwd: deps.repoPath, timeoutMs: 20_000 },
      );
      if (res.code === 0) {
        try {
          const parsed = JSON.parse(res.stdout) as { url?: string }[];
          if (parsed[0]?.url !== undefined) links.push(`<${parsed[0].url}|${tag}>`);
        } catch {
          // ignore — retry
        }
      }
    }
    if (links.length === tags.length) return links;
    if (attempt === 2 && links.length > 0) return links;
  }
  return [];
}
