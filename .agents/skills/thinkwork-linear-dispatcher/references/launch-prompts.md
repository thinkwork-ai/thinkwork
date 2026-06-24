# ThinkWork Linear Worker Launch Prompts

Replace `<ISSUE_ID>`, `<SHORT_TITLE>`, and phase-specific context before
creating a thread. Every worker must read `AGENTS.md` first, preserve unrelated
changes, use Conventional Commits, target `main`, and update the rolling Linear
ledger.

## Brainstorm Prompt

```text
Use the Compound Engineering ce-brainstorm workflow for Linear issue <ISSUE_ID>.
Read AGENTS.md first. Start repo work from fresh origin/main in an isolated
worktree. Read full Linear context, child/parent issues, documents,
attachments, comments, and relevant repo docs. Use one rolling Linear ledger
comment marked automation-ledger:<ISSUE_ID>. If LFG is present, run
no-preference brainstorming. If LFG is absent, ask only material requirements
questions and stop at Requirements Review after the requirements artifact PR is
merged. Produce/update the repo-local requirements artifact and attached Linear
document when useful. Open a PR to main, wait for checks, fix real failures,
squash-merge when allowed, clean up, record PR URL and merge evidence, then
move status to Planning for LFG or Requirements Review otherwise. Stop.
```

## Plan Prompt

```text
Use the Compound Engineering ce-plan workflow for Linear issue <ISSUE_ID>. Read
AGENTS.md first. Start repo work from fresh origin/main in an isolated worktree.
Read approved requirements, full Linear context, child issues, dependencies,
and relevant repo docs. Produce a complete implementation plan with child/unit
split, dependency order, rollout notes, risks, and explicit verification
contract for each child/unit. Create/update Linear child issues for shippable
units when appropriate and inherit Codex plus LFG when present on the parent.
Commit the plan artifact, open a PR to main, wait for checks, fix real
failures, squash-merge when allowed, clean up, record plan/child/PR/merge
evidence, and move to Ready to Work for LFG or Plan Review otherwise. Stop.
```

## Debug Prompt

```text
Use the Compound Engineering ce-debug workflow for Linear issue <ISSUE_ID>. Read
AGENTS.md first. Start repo work from fresh origin/main in an isolated worktree.
Read full issue context, logs/evidence, recent PRs/deployments, comments, and
relevant repo docs. Diagnose using the smallest meaningful signal.
Produce/update a debug findings/fix plan artifact and attached Linear document
when useful. Do not implement product fixes unless this is a Ready to Work
implementation/repair issue or an LFG issue with explicit scope. Commit
artifact, PR, wait checks, fix failures, squash-merge when allowed, clean up,
update ledger, and move to Ready to Work for LFG or Plan Review otherwise.
Stop.
```

## Autopilot Implementation Prompt

```text
Autopilot Mode. You are the Codex implementation worker for ThinkWork Linear
issue <ISSUE_ID>.

First action before changing code: set a Codex thread goal using the goal tool
or /goal. Use this goal:

Implement <ISSUE_ID> <SHORT_TITLE> end to end from the approved requirements and
plan, land required PRs/artifacts, update automation-ledger:<ISSUE_ID> and
docs/plans/autopilot/<ISSUE_ID>-status.md with evidence, move <ISSUE_ID> to
Verification when implementation is merged and locally verified, and stop for
human review if LFG is absent; if LFG is present, continue the closed loop
through verification, repair rebounds, Done, and selective compounding.

Use the Compound Engineering workflow in autopilot mode for this repository.
Read AGENTS.md first. Fetch full Linear context, documents, attachments,
comments, child/parent issues, dependencies, blockers, and repo-local planning
files. Discover and read attached/referenced requirements, plans, docs,
comments, and relevant docs/solutions. Use the plan-owned verification contract.
Start from fresh origin/main in this isolated worktree. Implement the active
issue or child/unit end to end with no preference questions.

If Verification Failed is present, start from failed verification evidence and
implement the smallest correct fix. Update
docs/plans/autopilot/<ISSUE_ID>-status.md locally and commit it at phase
boundaries. Use Conventional Commits. Open PRs to main, run focused verification
then broader checks, wait for required CI, fix failures, squash-merge when
allowed, delete branches, remove completed worktrees, sync origin/main, update
the rolling Linear ledger with PR/merge/CI evidence, and move the issue or
child/unit to Verification when implementation is merged.

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
relevant repo docs. Confirm whether implementation matches the plan-owned
verification contract, then actively prove the end-to-end behavior yourself. Do
not change product code. Do not mutate production or perform destructive cloud
deletion without explicit action-time authorization.

If validation fails, post exact reproduction/proof, add Verification Failed,
move issue back to Ready to Work, preserve Codex and LFG, and stop. If
verification passes and every required PR is merged, remove Verification Failed
if present, record evidence, move issue to Done, and stop.
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
squash-merge when allowed, clean up, update ledger, and stop.
```
