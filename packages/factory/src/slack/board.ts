/**
 * The pinned live board (U9, R15/R16): ONE channel message showing the whole
 * factory, silently edited in place every daemon tick (chat.update never
 * notifies). First post pins it; a deleted board self-heals by re-posting.
 *
 * Data source is the tick's PollCandidates joined with the store (KTD4): the
 * store alone cannot build the board — `issues` has no labels column and its
 * rows refresh only when launches settle. Done issues leave the poll set, so
 * done-today is persisted into `meta` by the un-enroll pass and survives
 * restarts.
 *
 * Groups: running (phase + elapsed), needs-you (blocker labels excluding
 * `Paused`, plus human-wait review gates), paused (its OWN group — a
 * deliberate pause must not read as stuck-waiting-on-you), waiting (ledger
 * blocker: `waiting-on THINK-x`, `waiting-on-deploy`), done-today. Idle
 * states render as counts only. Enrolled rows link to their Slack THREAD via
 * chat.getPermalink (F3 jumps board → thread, never board → Linear).
 */

import type { PollCandidate } from "../linear/poller.js";
import type { Logger } from "../logger.js";
import type { FactoryStore } from "../store/db.js";
import {
  composeMessage,
  context,
  section,
  type ComposedMessage,
  type SlackBlock,
} from "./blocks.js";
import type { SlackGateway } from "./client.js";
import { formatElapsed } from "./console.js";

/** meta key: the pinned board message, JSON `{channel, ts}`. */
export const BOARD_MESSAGE_KEY = "board-message";
/** meta key: done-today memory, JSON `{date, issues: string[]}`. */
export const DONE_TODAY_KEY = "board-done-today";
/** meta key: the last rendered board, JSON ComposedMessage (root `status`). */
export const BOARD_RENDER_KEY = "board-last-render";

const PAUSED_LABEL = "Paused";

/** Review-gate states whose wait is a human-wait (mirrors sync.ts). */
const REVIEW_GATE_STATES = new Set([
  "Requirements Review",
  "Plan Review",
  "Verification",
  "Review",
]);

/**
 * Record a completed issue into the done-today meta memory (called by the
 * un-enroll pass — Done issues leave the poll set, so candidates can never
 * supply them). Rolls over at local midnight; survives daemon restarts.
 */
export function recordDoneToday(
  store: FactoryStore,
  identifier: string,
  now: Date = new Date(),
): void {
  const date = now.toISOString().slice(0, 10);
  let entry: { date: string; issues: string[] } = { date, issues: [] };
  const raw = store.getMeta(DONE_TODAY_KEY);
  if (raw !== undefined) {
    try {
      const parsed = JSON.parse(raw) as { date?: string; issues?: string[] };
      if (parsed.date === date && Array.isArray(parsed.issues)) {
        entry = { date, issues: parsed.issues };
      }
    } catch {
      // Corrupt → start fresh; the board is a convenience view.
    }
  }
  if (!entry.issues.includes(identifier)) entry.issues.push(identifier);
  store.setMeta(DONE_TODAY_KEY, JSON.stringify(entry));
}

function doneToday(store: FactoryStore, now: Date): string[] {
  const raw = store.getMeta(DONE_TODAY_KEY);
  if (raw === undefined) return [];
  try {
    const parsed = JSON.parse(raw) as { date?: string; issues?: string[] };
    if (parsed.date !== now.toISOString().slice(0, 10)) return [];
    return Array.isArray(parsed.issues) ? parsed.issues : [];
  } catch {
    return [];
  }
}

export interface BoardDeps {
  slack: SlackGateway;
  store: FactoryStore;
  channelId: string;
  log: Logger;
}

interface BoardRow {
  issueId: string;
  identifier: string;
  detail: string;
}

/** A row's display ref: the thread permalink when known, Linear link else. */
function rowRef(
  row: BoardRow,
  permalinks: ReadonlyMap<string, string>,
  linearUrls: ReadonlyMap<string, string | undefined>,
): string {
  const permalink = permalinks.get(row.issueId);
  if (permalink !== undefined) return `<${permalink}|${row.identifier}>`;
  const url = linearUrls.get(row.issueId);
  return url !== undefined ? `<${url}|${row.identifier}>` : `*${row.identifier}*`;
}

