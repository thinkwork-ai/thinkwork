/**
 * Launch-prompt assembly (U5, R7).
 *
 * Templates are embedded as code constants, adapted FAITHFULLY from
 * .agents/skills/thinkwork-linear-dispatcher/references/launch-prompts.md for
 * the Claude lane (Codex-only `/goal` bracket lines dropped; everything else
 * kept). Each assembled prompt = shared worker rules + the phase template +
 * the newest `handoff:<ID>:<PHASE>` baton VERBATIM. When no baton exists (a
 * human moved the status), one is SYNTHESIZED from the Progress document per
 * the contract and returned in `batonToPost` — the caller must post it to
 * Linear BEFORE launching the worker.
 */

import {
  DEFAULT_PROJECT,
  getArtifactsDir,
  type ProjectConfig,
} from "../config.js";
import {
  isTrustedComment,
  type CommentTrust,
  type LinearCommentSnapshot,
} from "../linear/client.js";
import { isMarkerComment } from "../linear/markers.js";
import { PHASE_HANDOFF, type Phase } from "./engine.js";

// ---------------------------------------------------------------------------
// Markers and baton discovery
// ---------------------------------------------------------------------------

export function handoffMarker(issueId: string, phaseStatus: string): string {
  return `handoff:${issueId}:${phaseStatus}`;
}

/**
 * Newest comment carrying this issue+phase's handoff marker as its FIRST
 * LINE (a comment merely quoting the marker mid-body is never a baton).
 * Comments are assumed chronological (Linear returns ascending) — the LAST
 * match wins.
 *
 * When `trust` is provided, only daemon/trusted-author batons are accepted:
 * baton text is embedded VERBATIM into a `--dangerously-skip-permissions`
 * worker prompt, so an untrusted baton must never be injected — callers fall
 * back to baton synthesis instead. Comments without an author id are
 * untrusted (fail-safe).
 */
