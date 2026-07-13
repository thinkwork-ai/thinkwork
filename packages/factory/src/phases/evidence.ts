/**
 * Phase-completion evidence detection (U5, R8) — READ-ONLY.
 *
 * Workers write business state (batons, status moves, PRs); the engine only
 * observes. Given a Linear snapshot (status, comments) and optional GitHub
 * state (PRs for the attempt branch via `gh`), decide whether the running
 * phase completed and produce typed evidence. Exit without any evidence is
 * the caller's Failed path (driveAttempt) — never a silent advance.
 *
 * Detection order: status moved > baton posted > PR merged. The PR-merged
 * signal is a fallback for workers that died between merging and posting the
 * baton; the U6 sweep uses it to advance-from-evidence instead of
 * relaunching.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  isTrustedComment,
  type CommentTrust,
  type LinearCommentSnapshot,
} from "../linear/client.js";
import { isMarkerComment } from "../linear/markers.js";
import type { Phase } from "./engine.js";
import { handoffMarker } from "./prompts.js";
import { parseWaitingOn } from "../linear/ledger.js";

// ---------------------------------------------------------------------------
// GitHub gateway
// ---------------------------------------------------------------------------

export interface PrInfo {
  number: number;
  state: "OPEN" | "MERGED" | "CLOSED";
  url: string;
  mergedAt: string | null;
}

export interface GithubGateway {
  /** All PRs (any state) whose head is exactly this branch. */
  prsForBranch(branch: string): Promise<PrInfo[]>;
}

export interface PrDetail extends PrInfo {
  title: string;
  headRefName: string;
}

/**
 * Console-facing GitHub operations (U5): the read-only evidence gateway plus
 * PR inspection and the one write the console performs (squash-merge). The
 * real gateway implements both; evidence detection keeps depending on the
 * narrow GithubGateway.
 */
export interface GithubOps extends GithubGateway {
  /** PR detail by number, or null when the PR does not exist. */
  prView(pr: number): Promise<PrDetail | null>;
  /** Checks state — `ok: false` means at least one check is failing/pending-failure. */
  prChecks(pr: number): Promise<{ ok: boolean; summary: string }>;
  /** `gh pr merge <pr> --squash --auto --delete-branch`. Never throws. */
  prMerge(pr: number): Promise<{ ok: boolean; output: string }>;
}

type ExecFileFn = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
) => Promise<{ stdout: string; stderr?: string }>;

