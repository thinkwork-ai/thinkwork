# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Work Management

### Work Item

A ThinkWork-owned unit of durable task state, stored as `work_items` and addressed in platform code as `work_item`. Threads can discuss, prove, or coordinate a Work Item, but the Work Item owns the operational state: Space, status, title, notes, owner, due date, required/applicable flags, blocker state, completion metadata, provenance, and event history. Customer Onboarding is the first production producer, and future external systems may reference or request updates to Work Items without becoming the source of truth.

### Work Item Status

A Space-scoped status row for Work Items. Statuses carry the local workflow label and presentation data, including display order, color, icon, active/final/default flags, and a normalized category of `todo`, `active`, `blocked`, `done`, or `skipped`. Single-Space boards render the Space's exact statuses; cross-Space views use normalized categories or Space context so different Space workflows are not flattened into one misleading global workflow.

### Work Item View

A saved Work Items perspective that preserves view type, filters, grouping, sorting, visible/configured fields, privacy, default, and favorite state. V1 views are list and board oriented, with route state and saved view payloads describing how a human or team scans Work Items across Spaces, owners, due dates, statuses, blocked state, required/applicable flags, priority, and linked Threads.

### Linked Tasks Compatibility Period

The migration window where `linked_tasks` remains as compatibility plumbing for existing Customer Onboarding data, generated progress snapshots, thread surfaces, and agent/mobile callers. During this period Work Items are canonical and `linked_tasks` is derived or bridged state; compatibility should be removed only after production data is backfilled or confirmed migrated, old callers have moved to Work Item APIs/tools, and the removal has explicit verification evidence.

## Deployment

### Stage

A named, fully isolated deployment environment of the platform — its own AWS stack (database, Lambdas, Cognito pool, storage) — selected per command by the CLI's stage flag and backed by a single Terraform workspace. Vendor-operated stages (the shared dev and prod) are continuously deployed from the trunk by the vendor's CI on every merge; customer stages are instead applied by a Deployment Controller in the customer's own account. On a continuously-deployed stage a change is durably live only once it is on the trunk — code pushed to such a stage from a feature branch is reverted by the next trunk deploy.

### Deployment Controller

The AWS-native control plane that lives inside a customer's own AWS account and applies platform releases there. Steady-state deployment authority belongs to the controller in the customer account, not to the vendor's CI.

### Deployment Runner

The script the Deployment Controller executes to render a deployment root, run Terraform against the pinned release, and record Deployment Evidence. It is hosted in the customer account and changes only through Runner Self-Update or manual replacement.

### Bootstrap

The one-time, operator-driven provisioning that creates the Deployment Controller in a customer account. After Bootstrap, the controller owns deploys and the components it was born with are subject to the Control-Plane Freeze.

### Control-Plane Freeze

The property that Deployment Controller components (including the Deployment Runner and its execution role) are provisioned at Bootstrap and never modified by ordinary customer deploys. A release that requires the runner or its role to change cannot deliver that change through the deploy it is required for — it needs Runner Self-Update from a prior successful run, or manual intervention.

### Runner Self-Update

The mechanism by which a successful deploy replaces the Deployment Runner with the version from the release just deployed. It runs only after success, so it cannot rescue a runner too old to complete the current release — that gap is closed manually.

### Release Manifest

The integrity-pinned description of a platform release — its artifact bundles, runtime images, and compatibility floors (including the minimum runner version) — that a Deployment Controller consumes to apply that release.

### Deployment Evidence

The per-run record a Deployment Runner writes for operators and the control plane: what was planned, what was applied, run status, and which inputs the runner actually consumed. Evidence is how version skew and dropped inputs become visible.

## Evaluations

### Verdict taxonomy

Every eval result is exactly one of `pass`, `fail`, or `error`. `pass`/`fail` are behavioral judgments of the agent; `error` is an infrastructure outcome (timeout, throttle, evaluator/judge crash, reconciler-closed) carrying a cause, and is excluded from the pass rate. A run's score is computed over clean executions only — errors surface separately as run health, never dragging down the behavioral number. Runs scored before this taxonomy are marked "legacy scoring" and excluded from trend averages rather than silently reinterpreted.

### Eval replay

Re-sending a recorded thread's request to today's agent and scoring the fresh response — a regression test that answers "is the system fixed now?". Distinct from trace judgment (scoring the already-recorded conversation, an audit of the past). Replay is read-only by construction: outbound side-effect tools are always stripped and MCP tools are gated to read-only, so re-running a past request never re-executes its writes.

### Flagged-thread case

An eval case created by an operator flagging a production thread with a bad outcome (security or quality). It captures a self-contained flag-time snapshot (message history, the projected workspace, tool traces when available) plus a Resolution Target, and survives deletion of the source thread.

### Resolution target

What should have happened, recorded by the operator at flag time. It becomes the rubric the judge scores the replayed output against — required, because without it a re-run has nothing to score.

### Scoring engine

The ThinkWork-owned contract (case + agent response in, verdicts out) behind which scoring backends plug. The in-house scorer (deterministic assertions + LLM-rubric judge) is engine #1; an AgentCore Evaluations adapter exists gated-off as the documented activation seam. The dataset format and verdict taxonomy are engine-neutral — engine-specific concepts never leak into them.

### Eval dataset

A per-tenant, versioned collection of eval cases stored as an S3 artifact with a derived DB index. Each tenant gets a `baseline-red-team` dataset (the seeded red-team suite) at install; operators curate custom datasets by flagging threads. Case identity is stable across dataset versions so trend history survives.

## Flagged ambiguities

## Customer Domain Namespace

### Namespace Claim

Reserving a name in the shared customer-facing subdomain pool. A claim is two-phase: first a placeholder reservation that takes the name, then the swap to real delegation records once the customer's DNS zone exists. The claim tool is the only writer to the registry, and a claimed deployment name must equal the customer stack's tenant slug or inbound mail cannot route.

### Delegation Gate

The switch on a customer deployment that holds DNS-dependent resources (certificate validation, web aliases, callback additions) inert until the namespace delegation publicly resolves. Flipping it before delegation fails fast rather than hanging.

### Dual Window

The cutover period during which both the legacy domain and the claimed namespace domain are simultaneously valid for sign-in and sending, so users and mail are never stranded mid-migration.

### Legacy Retirement

The reviewable, gated step that ends the Dual Window: legacy callback entries and the legacy email identity are removed only after the cutover has deployed and a fresh survey finds no remaining consumers of the old domain.
