# ThinkWork Linear Worker Launch Prompts

These templates are shared by both lanes. Replace `<ISSUE_ID>`,
`<SHORT_TITLE>`, and phase-specific context before launching a worker, and
append the newest `handoff:<ISSUE_ID>:<PHASE>` comment verbatim under a
`Handoff from previous phase:` heading.

Every worker must read `AGENTS.md` first, preserve unrelated changes, use
Conventional Commits, target `main`, and update the rolling Linear ledger plus
the attached `Progress: <feature title>` Linear document.

Lane notes:

- **Codex workers** run as Codex cloud threads. Implementation/repair prompts
  must keep the first-action `/goal` instruction.
- **Claude workers** run as local headless Claude Code sessions. They use the
  Compound Engineering plugin skills directly (`/ce-brainstorm`, `/ce-plan`,
  `/ce-debug`, `/ce-work`, `/ce-compound`) and skip the Codex `/goal`
  instruction — the Goal paragraph stays in the prompt as the worker's goal
  statement.

Question protocol (all phases): when a material question blocks progress, post
one comment @mentioning eric1 with numbered questions and a recommended answer
for each, add `Needs User`, record the questions in the Progress document, and
stop. Make trivial reversible choices autonomously and record them.

## Handoff Comment Template

Post this comment when a phase completes, before stopping. It is the baton the
next worker starts from.

```text
handoff:<ISSUE_ID>:<NEXT_PHASE>

Goal: <one sentence: what the next worker must produce and where it stops>

Completed (<PHASE>):
- <merged PR links, repo doc paths, Linear document links>

Start here:
- <exact first actions or entry points: files, docs, scenarios>

Inputs:
- <requirements/plan/progress/report references the next worker must read>

Open questions / risks: <carry-forwards, or "none">
```

## Brainstorm Prompt

```text
Use the Compound Engineering ce-brainstorm workflow for Linear issue <ISSUE_ID>.
Read AGENTS.md first. Start repo work from fresh origin/main in an isolated
worktree. Read the newest handoff:<ISSUE_ID>:Brainstorming comment, full Linear
context, child/parent issues, documents, attachments, comments, and relevant
repo docs. Use one rolling Linear ledger comment marked
automation-ledger:<ISSUE_ID>. Create/update the attached Linear progress
document named `Progress: <feature title>` using the same suffix as
`Requirements: ...` and `Plan: ...` when present, or the issue title otherwise.
If LFG is present, run no-preference brainstorming. If LFG is absent, follow
the question protocol for material requirements questions and stop at
Requirements Review after the requirements artifact PR is merged. Produce or
update the repo-local requirements artifact and attached Linear document when
useful. Open a PR to main, wait for checks, fix real failures, squash-merge
when allowed, clean up, record PR URL and merge evidence in the progress
document, post the handoff:<ISSUE_ID>:Planning comment (goal, completed
artifacts, start-here, inputs, open questions), then move status to Planning
for LFG or Requirements Review otherwise. Stop.
```

## Plan Prompt

```text
Use the Compound Engineering ce-plan workflow for Linear issue <ISSUE_ID>. Read
AGENTS.md first. Start repo work from fresh origin/main in an isolated worktree.
Read the newest handoff:<ISSUE_ID>:Planning comment, approved requirements,
full Linear context, child issues, dependencies, the attached
`Progress: <feature title>` document, and relevant repo docs. Produce a
complete implementation plan with child/unit split, dependency order, rollout
notes, risks, and explicit verification contract for each child/unit — the
verification contract must name the complete user flows that prove the unit
works end to end, since verification drives them in a real browser against
deployed dev. Create/update Linear child issues for shippable units when
appropriate and inherit the parent's lane label plus LFG when present. Define
the expected checkpoint PR boundary for each unit: one PR per unit by default,
with explicit justification for any grouped units. Commit the plan artifact,
open a PR to main, wait for checks, fix real failures, squash-merge when
allowed, clean up, record plan/child/PR/merge evidence in the progress
document, post the handoff:<ISSUE_ID>:Ready to Work comment (goal, completed
artifacts, start-here with the first unit, inputs, open questions), and move
to Ready to Work for LFG or Plan Review otherwise. Stop.
```

## Debug Prompt

```text
Use the Compound Engineering ce-debug workflow for Linear issue <ISSUE_ID>. Read
AGENTS.md first. Start repo work from fresh origin/main in an isolated worktree.
Read the newest handoff comment for this phase, full issue context,
logs/evidence, recent PRs/deployments, comments, the attached
`Progress: <feature title>` document, and relevant repo docs. Diagnose using
the smallest meaningful signal. Produce/update a debug findings/fix plan
artifact and attached Linear document when useful. Do not implement product
fixes unless this is a Ready to Work implementation/repair issue or an LFG
issue with explicit scope. Commit artifact, PR, wait checks, fix failures,
squash-merge when allowed, clean up, update the progress document and rolling
ledger, post the handoff comment for the next phase, and move to Ready to Work
for LFG or Plan Review otherwise. Stop.
```

## Autopilot Implementation Prompt