const defaultExecFile: ExecFileFn = async (cmd, args, opts) => {
  const { stdout, stderr } = await promisify(execFile)(cmd, args, {
    cwd: opts?.cwd,
    maxBuffer: 4 * 1024 * 1024,
    // Bound the call: a hung `gh` (auth prompt, network stall, rate limit)
    // must never freeze the single-dispatch tick. On timeout execFile rejects,
    // checkEvidence throws, and the attempt fails cleanly (recoverable) rather
    // than hanging forever.
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
  return { stdout, stderr };
};

/** stdout+stderr off a rejected execFile error (gh writes both on failure). */
function execErrorOutput(e: unknown): string {
  const err = e as { stdout?: string; stderr?: string; message?: string };
  const out = `${err.stdout ?? ""}\n${err.stderr ?? ""}`.trim();
  return out !== "" ? out : String(err.message ?? e);
}

export interface GhCliGatewayOptions {
  /** Repo checkout to run `gh` in (resolves the GitHub repo). */
  repoDir: string;
  /** Injectable for tests; defaults to node:child_process execFile. */
  execFileFn?: ExecFileFn;
}

/** Real gateway backed by the `gh` CLI. */
export function createGhCliGateway(opts: GhCliGatewayOptions): GithubOps {
  const run = opts.execFileFn ?? defaultExecFile;
  return {
    async prView(pr) {
      try {
        const { stdout } = await run(
          "gh",
          [
            "pr",
            "view",
            String(pr),
            "--json",
            "number,state,title,headRefName,url,mergedAt",
          ],
          { cwd: opts.repoDir },
        );
        const p = JSON.parse(stdout) as {
          number: number;
          state: string;
          title: string;
          headRefName: string;
          url: string;
          mergedAt: string | null;
        };
        return {
          number: p.number,
          state: p.state as PrInfo["state"],
          title: p.title,
          headRefName: p.headRefName,
          url: p.url,
          mergedAt: p.mergedAt ?? null,
        };
      } catch {
        return null;
      }
    },

    async prChecks(pr) {
      // `gh pr checks` exits non-zero when any check fails — the output is
      // still the summary we want, so surface it either way.
      try {
        const { stdout } = await run("gh", ["pr", "checks", String(pr)], {
          cwd: opts.repoDir,
        });
        return { ok: true, summary: stdout.trim() };
      } catch (e) {
        return { ok: false, summary: execErrorOutput(e) };
      }
    },

    async prMerge(pr) {
      try {
        const { stdout, stderr } = await run(
          "gh",
          ["pr", "merge", String(pr), "--squash", "--auto", "--delete-branch"],
          { cwd: opts.repoDir },
        );
        const output = `${stdout}\n${stderr ?? ""}`.trim();
        return { ok: true, output: output !== "" ? output : "auto-merge armed" };
      } catch (e) {
        return { ok: false, output: execErrorOutput(e) };
      }
    },

    async prsForBranch(branch) {
      const { stdout } = await run(
        "gh",
        [
          "pr",
          "list",
          "--head",
          branch,
          "--state",
          "all",
          "--json",
          "number,state,url,mergedAt",
          "--limit",
          "20",
        ],
        { cwd: opts.repoDir },
      );
      if (stdout.trim() === "") return [];
      const parsed = JSON.parse(stdout) as Array<{
        number: number;
        state: string;
        url: string;
        mergedAt: string | null;
      }>;
      return parsed.map((pr) => ({
        number: pr.number,
        state: pr.state as PrInfo["state"],
        url: pr.url,
        mergedAt: pr.mergedAt ?? null,
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Evidence detection
// ---------------------------------------------------------------------------

/**
 * Per-phase completion signals: which statuses the worker may move the issue
 * to on completion (pass/fail routes), and which baton marker(s) it posts.
 */
const PHASE_COMPLETION: Record<
  Phase,
  {
    passStatuses: string[];
    failStatuses: string[];
    batonStatuses: string[];
  }
> = {
  brainstorm: {
    passStatuses: ["Planning", "Requirements Review"],
    failStatuses: [],
    batonStatuses: ["Planning"],
  },
  plan: {
    passStatuses: ["Ready to Work", "Ready To Work", "Plan Review"],
    failStatuses: [],
    batonStatuses: ["Ready to Work"],
  },
  debug: {
    // Contract exit routing: Brainstorming (product-framing question),
    // Ready to Work (LFG mechanical fix), or Plan Review (human review).
    passStatuses: [
      "Brainstorming",
      "Ready to Work",
      "Ready To Work",
      "Plan Review",
    ],
    failStatuses: [],
    batonStatuses: ["Brainstorming", "Ready to Work", "Plan Review"],
  },
  implement: {
    passStatuses: ["Verification", "Review"],
    failStatuses: [],
    batonStatuses: ["Verification"],
  },
  verify: {
    passStatuses: ["Done"],
    // Verification rebound: fail verdict moves the issue back to repair.
    failStatuses: ["Ready to Work", "Ready To Work"],
    batonStatuses: ["Done", "Ready to Work"],
  },
  compound: {
    passStatuses: [],
    failStatuses: [],
    batonStatuses: [],
  },
};

export type PhaseEvidence =
  | {
      complete: true;
      kind:
        | "baton-posted"
        | "status-moved"
        | "pr-merged"
        | "compounded"
        | "dependency-wait";
      detail: string;
      /** For verify: pass moved to Done, fail rebounded to Ready to Work. */
      outcome?: "pass" | "fail";
    }
  | { complete: false; reason: string };

export interface EvidenceInput {
  phase: Phase;
  /** Human identifier, e.g. "THINK-123". */
  issueIdentifier: string;
  /** Workflow status when the attempt launched. */
  statusAtLaunch: string;
  /** Workflow status now. */
  currentStatus: string;
  /** Issue comments, chronological. */
  comments: LinearCommentSnapshot[];
  /**
   * Comment ids that existed at launch. When provided, only NEWER comments
   * count as baton evidence — a stale baton from a prior pass never
   * completes this attempt's phase.
   */
  commentIdsAtLaunch?: ReadonlySet<string>;
  /** Rolling-ledger compounded flag (compound-phase completion signal). */
  ledgerCompounded?: boolean;
  /**
   * Rolling-ledger blocker field, fresh. A `waiting-on: THINK-x` value is a
   * LEGITIMATE run ending (cross-issue dependency wait) — without it, a worker
   * correctly stopping at a gate was classified Failed, burned the attempt
   * ceiling, and escalated Needs User (the THINK-274/275 gridlock).
   */
  ledgerBlocker?: string | null;
  /** Attempt branch to check on GitHub (with `github`). */
  branch?: string;
  github?: GithubGateway;
  /**
   * Author allowlist for baton-posted evidence. When set, only batons from
   * the daemon or trusted authors count — any Linear commenter could
   * otherwise falsely complete a phase. Status-moved and PR-merged evidence
   * are NOT gated (they are not forgeable via comments).
   */
  trust?: CommentTrust;
}

/**
 * Decide whether the running phase completed, from observable Linear/GitHub
 * state only. Never writes anywhere.
 */
export async function detectPhaseEvidence(
  input: EvidenceInput,
): Promise<PhaseEvidence> {
  const spec = PHASE_COMPLETION[input.phase];
  const id = input.issueIdentifier;

  // Compound never moves status; its completion signal is the ledger flag.
  if (input.phase === "compound" && input.ledgerCompounded === true) {
    return {
      complete: true,
      kind: "compounded",
      detail: `${id} rolling ledger has compounded: true`,
    };
  }

  // 1. Status moved to a contract-mandated next status.
  if (input.currentStatus !== input.statusAtLaunch) {
    if (spec.passStatuses.includes(input.currentStatus)) {
      return {
        complete: true,
        kind: "status-moved",
        detail: `status moved ${input.statusAtLaunch} → ${input.currentStatus}`,
        outcome: input.phase === "verify" ? "pass" : undefined,
      };
    }
    if (spec.failStatuses.includes(input.currentStatus)) {
      return {
        complete: true,
        kind: "status-moved",
        detail: `status rebounded ${input.statusAtLaunch} → ${input.currentStatus}`,
        outcome: "fail",
      };
    }
  }

  // 2. Baton posted since launch.
  const newComments = input.commentIdsAtLaunch
    ? input.comments.filter((c) => !input.commentIdsAtLaunch!.has(c.id))
    : input.comments;
  for (const status of spec.batonStatuses) {
    const marker = handoffMarker(id, status);
    const match = newComments.find(
      (c) =>
        isMarkerComment(c.body, marker) &&
        (input.trust === undefined || isTrustedComment(c, input.trust)),
    );
    if (match) {
      return {
        complete: true,
        kind: "baton-posted",
        detail: `baton ${marker} posted (comment ${match.id})`,
        outcome:
          input.phase === "verify"
            ? status === "Done"
              ? "pass"
              : "fail"
            : undefined,
      };
    }
  }

  // 3. Fallback: the attempt branch's PR merged (worker may have died
  //    between merging and posting the baton).
  if (input.branch !== undefined && input.github !== undefined) {
    const prs = await input.github.prsForBranch(input.branch);
    const merged = prs.find((pr) => pr.state === "MERGED");
    if (merged) {
      return {
        complete: true,
        kind: "pr-merged",
        detail: `PR ${merged.url} merged for branch ${input.branch}`,
      };
    }
  }

  // 4. Cross-issue dependency wait: the worker recorded `waiting-on: THINK-x`
  //    in the ledger and ended its run. That is a legitimate ending — the
  //    engine waits and relaunches when the dependency reaches Done. Checked
  //    LAST so real progress evidence always wins.
  const waitingOn = parseWaitingOn(input.ledgerBlocker);
  if (waitingOn !== null) {
    return {
      complete: true,
      kind: "dependency-wait",
      detail: `waiting on ${waitingOn} (ledger blocker) — engine resumes this phase when it reaches Done`,
    };
  }

  return {
    complete: false,
    reason: `no completion evidence for ${id}/${input.phase}: status still "${input.currentStatus}", no new baton, no merged PR`,
  };
}
