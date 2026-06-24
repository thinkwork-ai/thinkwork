# ThinkWork Linear Worker Launch Prompts

Replace `<ISSUE_ID>`, `<SHORT_TITLE>`, and phase-specific context before
creating a thread. Every worker must read `AGENTS.md` first, preserve unrelated
changes, use Conventional Commits, target `main`, and update the rolling Linear
ledger plus the attached `Progress: <feature title>` Linear document.

## Brainstorm Prompt

```text
Use the Compound Engineering ce-brainstorm workflow for Linear issue <ISSUE_ID>.
Read AGENTS.md first. Start repo work from fresh origin/main in an isolated
worktree. Read full Linear context, child/parent issues, documents,
attachments, comments, and relevant repo docs. Use one rolling Linear ledger
comment marked automation-ledger:<ISSUE_ID>. Create/update the attached Linear
progress document named `Progress: <feature title>` using the same suffix as
`Requirements: ...` and `Plan: ...` when present, or the issue title otherwise.
If LFG is present, run
no-preference brainstorming. If LFG is absent, ask only material requirements
questions and stop at Requirements Review after the requirements artifact PR is
merged. Produce/update the repo-local requirements artifact and attached Linear
document when useful. Open a PR to main, wait for checks, fix real failures,
squash-merge when allowed, clean up, record PR URL and merge evidence in the
progress document, then move status to Planning for LFG or Requirements Review
otherwise. Stop.
```

## Plan Prompt

```text
Use the Compound Engineering ce-plan workflow for Linear issue <ISSUE_ID>. Read
AGENTS.md first. Start repo work from fresh origin/main in an isolated worktree.
Read approved requirements, full Linear context, child issues, dependencies,
the attached `Progress: <feature title>` document, and relevant repo docs.
Produce a complete implementation plan with child/unit
split, dependency order, rollout notes, risks, and explicit verification
contract for each child/unit. Create/update Linear child issues for shippable
units when appropriate and inherit Codex plus LFG when present on the parent.
Commit the plan artifact, open a PR to main, wait for checks, fix real
failures, squash-merge when allowed, clean up, record plan/child/PR/merge
evidence in the progress document, and move to Ready to Work for LFG or Plan
Review otherwise. Stop.
```

## Debug Prompt

```text
Use the Compound Engineering ce-debug workflow for Linear issue <ISSUE_ID>. Read
AGENTS.md first. Start repo work from fresh origin/main in an isolated worktree.
Read full issue context, logs/evidence, recent PRs/deployments, comments, and
the attached `Progress: <feature title>` document, and relevant repo docs.
Diagnose using the smallest meaningful signal.
Produce/update a debug findings/fix plan artifact and attached Linear document
when useful. Do not implement product fixes unless this is a Ready to Work
implementation/repair issue or an LFG issue with explicit scope. Commit
artifact, PR, wait checks, fix failures, squash-merge when allowed, clean up,
update the progress document and rolling ledger, and move to Ready to Work for
LFG or Plan Review otherwise. Stop.
```

## Autopilot Implementation Prompt

```text
Autopilot Mode. You are the Codex implementation worker for ThinkWork Linear
issue <ISSUE_ID>.

First action before changing code: set a Codex thread goal using the goal tool
or /goal. Use this goal:

Implement <ISSUE_ID> <SHORT_TITLE> end to end from the approved requirements and
plan, land required PRs/artifacts, update the attached `Progress: <feature title>`
Linear document and automation-ledger:<ISSUE_ID> with evidence, move <ISSUE_ID>
to Verification when implementation is merged and locally verified, and stop for
human review if LFG is absent; if LFG is present, continue the closed loop
through verification, repair rebounds, Done, and selective compounding.

Use the Compound Engineering workflow in autopilot mode for this repository.
Read AGENTS.md first. Fetch full Linear context, documents, attachments,
comments, child/parent issues, dependencies, blockers, and repo-local planning
files. Discover and read attached/referenced requirements, plans, the attached
`Progress: <feature title>` document, comments, and relevant docs/solutions.
Use the progress document's `Active Work` and `Next Steps` as the unit-level
loop controller, then verify that they agree with Linear status, open PRs,
worker handoffs, and local worktrees. Use the plan-owned verification contract.
Start from fresh origin/main in this isolated worktree. Implement the active
issue or child/unit end to end with no preference questions.

If Verification Failed is present, start from failed verification evidence and
implement the smallest correct fix. Update the progress document after every
meaningful round and at unit boundaries. Repo-local
docs/plans/autopilot/<ISSUE_ID>-status.md may be updated as supporting evidence
when useful, but Linear Progress is canonical. Use Conventional Commits. Open
PRs to main, run focused verification then broader checks, wait for required CI,
fix failures, squash-merge when allowed, delete branches, remove completed
worktrees, sync origin/main, update the progress document and rolling Linear
ledger with PR/merge/CI evidence, and move the issue or child/unit to
Verification when implementation is merged.

If LFG is absent, stop after moving to Verification for human review. If LFG is
present, continue on later heartbeats through verification, repair rebounds,
Done, and compounding. Stop only for hard blockers.
```

## Verify Prompt

```text
Use the Compound Engineering verification/review workflow for Linear issue
<ISSUE_ID>. Read AGENTS.md first. Start any repo artifact work from fresh
origin/main in an isolated worktree. Read requirements, plan, child/parent
issues, implementation PRs, comments, rolling ledger, validation evidence, and
the attached `Progress: <feature title>` document, and relevant repo docs.
Confirm whether implementation matches the plan-owned
verification contract, then actively prove the end-to-end behavior yourself. Do
not change product code. Do not mutate production or perform destructive cloud
deletion without explicit action-time authorization.

If validation fails, post exact reproduction/proof, add Verification Failed,
move issue back to Ready to Work, preserve Codex and LFG, update the progress
document's failure/repair-next-step sections, and stop. If verification passes
and every required PR is merged, remove Verification Failed if present, record
evidence in the progress document and rolling ledger, move issue to Done, and
stop.
```

## Compound Prompt

```text
Autopilot Mode. Use the Compound Engineering ce-compound workflow for Linear
issue <ISSUE_ID>. Read AGENTS.md first. Use Full mode automatically. Do not ask
Eric any ce-compound mode, recommendation, preference, or approval questions.
Start repo work from fresh origin/main in an isolated docs-only worktree/branch.
Run the recommendation step and automatically accept it. If recommendation is
none, leave Done and update the rolling ledger. If recommendation is
partial/full, create/update docs, open PR, wait checks, fix failures,
squash-merge when allowed, clean up, update the progress document and rolling
ledger, and stop.
```