/** Pure render: candidates + store → the board message. Exported for tests. */
export function buildBoardMessage(
  candidates: readonly PollCandidate[],
  store: FactoryStore,
  permalinks: ReadonlyMap<string, string>,
  now: Date = new Date(),
): ComposedMessage {
  const linearUrls = new Map(
    candidates.map((c) => [c.issue.id, c.issue.url ?? undefined]),
  );

  // Running: active attempts joined with candidate identifiers.
  const running: BoardRow[] = [];
  const activeByIssue = new Set<string>();
  const attempts = store.db
    .prepare(
      "SELECT issue_id, phase, attempt_number, started_at FROM attempts WHERE active = 1 ORDER BY started_at ASC",
    )
    .all() as {
    issue_id: string;
    phase: string;
    attempt_number: number;
    started_at: string;
  }[];
  const candidateById = new Map(candidates.map((c) => [c.issue.id, c]));
  for (const a of attempts) {
    activeByIssue.add(a.issue_id);
    const identifier =
      candidateById.get(a.issue_id)?.issue.identifier ??
      store.getIssue(a.issue_id)?.identifier ??
      a.issue_id;
    running.push({
      issueId: a.issue_id,
      identifier,
      detail: `${a.phase} · ${formatElapsed(a.started_at, now)}`,
    });
  }

  const needsYou: BoardRow[] = [];
  const paused: BoardRow[] = [];
  const waiting: BoardRow[] = [];
  const idleCounts = new Map<string, number>();

  for (const c of candidates) {
    const row = (detail: string): BoardRow => ({
      issueId: c.issue.id,
      identifier: c.issue.identifier,
      detail,
    });
    if (c.blockerLabels.includes(PAUSED_LABEL)) {
      paused.push(row(c.issue.state));
      continue;
    }
    const blockers = c.blockerLabels.filter((l) => l !== PAUSED_LABEL);
    if (blockers.length > 0) {
      needsYou.push(row(blockers.join(", ")));
      continue;
    }
    if (REVIEW_GATE_STATES.has(c.issue.state) && !c.hasLfg && !activeByIssue.has(c.issue.id)) {
      needsYou.push(row(`${c.issue.state} — awaiting approval`));
      continue;
    }
    const ledgerBlocker = c.ledger.ledger.blocker;
    if (ledgerBlocker !== null && ledgerBlocker.trim() !== "") {
      waiting.push(row(ledgerBlocker));
      continue;
    }
    if (activeByIssue.has(c.issue.id)) continue; // shown under running
    idleCounts.set(c.issue.state, (idleCounts.get(c.issue.state) ?? 0) + 1);
  }

  const done = doneToday(store, now);

  const blocks: SlackBlock[] = [section("*🏭 Factory board*")];
  const group = (title: string, rows: BoardRow[]) => {
    if (rows.length === 0) return;
    blocks.push(
      section(
        `*${title}*\n${rows
          .map((r) => `• ${rowRef(r, permalinks, linearUrls)} — ${r.detail}`)
          .join("\n")}`,
      ),
    );
  };
  group(`🏃 Running (${running.length})`, running);
  group(`🙋 Needs you (${needsYou.length})`, needsYou);
  group(`⏳ Waiting (${waiting.length})`, waiting);
  group(`⏸️ Paused (${paused.length})`, paused);
  if (done.length > 0) {
    blocks.push(section(`*✅ Done today (${done.length})*\n${done.join(", ")}`));
  }
  if (idleCounts.size > 0) {
    const counts = [...idleCounts.entries()]
      .map(([state, n]) => `${state}: ${n}`)
      .join(" · ");
    blocks.push(context(counts));
  }
  if (running.length + needsYou.length + waiting.length + paused.length === 0 && done.length === 0) {
    blocks.push(section("_Nothing enrolled — the floor is quiet._"));
  }
  blocks.push(
    context(
      `updated ${now.toISOString().slice(11, 16)} UTC · needs-you ${needsYou.length} · running ${running.length}`,
    ),
  );

  const fallback = `Factory board — running ${running.length}, needs-you ${needsYou.length}, waiting ${waiting.length}, paused ${paused.length}, done today ${done.length}`;
  // composeMessage enforces the 50-block ceiling (trims with a visible note —
  // the compact fallback when enrolled-issue count outgrows the layout).
  return composeMessage(blocks, fallback);
}

/**
 * Board updater with a permalink cache (a thread's permalink never changes,
 * so one chat.getPermalink per thread lifetime, not per tick).
 */
export function createBoardUpdater(deps: BoardDeps): {
  updateBoard(candidates: readonly PollCandidate[], now?: Date): Promise<void>;
} {
  const permalinkCache = new Map<string, string>();

  async function permalinksFor(
    candidates: readonly PollCandidate[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const c of candidates) {
      const cached = permalinkCache.get(c.issue.id);
      if (cached !== undefined) {
        out.set(c.issue.id, cached);
        continue;
      }
      const row = deps.store.getSlackThreadByIssue(c.issue.id);
      if (row === undefined) continue;
      try {
        const link = await deps.slack.getPermalink(row.channel_id, row.thread_ts);
        if (link !== null) {
          permalinkCache.set(c.issue.id, link);
          out.set(c.issue.id, link);
        }
      } catch {
        // Permalink is garnish — the row still renders with the Linear link.
      }
    }
    return out;
  }

  async function postAndPin(message: ComposedMessage): Promise<void> {
    const ts = await deps.slack.postMessage(deps.channelId, message.text, {
      blocks: message.blocks,
    });
    deps.store.setMeta(
      BOARD_MESSAGE_KEY,
      JSON.stringify({ channel: deps.channelId, ts }),
    );
    try {
      await deps.slack.pinMessage(deps.channelId, ts);
    } catch (e) {
      // Likely missing pins:write — the board still works unpinned; U10's
      // doctor names the scope to add.
      deps.log.warn("board: pin failed (missing pins:write?) — board unpinned", {
        error: String(e),
      });
    }
  }

  return {
    async updateBoard(candidates, now = new Date()) {
      const permalinks = await permalinksFor(candidates);
      const message = buildBoardMessage(candidates, deps.store, permalinks, now);
      deps.store.setMeta(BOARD_RENDER_KEY, JSON.stringify(message));

      const raw = deps.store.getMeta(BOARD_MESSAGE_KEY);
      if (raw === undefined) {
        await postAndPin(message);
        return;
      }
      let target: { channel: string; ts: string };
      try {
        target = JSON.parse(raw) as { channel: string; ts: string };
      } catch {
        await postAndPin(message);
        return;
      }
      try {
        await deps.slack.updateMessage(
          target.channel,
          target.ts,
          message.text,
          message.blocks,
        );
      } catch (e) {
        // message_not_found / channel mismatch → self-heal by re-posting.
        deps.log.warn("board: update failed — re-posting fresh board", {
          error: String(e),
        });
        await postAndPin(message);
      }
    },
  };
}
