# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

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

### State Backend
The per-account store holding the Terraform state and locks for every Stage deployed into that AWS account. It is provisioned before any Stage exists and is shared by all of them, so destroying one Stage must never remove it — the State Backend outlives Stages and is dismantled only during Account Exit.

### Clean-Slate Destroy
The CLI's hardened teardown of a single Stage: it removes the obstacles that make naive destroys fail partway (protected databases, non-empty buckets, lingering secrets and logs) and finishes with an Orphan Scan. Its scope is the Stage's own resources; it deliberately leaves the account-shared State Backend, delegation records held at an external DNS parent, and log groups auto-created by AWS services — those belong to Account Exit or the parent-zone operator.

### Account Exit
The complete removal of the platform from an AWS account, beyond destroying its Stages: dismantling the State Backend and the residue a Clean-Slate Destroy cannot reach. An Account Exit is accepted only when an Orphan Scan across the account's resource-bearing services returns nothing.

### Orphan Scan
The per-service sweep that enumerates platform-named resources remaining in an AWS account or Stage after a teardown. An empty scan is the acceptance proof for both a Clean-Slate Destroy and an Account Exit; a non-empty scan names exactly what still needs removal.

### Graduation
The status that marks a Stage as protected because it carries durable value (a production or customer environment). Destroying a Graduated Stage requires explicitly re-asserting the stage and account identity — the protection exists to make the destructive intent unmistakable, not to forbid the act.

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

### Eval Profile
The agent-under-test as a named, reusable configuration: agent model, pinned judge model, and a trial count for judge-scored cases. Eval runs execute against a profile and pin its contents (plus a recorded fingerprint of the executing agent's installed skills) at dispatch, so two runs are comparable exactly when they share dataset version, scoring version, and judge pin — fingerprint drift is flagged, not silently compared. Each tenant designates one default profile, which automatic consumers (skill-eval gate, scheduled runs) score against; a missing default is synthesized on first resolution. Subsumes the older per-run `model` scalar override. Distinct from the unrelated "Agent Profile" (model+prompt presets at agent creation).

## Work Tracking

### Work Item
The native ThinkWork unit of durable work. A Work Item belongs to a tenant and an owning Space, can link to Threads for collaboration context, and owns task state such as status, owner, due date, required/applicable flags, completion metadata, provenance, and event history. Threads remain collaboration records; Work Items are the source of truth for work/task state. The UI may say "Tasks" in user-facing contexts, but the platform model is `work_item`.

### Work Item Status
A Space-scoped status row for Work Items. Status names, colors, icons, display order, active/final flags, and defaults belong to the Space, while every status also carries a normalized category such as `todo`, `active`, `blocked`, `done`, or `skipped`. Single-Space boards render the Space's exact statuses; cross-Space views use normalized categories or show status labels with Space context so different Spaces are not flattened into a misleading global workflow.

### Work Item View
A saved Work Items list or board configuration. A Work Item View preserves view type, filters, grouping, sorting, visible/configured fields, privacy/default/favorite metadata, and enough route state to reopen the same operational slice. Views are product affordances over native Work Items, not separate task state.

### Linked Task Compatibility
The transitional bridge between legacy `linked_tasks` rows and native Work Items. During migration, `linked_tasks` can carry compatibility pointers, snapshots, or provider-shaped data for older onboarding UI/tool callers, but native Work Items are canonical for ThinkWork-owned task state. Compatibility should be removed only after production data is backfilled or accounted for, web/mobile/Pi callers use Work Items directly, agent status tools no longer require `set_task_status`, and the remaining cleanup is tracked explicitly.

## Agent Capabilities

### Capability Mapping Matrix
The canonical contract for agent capabilities: capability class (skill, built-in tool, MCP server, Pi extension, plugin, context/memory) × assignment layer (agent, Agent Profile, Space, user), where every cell states assignable-or-not and the injection destination — the workspace folder, runtime-config field, or payload field the assignment lands in. A class/layer combination absent from the matrix is not offered anywhere in the product, and capability-wiring changes are reviewed against the cell they implement.

### Grant vs Shape
The two capability verbs in the layering model. The default agent and Agent Profiles *grant* reach — skills, MCP servers, extensions, built-in tools. Spaces and users *shape* behavior without granting reach: a Space carries context, skills, and restrictive overrides (blocked tools, model/budget/guardrails); a user carries identity, memory, and self-serve connections (OAuth, plugin activations) and is never directly assigned capabilities.

### Effective Capability Set
The merged result of all layers for a concrete context — agent × Space × Agent Profile × requesting user — after precedence (blocked = union, allowed = intersection, blocked wins; a Space skill overrides an agent skill with the same slug) and gating (trust report, eval gate, OAuth activation, plugin activation, allowlist). Requester-dependent by construction: two users in the same Space can have different effective sets.

### Capability Inspector
The operator surface (GraphQL query + Settings page + CLI read command) that renders the effective capability set for a selected agent × Space × Agent Profile × perspective-user combination, with per-item provenance and a why-not-active reason from the enumerated gate taxonomy. It computes through the runtime's own composer (never a parallel implementation) and stamps each response with a computed-at time and resolved-config fingerprint so manifest divergence can be asserted honestly.

### Capability Manifest
Per-turn runtime evidence of what the agent actually received: which skills, tools, MCP servers, and extensions loaded, which were gated out, and why. The runtime-truth counterpart to the config-derived effective capability set; divergence between the two is a defect signal, and the manifest doubles as the action-time capability snapshot the compliance direction requires.

## Flagged ambiguities

## MCP Apps

### MCP App Host Context
The portable runtime context ThinkWork supplies to an embedded MCP App view
through the MCP Apps host bridge, including the current host theme and
standardized style variables. Host context is the source of truth for embedded
app readability; app-specific configuration can provide fallbacks or domain
defaults but must not replace the host's theme contract.

## Customer Domain Namespace

### Namespace Claim
Reserving a name in the shared customer-facing subdomain pool. A claim is two-phase: first a placeholder reservation that takes the name, then the swap to real delegation records once the customer's DNS zone exists. The claim tool is the only writer to the registry, and a claimed deployment name must equal the customer stack's tenant slug or inbound mail cannot route.

### Delegation Gate
The switch on a customer deployment that holds DNS-dependent resources (certificate validation, web aliases, callback additions) inert until the namespace delegation publicly resolves. Flipping it before delegation fails fast rather than hanging.

### Dual Window
The cutover period during which both the legacy domain and the claimed namespace domain are simultaneously valid for sign-in and sending, so users and mail are never stranded mid-migration.

### Legacy Retirement
The reviewable, gated step that ends the Dual Window: legacy callback entries and the legacy email identity are removed only after the cutover has deployed and a fresh survey finds no remaining consumers of the old domain.