export function findNewestBaton(
  issueId: string,
  phaseStatus: string,
  comments: LinearCommentSnapshot[],
  trust?: CommentTrust,
): LinearCommentSnapshot | null {
  const marker = handoffMarker(issueId, phaseStatus);
  for (let i = comments.length - 1; i >= 0; i--) {
    if (!isMarkerComment(comments[i].body, marker)) continue;
    if (trust !== undefined && !isTrustedComment(comments[i], trust)) continue;
    return comments[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Baton synthesis (contract: "the dispatcher synthesizes one from the
// Progress document and issue history, posts it, then launches")
// ---------------------------------------------------------------------------

/** One-sentence goal per phase for synthesized batons. */
const SYNTH_GOALS: Record<Phase, string> = {
  brainstorm:
    "Produce/refresh the requirements artifact for this issue via ce-brainstorm and stop at the contract-mandated exit for its LFG state.",
  plan: "Produce the complete implementation plan artifact via ce-plan and stop at the contract-mandated exit for its LFG state.",
  debug:
    "Diagnose the reported failure via ce-debug, land the findings artifact, and route the exit per the routing contract.",
  implement:
    "Implement this issue end to end from the approved requirements and plan, land the required PRs, and move it to Verification.",
  verify:
    "Verify the merged implementation against the deployed dev stack per the dogfood doctrine and route pass/fail per the verdict policy.",
  compound:
    "Run selective ce-compound over this completed issue's durable learnings and stop.",
};

const PROGRESS_EXCERPT_MAX_CHARS = 1500;

/** Prefer the Next Steps section of the Progress doc; else a bounded head. */
function progressExcerpt(progressDoc: string): string {
  const trimmed = progressDoc.trim();
  if (trimmed === "") {
    return "(no Progress document content was available — reconstruct context from the full Linear issue history)";
  }
  const match = /(^|\n)#{1,4}\s*Next Steps\s*\n([\s\S]*?)(?=\n#{1,4}\s|\s*$)/i.exec(
    trimmed,
  );
  const body = match ? match[2].trim() : trimmed;
  return body.length > PROGRESS_EXCERPT_MAX_CHARS
    ? `${body.slice(0, PROGRESS_EXCERPT_MAX_CHARS)}\n…(truncated)`
    : body;
}

export interface SynthesizeBatonInput {
  issueId: string;
  /** The phase about to launch — the baton targets its READ status. */
  phase: Phase;
  featureTitle: string;
  /** Raw content of the `Progress: <feature title>` Linear document. */
  progressDoc: string;
}

/**
 * Build a contract-shaped handoff baton from the Progress document. The
 * caller MUST post this comment to Linear before launching the worker.
 */
export function synthesizeBaton(input: SynthesizeBatonInput): string {
  const status = PHASE_HANDOFF[input.phase].reads;
  return [
    handoffMarker(input.issueId, status),
    "",
    `Goal: ${SYNTH_GOALS[input.phase]}`,
    "",
    "Completed (previous phase):",
    "- No handoff comment was found for this phase — this baton was synthesized by the dispatcher from the Progress document and issue history. Verify completed state against the Progress document before starting.",
    "",
    "Start here:",
    `- Read the attached Linear document \`Progress: ${input.featureTitle}\` — its Active Work and Next Steps sections control this phase.`,
    "- Progress document excerpt:",
    "",
    progressExcerpt(input.progressDoc),
    "",
    "Inputs:",
    `- \`Progress: ${input.featureTitle}\` (attached Linear document)`,
    `- Full Linear issue history, documents, and attachments for ${input.issueId}`,
    "",
    "Open questions / risks: none recorded in this synthesized baton — check the Progress document's blockers section.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Templates (adapted from launch-prompts.md, Claude lane)
// ---------------------------------------------------------------------------

/**
 * Shared worker rules prepended to every prompt: launch-prompts.md's question
 * protocol, goal discipline, and the exact CI wait chain (mandated verbatim —
 * workers died on paraphrases; see the History note in launch-prompts.md).
 */
export const WORKER_COMMON_RULES = `You are a headless Claude Code worker launched by the <PROJECT_NAME> factory daemon.
Read AGENTS.md first, preserve unrelated changes, use Conventional Commits,
target main, and update the rolling Linear ledger plus the attached
\`Progress: <feature title>\` Linear document.

Question protocol: when a material question blocks progress, post one comment
@mentioning <OPERATOR_HANDLE> with numbered questions and a recommended answer for each,
add Needs User, record the questions in the Progress document, and stop. Make
trivial reversible choices autonomously and record them.

In that same blocker comment, AFTER the prose, you MUST append a
machine-readable answer form as a fenced block of language \`answers\` — the
operator's Slack surface renders it as clickable buttons. YAML, one list item
per numbered question:

\`\`\`answers
- question: Which OAuth scope should the connector request?
  recommended: 1
  options:
    - Read-only (drive.readonly)
    - Full drive access
\`\`\`

Rules: \`options\` are short answer labels (75 characters max each — the Slack
button limit); give 2–4 options per question; \`recommended\` is REQUIRED and
is the 1-based index of the option you recommend. The prose above the fence
still carries your full reasoning and recommendations — the fence is additive,
never a replacement for the numbered questions.

LFG never-stuck rule: when the LFG label is on the issue, a question you can
answer with a recommendation is NOT a blocker — adopt your recommended answer,
record the decision and rationale in the Progress document and ledger, and
keep going. With LFG, add Needs User ONLY for missing credentials/secrets or
unsafe-irreversible ambiguity (destructive data operations, spending money,
external communications). An LFG issue must never sit waiting on a human for
a decision the run itself recommended.

Cross-issue dependency: if your goal is gated on ANOTHER issue (e.g. a merge
gate that waits for THINK-x to merge/deploy), do NOT add Needs User and do NOT
burn retries: set the rolling ledger's blocker field to exactly
\`waiting-on THINK-x\` (NO colon after waiting-on — a nested colon breaks the
ledger's YAML fence), record the gate in the Progress document, and end the
run. That is a legitimate ending — the daemon waits quietly and relaunches
this phase automatically when THINK-x reaches Done.

Parent issues: if this issue's plan shipped as child issues and every child is
Done, do NOT re-implement anything — verify the assembled outcome from the
children's evidence and move this issue forward (post the handoff and status
move for your phase).

Goal discipline: the Goal paragraph below is the run contract, not an
aspiration. A run has exactly three valid endings: (1) the goal's terminal
condition is observably true — required PRs merged, handoff comment posted,
status moved, cleanup done; (2) a hard blocker is recorded per the question
protocol; or (3) a cross-issue dependency wait is recorded via the ledger
\`waiting-on THINK-x\` blocker. Nothing in between. Never end a run "waiting on CI"; never
background any step on the goal's critical path. Restate your goal as your
first action and check your last action against it before ending the run.

The CI wait MUST be this exact single foreground command chain, run as ONE
Bash invocation — not paraphrased into separate steps, not backgrounded:

gh pr merge <pr> --squash --auto --delete-branch && \\
  gh pr checks <pr> --watch; \\
  until [ -n "$(gh pr view <pr> --json mergedAt --jq '.mergedAt // empty')" ]; do sleep 30; done

Do not end the run until this chain returns and mergedAt is non-null.`;

const BRAINSTORM_TEMPLATE = `Use the Compound Engineering ce-brainstorm workflow for Linear issue <ISSUE_ID>.
Read AGENTS.md first. Start repo work from fresh origin/main in an isolated
worktree. Read the newest handoff:<ISSUE_ID>:Brainstorming comment, full Linear
context, child/parent issues, documents, attachments, comments, and relevant
repo docs. Use one rolling Linear ledger comment marked
automation-ledger:<ISSUE_ID>. Create/update the attached Linear progress
document named \`Progress: <feature title>\` using the same suffix as
\`Requirements: ...\` and \`Plan: ...\` when present, or the issue title otherwise.
If LFG is present, run no-preference brainstorming. If LFG is absent, follow
the question protocol for material requirements questions and stop at
Requirements Review after the requirements artifact PR is merged. Produce or
update the repo-local requirements artifact and attached Linear document when
useful. Open a PR to main, wait for checks, fix real failures, squash-merge
when allowed, clean up, record PR URL and merge evidence in the progress
document, post the handoff:<ISSUE_ID>:Planning comment (goal, completed
artifacts, start-here, inputs, open questions), then move status to Planning
for LFG or Requirements Review otherwise. Stop.`;

const PLAN_TEMPLATE = `Use the Compound Engineering ce-plan workflow for Linear issue <ISSUE_ID>. Read
AGENTS.md first. Start repo work from fresh origin/main in an isolated worktree.
Read the newest handoff:<ISSUE_ID>:Planning comment, approved requirements,
full Linear context, child issues, dependencies, the attached
\`Progress: <feature title>\` document, and relevant repo docs. Produce a
complete implementation plan with child/unit split, dependency order, rollout
notes, risks, and explicit verification contract for each child/unit — the
verification contract must name the complete user flows that prove the unit
works end to end, since verification drives them in a real browser against
deployed dev. Create/update Linear child issues for shippable units when
appropriate, in Brainstorming status — the enrollment floor (never Backlog or
Todo — the dispatcher ignores both; a below-floor child strands until a human
promotes it), inheriting the parent's lane label plus LFG when present. Define
the expected checkpoint PR boundary for each unit: one PR per unit by default,
with explicit justification for any grouped units. Commit the plan artifact,
open a PR to main, wait for checks, fix real failures, squash-merge when
allowed, clean up, record plan/child/PR/merge evidence in the progress
document, post the handoff:<ISSUE_ID>:Ready to Work comment (goal, completed
artifacts, start-here with the first unit, inputs, open questions), and move
to Ready to Work for LFG or Plan Review otherwise. Stop.`;

const DEBUG_TEMPLATE = `Use the Compound Engineering ce-debug workflow for Linear issue <ISSUE_ID>. Read
AGENTS.md first. Start repo work from fresh origin/main in an isolated worktree.
Read the newest handoff comment for this phase, full issue context,
logs/evidence, recent PRs/deployments, comments, the attached
\`Progress: <feature title>\` document, and relevant repo docs. Diagnose using
the smallest meaningful signal. Produce/update a debug findings/fix plan
artifact and attached Linear document when useful. Do not implement product
fixes unless this is a Ready to Work implementation/repair issue or an LFG
issue with explicit scope. Commit artifact, PR, wait checks, fix failures,
squash-merge when allowed, clean up, update the progress document and rolling
ledger, post the handoff comment for the next phase, and route the exit: move
to Brainstorming when the diagnosis reveals a product-framing question that
requirements work must settle, otherwise Ready to Work for LFG or Plan Review
for human review. Stop.`;

const IMPLEMENT_TEMPLATE = `Autopilot Mode. You are the implementation worker for <PROJECT_NAME> Linear issue
<ISSUE_ID>.

Goal: Implement <ISSUE_ID> <SHORT_TITLE> end to end from the approved
requirements and plan, land required PRs/artifacts, update the attached
\`Progress: <feature title>\` Linear document and automation-ledger:<ISSUE_ID>
with evidence, post the handoff:<ISSUE_ID>:Verification comment, move
<ISSUE_ID> to Verification when implementation is merged and locally verified,
and stop for human review if LFG is absent; if LFG is present, the loop
continues on later heartbeats through verification, repair rebounds, Done, and
selective compounding.

Use the Compound Engineering workflow in autopilot mode for this repository.
Read AGENTS.md first. Read the newest handoff:<ISSUE_ID>:Ready to Work (or
:Verification-repair) comment. Fetch full Linear context, documents,
attachments, comments, child/parent issues, dependencies, blockers, and
repo-local planning files. Discover and read attached/referenced requirements,
plans, the attached \`Progress: <feature title>\` document, comments, and
relevant docs/solutions. Use the progress document's \`Active Work\` and
\`Next Steps\` as the unit-level loop controller, then verify that they agree
with Linear status, open PRs, worker handoffs, and local worktrees. Use the
plan-owned verification contract. Start from fresh origin/main in this
isolated worktree. Implement the active issue or child/unit end to end with no
preference questions.

If Verification Failed is present, this is a repair pass: start from the
failed verification evidence in the newest verification verdict and dogfood
report, implement the smallest correct fix, and include a regression test that
is red before and green after the fix. Treat each plan unit as a checkpoint
boundary. Ship one PR per unit by default unless the plan explicitly requires
grouping. Before starting a unit, update the progress document with the
selected unit, dependency state, branch/worktree, verification contract, and
expected stop condition. When the unit PR opens, record PR URL, commits,
commands, remaining verification, and risks. When CI or verification changes,
record the failure, fix, and rerun evidence. When the unit ships, record
merged PR URL, merge commit, CI result, verification evidence,
branch/worktree cleanup, and the next unit candidate. After each unit ships,
update the progress document and rolling ledger, compact/checkpoint context,
sync from origin/main, and start the next unit from the progress document's
Next Steps rather than chat memory. Use Conventional Commits. Open PRs to
main, run focused verification then broader checks, wait for required CI, fix
failures, squash-merge when allowed, delete branches, remove completed
worktrees, sync origin/main, and update the progress document and rolling
Linear ledger with PR/merge/CI evidence.

When implementation is merged: record the post-merge Deploy workflow run link
for main (dev is continuous-CD from main; verification needs the deploy to
land), then post the handoff:<ISSUE_ID>:Verification comment written as a QA
brief: entry-point URL on deployed dev, since-your-last-update summary, merged
PRs and the Deploy run link, a numbered click-level QA checklist with the
expected observable result for each step, unit mapping, and timing caveats.
Then move the issue or child/unit to Verification.

If LFG is absent, stop after moving to Verification for human review. If LFG
is present, later heartbeats continue through verification, repair rebounds,
Done, and compounding. Stop only for hard blockers, following the question
protocol.`;

const VERIFY_TEMPLATE = `Dogfood Verification. You are the verification worker — a judge, not a
mechanic — for <PROJECT_NAME> Linear issue <ISSUE_ID>. Do not change product code.
Do not mutate production or perform destructive cloud deletion without
explicit action-time authorization.

Read AGENTS.md first. Read the newest handoff:<ISSUE_ID>:Verification comment,
requirements, plan, child/parent issues, implementation PRs, comments, rolling
ledger, and the attached \`Progress: <feature title>\` document. The plan-owned
verification contract defines "correct and done."

Preconditions: every implementation PR in scope is merged, and the post-merge
Deploy workflow run on main is green (dev is continuous-CD from main). If the
deploy has not landed the change, record \`waiting-on-deploy\` in the ledger and
stop; a later heartbeat re-dispatches.

Scope and scenarios (diff-scoped, never whole-app):
1. Diff the merged PRs against prior main to enumerate exactly what changed.
2. Map the complete user flows the change participates in, and follow each
   flow to its real end.
3. Build a scenario matrix seeded from the handoff QA checklist and the
   plan-owned verification contract, extended with the mapped flows (the
   checklist is the floor, not the ceiling), and write it into the dogfood
   report file first. The report is the checkpoint: a killed run resumes
   from it.

Execution:
4. Drive the deployed dev stack through each scenario in a real browser.
   Capture concrete evidence per scenario: URLs, screenshots, console and
   network errors, persisted data checks. When the change affects
   compiled/persisted output, exercise FRESHLY GENERATED output.
5. Durable screenshots (MANDATORY): copy every screenshot you captured to
   <ARTIFACTS_DIR>/ (create the directory if missing — mkdir -p semantics),
   named NN-scenario-slug.png in scenario order, and reference those filenames
   in the dogfood report. Worktrees are cleaned up after the run — a
   screenshot left in the worktree is destroyed evidence; the operator's
   Slack \`result\` command reads exactly this folder.
6. Record two verdicts per scenario: functional and experiential. A render
   that contradicts the design intent is a functional FAIL, not a paper cut.
   Paper cuts do not fail verification; record them in the report and file or
   append follow-up Linear issues.

Verdict policy (fix-loop governor — never fix product code yourself):
- Failure with a small, well-understood, low-risk fix: post exact
  reproduction and evidence plus the smallest suggested fix, add
  Verification Failed, move the issue or child back to Ready to Work,
  preserve the lane label and LFG, and require the repair worker to add a
  regression test that is red before and green after the fix.
- Failure that is large, risky, or ambiguous: post options with trade-offs
  and a recommendation, @mention <OPERATOR_HANDLE>, add Needs User, and stop.
- Flow that automation cannot prove: add Blocked: Auth for auth blockers or
  Needs User for needs-human-verify, state exactly what a human must check,
  and stop.

Report: write docs/dogfood-reports/<date>-<ISSUE_ID>-dogfood.md containing the
scenario matrix, per-scenario verdicts with evidence, paper cuts, and a
"Decisions for a human" section. Commit it via a docs-only PR from an isolated
worktree, squash-merge when allowed, clean up, and link the report from the
Progress document.

Exit criteria for pass: green scenario matrix, green CI on main, report merged
and linked, and "Decisions for a human" empty or explicitly handed off. On
pass: remove Verification Failed if present, record evidence in the Progress
document and rolling ledger, post the handoff:<ISSUE_ID>:Done comment, move
the issue to Done for LFG or comment for human review otherwise, and stop.

On fail: update the Progress document's failure/repair-next-step sections,
post the handoff:<ISSUE_ID>:Ready to Work comment whose Goal is the smallest
correct repair, seeded with the failing scenarios and evidence from the
dogfood report, then apply the verdict-policy labels and status moves. Stop.`;

const COMPOUND_TEMPLATE = `Autopilot Mode. Use the Compound Engineering ce-compound workflow for Linear
issue <ISSUE_ID>. Read AGENTS.md first. Use Full mode automatically. Do not ask
<OPERATOR_NAME> any ce-compound mode, recommendation, preference, or approval questions.
Start repo work from fresh origin/main in an isolated docs-only worktree/branch.
Read the newest handoff:<ISSUE_ID>:Done comment and the dogfood report for
durable-learning candidates (including paper-cut patterns). Run the
recommendation step and automatically accept it. If recommendation is none,
leave Done and update the rolling ledger. If recommendation is partial/full,
create/update docs, open PR, wait checks, fix failures, squash-merge when
allowed, clean up, update the progress document and rolling ledger, and stop.`;

export const PHASE_TEMPLATES: Record<Phase, string> = {
  brainstorm: BRAINSTORM_TEMPLATE,
  plan: PLAN_TEMPLATE,
  debug: DEBUG_TEMPLATE,
  implement: IMPLEMENT_TEMPLATE,
  verify: VERIFY_TEMPLATE,
  compound: COMPOUND_TEMPLATE,
};

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface AssemblePromptInput {
  phase: Phase;
  /** Human identifier, e.g. "THINK-123". */
  issueId: string;
  title: string;
  /** Issue comments in chronological order (newest last). */
  comments: LinearCommentSnapshot[];
  /** Content of the `Progress: <feature title>` document ("" when absent). */
  progressDoc?: string;
  /** Ready to Work repair pass (Verification Failed). */
  repair?: boolean;
  /**
   * Author allowlist for baton discovery. When set, an existing baton is
   * used only if authored by the daemon or a trusted user; otherwise a
   * baton is synthesized (untrusted text never reaches the worker prompt).
   */
  trust?: CommentTrust;
  /**
   * Absolute durable artifacts path injected into the verify template's
   * <ARTIFACTS_DIR> placeholder (U7). Defaults to the config-derived
   * `<stateDir>/artifacts/<ISSUE>` so the placeholder can never leak into a
   * launched prompt.
   */
  artifactsDir?: string;
  /**
   * Project identity substituted into <PROJECT_NAME> / <OPERATOR_NAME> /
   * <OPERATOR_HANDLE> (THINK-287 genericize). Defaults preserve prior prose.
   */
  project?: ProjectConfig;
}

export interface AssembledPrompt {
  /** Full worker launch prompt (rules + template + baton). */
  prompt: string;
  /** The baton embedded in the prompt (existing or synthesized). */
  baton: string;
  /**
   * Non-null when the baton was synthesized: the caller MUST post this
   * comment to Linear BEFORE launching the worker (contract order).
   */
  batonToPost: string | null;
}

function fillTemplate(
  template: string,
  issueId: string,
  title: string,
  artifactsDir: string,
): string {
  return template
    .replaceAll("<ISSUE_ID>", issueId)
    .replaceAll("<SHORT_TITLE>", title)
    .replaceAll("<feature title>", title)
    .replaceAll("<ARTIFACTS_DIR>", artifactsDir);
}

/**
 * Assemble the launch prompt for one phase: shared rules + filled template +
 * the newest matching baton verbatim (synthesized from the Progress document
 * when absent, per the routing contract).
 */
export function assemblePrompt(input: AssemblePromptInput): AssembledPrompt {
  const readStatus = PHASE_HANDOFF[input.phase].reads;
  const existing = findNewestBaton(
    input.issueId,
    readStatus,
    input.comments,
    input.trust,
  );
  const baton =
    existing?.body ??
    synthesizeBaton({
      issueId: input.issueId,
      phase: input.phase,
      featureTitle: input.title,
      progressDoc: input.progressDoc ?? "",
    });

  const parts = [
    WORKER_COMMON_RULES,
    "---",
    fillTemplate(
      PHASE_TEMPLATES[input.phase],
      input.issueId,
      input.title,
      input.artifactsDir ?? getArtifactsDir(input.issueId),
    ),
  ];
  if (input.repair === true) {
    parts.push(
      "---",
      `This is a REPAIR pass: \`Verification Failed\` is on ${input.issueId}. Start from the failed verification evidence in the handoff below and the newest dogfood report; implement the smallest correct fix with a regression test that is red before and green after.`,
    );
  }
  parts.push("---", "Handoff from previous phase:", "", baton);

  // Project-identity substitution runs over the JOINED prompt so the shared
  // rules block is covered too, but NEVER over the baton (worker-authored
  // text is quoted verbatim; a literal "<PROJECT_NAME>" in a handoff must
  // survive round-trips untouched). The baton is appended after.
  const project = input.project ?? DEFAULT_PROJECT;
  const head = parts
    .slice(0, -1)
    .join("\n\n")
    .replaceAll("<PROJECT_NAME>", project.name)
    .replaceAll("<OPERATOR_NAME>", project.operatorName)
    .replaceAll("<OPERATOR_HANDLE>", project.operatorLinearHandle);

  return {
    prompt: `${head}\n\n${baton}`,
    baton,
    batonToPost: existing === null ? baton : null,
  };
}