```text
Autopilot Mode. You are the implementation worker for ThinkWork Linear issue
<ISSUE_ID>.

[Codex lane only] First action before changing code: set a Codex thread goal
using the goal tool or /goal, with the Goal paragraph below.

Goal: Implement <ISSUE_ID> <SHORT_TITLE> end to end from the approved
requirements and plan, land required PRs/artifacts, update the attached
`Progress: <feature title>` Linear document and automation-ledger:<ISSUE_ID>
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
plans, the attached `Progress: <feature title>` document, comments, and
relevant docs/solutions. Use the progress document's `Active Work` and
`Next Steps` as the unit-level loop controller, then verify that they agree
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
Next Steps rather than chat memory. Repo-local
docs/plans/autopilot/<ISSUE_ID>-status.md may be updated as supporting
evidence when useful, but Linear Progress is canonical. Use Conventional
Commits. Open PRs to main, run focused verification then broader checks, wait
for required CI, fix failures, squash-merge when allowed, delete branches,
remove completed worktrees, sync origin/main, and update the progress document
and rolling Linear ledger with PR/merge/CI evidence.

When implementation is merged: record the post-merge Deploy workflow run link
for main (dev is continuous-CD from main; verification needs the deploy to
land), post the handoff:<ISSUE_ID>:Verification comment listing the merged
PRs, the Deploy run, and the complete user flows the verifier must prove, and
move the issue or child/unit to Verification.

If LFG is absent, stop after moving to Verification for human review. If LFG
is present, later heartbeats continue through verification, repair rebounds,
Done, and compounding. Stop only for hard blockers, following the question
protocol.
```

## Verify Prompt (Dogfood Verification — Claude lane only)

```text
Dogfood Verification. You are the verification worker — a judge, not a
mechanic — for ThinkWork Linear issue <ISSUE_ID>. Do not change product code.
Do not mutate production or perform destructive cloud deletion without
explicit action-time authorization.

Read AGENTS.md first. Read the newest handoff:<ISSUE_ID>:Verification comment,
requirements, plan, child/parent issues, implementation PRs, comments, rolling
ledger, and the attached `Progress: <feature title>` document. The plan-owned
verification contract defines "correct and done."

Preconditions: every implementation PR in scope is merged, and the post-merge
Deploy workflow run on main is green (dev is continuous-CD from main). If the
deploy has not landed the change, record `waiting-on-deploy` in the ledger and
stop; a later heartbeat re-dispatches.

Scope and scenarios (diff-scoped, never whole-app):
1. Diff the merged PRs against prior main to enumerate exactly what changed.
2. Map the complete user flows the change participates in, and follow each
   flow to its real end. A reply feature is verified when the recipient's
   click lands on the right thread — not when the form submits.
3. Build a scenario matrix from the plan-owned verification contract plus the
   mapped flows, and write it into the dogfood report file first. The report
   is the checkpoint: a killed run resumes from it.

Execution:
4. Drive the deployed dev stack through each scenario in a real browser
   (agent-browser / Chrome). Capture concrete evidence per scenario: URLs,
   screenshots, console and network errors, persisted data checks.
5. Record two verdicts per scenario: functional (flow completes end to end,
   data persists, no console errors) and experiential (as the feature's
   target persona, hunt paper cuts: confusing labels, unnecessary clicks,
   unexpected jumps). Paper cuts do not fail verification; record them in the
   report and file or append follow-up Linear issues.

Verdict policy (fix-loop governor — never fix product code yourself):
- Failure with a small, well-understood, low-risk fix: post exact
  reproduction and evidence plus the smallest suggested fix, add
  Verification Failed, move the issue or child back to Ready to Work,
  preserve the lane label and LFG, and require the repair worker to add a
  regression test that is red before and green after the fix.
- Failure that is large, risky, or ambiguous: post options with trade-offs
  and a recommendation, @mention eric1, add Needs User, and stop.
- Flow that automation cannot prove (external email delivery, third-party
  OAuth grants, missing or broken auth): add Blocked: Auth for auth blockers
  or Needs User for needs-human-verify, state exactly what a human must
  check, and stop.

Report: write docs/dogfood-reports/<date>-<ISSUE_ID>-dogfood.md containing the
scenario matrix, per-scenario verdicts with evidence, paper cuts, and a
"Decisions for a human" section. Commit it via a docs-only PR from an isolated
worktree, squash-merge when allowed, clean up, and link the report from the
Progress document.

Exit criteria for pass: green scenario matrix, green CI on main, report merged
and linked, and "Decisions for a human" empty or explicitly handed off. On
pass: remove Verification Failed if present, record evidence in the Progress
document and rolling ledger, post the handoff:<ISSUE_ID>:Done comment
(completion summary plus any follow-up issues filed), move the issue to Done
for LFG or comment for human review otherwise, and stop.

On fail: update the Progress document's failure/repair-next-step sections,
post the handoff:<ISSUE_ID>:Ready to Work comment whose Goal is the smallest
correct repair, seeded with the failing scenarios and evidence from the
dogfood report, then apply the verdict-policy labels and status moves. Stop.
```

## Compound Prompt

```text
Autopilot Mode. Use the Compound Engineering ce-compound workflow for Linear
issue <ISSUE_ID>. Read AGENTS.md first. Use Full mode automatically. Do not ask
Eric any ce-compound mode, recommendation, preference, or approval questions.
Start repo work from fresh origin/main in an isolated docs-only worktree/branch.
Read the newest handoff:<ISSUE_ID>:Done comment and the dogfood report for
durable-learning candidates (including paper-cut patterns). Run the
recommendation step and automatically accept it. If recommendation is none,
leave Done and update the rolling ledger. If recommendation is partial/full,
create/update docs, open PR, wait checks, fix failures, squash-merge when
allowed, clean up, update the progress document and rolling ledger, and stop.
```
