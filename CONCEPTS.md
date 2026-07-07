# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Deployment

### Stage
A named, fully isolated deployment environment of the platform — its own AWS stack (database, Lambdas, Cognito pool, storage) — selected per command by the CLI's stage flag and backed by a single Terraform workspace. Vendor-operated stages (the shared dev and prod) are continuously deployed from the trunk by the vendor's CI on every merge; customer stages are instead applied by a Deployment Controller in the customer's own account. On a continuously-deployed stage a change is durably live only once it is on the trunk — code pushed to such a stage from a feature branch is reverted by the next trunk deploy.

### Targeted Apply
The reduced-scope Terraform apply a continuously-deployed Stage runs when a trunk merge changes no Terraform source: instead of converging the whole stack, it applies only a fixed recovery list of resources (the API handler functions and their grouped IAM policies). Its purpose is recovering stale handler code after transient failures without pulling unrelated drift into the deploy.

Because deploy runs cancel superseded runs, a merge that does change Terraform can have its full apply cancelled by the next merge — leaving the Targeted Apply as the only apply that ever runs for it. Any resource class absent from the recovery list can therefore sit merged-but-unapplied indefinitely while every deploy reports success; a resource added to the recovery-critical set must enter the recovery list in the same change.

### Deployment Controller
The AWS-native control plane that lives inside a customer's own AWS account and applies platform releases there. Steady-state deployment authority belongs to the controller in the customer account, not to the vendor's CI.

### Runtime Config
The unauthenticated `thinkwork-runtime-config.json` document the CLI publishes to a deployment's web host after every deploy: the client-facing settings for that environment (Cognito pool/client/domain, GraphQL HTTP/WS endpoints, API key). The web app boots from it with build-time env as fallback; it is the discovery document clients use to configure themselves against an environment from nothing but its web URL.

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

### Worktask Template
The data-defined description of a Space workflow: an ordered set of task definitions — each with a role, required/applicability rules, and an optional external-task binding — plus the workflow's required intake fields and completion criteria. Starting a workflow (by webhook, manual start, or thread creation) materializes the template into Work Items, which then hold all live state; the template itself is never a runtime state store. Templates are per-tenant, per-Space data an operator can change without a code deploy, and workflow logic never branches on an external provider — external systems of record attach through external references resolved by plugin adapters.
*Avoid:* checklist template, workflow config

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

### Agent Page
The single operator surface for all agent configuration (Settings → Agent, route `/settings/agents`): the Composer editor shell — selection chips over a rendered-workspace file tree and editor — plus three purpose-built side sheets for the non-file concerns (Config, Profiles, Extensions). Supersedes the separate Agents page and Composer nav entries; capability attachment is tree-first, and profile definitions are hybrid — `agents/<slug>.md` content in the tree, structured fields in the Profiles sheet.

### Capability Manifest
Per-turn runtime evidence of what the agent actually received: which skills, tools, MCP servers, and extensions loaded, which were gated out, and why. The runtime-truth counterpart to the config-derived effective capability set; divergence between the two is a defect signal, and the manifest doubles as the action-time capability snapshot the compliance direction requires.

### Connection
A workspace-native capability class superseding "MCP server" as the product concept: an external system the agent can reach, of type MCP or API, defined by `connections/<slug>/CONNECTION.md` plus a `.assignment.json` sidecar in the agent workspace. Presence declares the connection; only platform-signed sidecar state (operator action or trust-gate pass) activates it. Sidecars carry enabled state, `permissions.operations`, approval policy, and credential references — never secret values. Distinct from the legacy `connections` DB table (per-user OAuth rows), which becomes the per-principal satisfaction ledger behind this concept.

### Tool Kind
The four-way taxonomy for workspace-defined tools (`tools/<slug>/TOOL.md`): `binding` (declarative wrapper over admitted connection operations — stable verb, preset arguments, model-vs-thread output shaping), `platform` (reference to a runtime-implemented built-in; implementation stays in the container), `extension` (binds an approved dynamic Pi extension tool), and `script` (sandbox-executed tenant content; the only kind requiring a trust-gate pass before registration). Definition files are declarative — never tenant TypeScript — so no tool change requires a container rebuild.

## Memory & Brain

### Tenant Brain
The single tenant-level consolidated memory layer: a lightweight knowledge graph in plain Postgres plus the wiki pages materialized from it. Sits above the raw Hindsight user and Space banks as the only consolidation target — there is no team or per-space brain tier; team and space are scope attributes on Brain content, not separate stores.

### Dream State
The recurring background consolidation pass over memory banks. It does two jobs: hygiene on the banks in place (merge duplicates, resolve contradictions, decay or forget stale and junk memories, quarantine eval-test residue — real deletion, not view filtering) and distillation of consolidated facts into the Tenant Brain's knowledge graph as evidence. It is the only ingestion path into the Brain.

### Evidence-Threshold Promotion
The mechanical rule deciding which knowledge-graph entities earn wiki pages: an entity is promoted when it crosses observable evidence thresholds (distinct-thread mentions over time, relationship count, referenced by another page). Ontology types are optional labels and never gate promotion. Sub-threshold entities remain fully agent-queryable in the graph; promotion controls only the human wiki window.

### Progressive Discovery
The agent's Brain-first memory read path: consult the compiled wiki and knowledge graph first, then drill down into raw Hindsight bank recall only when underlying detail is needed.

### External Research Loop
The event-triggered enrichment path that grows the Wiki from outside sources: a new-Entity event (or manual per-entity action) enqueues a deterministic research routine that gathers summarized, cited, origin-tagged facts from zero-credential public sources and submits them through the standard retain → Reflection → Wiki-Compile pipeline. Never a second ingestion path — Reflection remains the only Brain gate.

### Research Lot
The recall unit for externally-sourced knowledge: every research run stamps its observation batch with a lot ID threaded through KG extraction into derived entity/relationship provenance. Recalling a lot tombstones it, removes or downgrades its derived graph state via merge-upsert, recompiles affected wiki pages, and discloses the recall in their coverage line.

## Living Artifacts

### Living Canvas
A GenUI (json-render) artifact with living semantics: it exists as an artifact from first emission (born-as-artifact, status `draft`), belongs to a space rather than its originating thread, and is edited across threads via chat. Contrast with the pre-THINK-145 model where artifacts were immutable promote-time snapshots. v1 living semantics apply to the canvas kind only.

### Living Head / Snapshot
The two storage grades of a Living Canvas. The living head is the overwrite-in-place working copy the agent and user keep editing; a snapshot captures the head as a content-addressed, write-once version in the artifact's linear version chain (formerly "pinned version" — "pin" is reserved for nav pinning). A deferred third grade, the published embed, is a snapshot plus a revocable token for outside-the-app reads.

### Data-Source Binding
The record of the tool invocation that produced a widget's data: MCP server ref, tool name, frozen args, result-shape hash, auth context, last-fetched time. The binding IS the widget's data source — "open it up" shows the saved call, refresh re-executes it. Refresh runs only under the identity that produced the original data; per-user-OAuth bindings are never refreshed unattended.

### Data-Refresh vs Schema-Refresh
The two refresh operations on a bound widget. Data-refresh re-executes the saved call headlessly and replaces only the data slice — no agent turn, no tokens. Schema-refresh fires on a result-shape hash mismatch and escalates to an agent turn to re-emit the spec; mismatched data is never rendered through the old spec.

### Freshness Flags
The per-widget data-quality state rendered with every bound widget: GOOD (fresh), STALE (refresh blocked or overdue), BAD (last refresh failed). A widget never blanks on failure — last-good data stays visible under the degraded badge (SCADA last-good discipline).

### Check-Out / Check-In
Reopening a saved Living Canvas as a live part in a thread under its original stable part id (check-out), editing it via chat, and re-saving as a new snapshot on the same artifact (check-in). The return path that keeps one identity across threads instead of forking duplicate artifacts.

## Document Artifacts

### Document Artifact
A dual-body artifact kind: a canonical markdown digest (the record agents, mobile, and Brain consume) plus a self-contained single-file HTML render (the human-facing body), both emitted in one `emit_document` call. Born-as-artifact like a Living Canvas but with no data bindings — the simplest kind on the living-artifacts substrate. Four v1 genres: Ideation, Plan, Report, Brief.

### Document Tier
The scriptless rendering containment level for Document Artifacts: the sandboxed-iframe trust model with `allow-scripts` stripped (zero grants). Contrast with the app tier (McpAppFrame), which grants script execution. A document that needs interactivity graduates to the app tier deliberately; it never gains scripts at the document tier.

### DocSpector
The emission-time preflight validator for Document Artifacts: default-deny rejection of non-self-contained HTML (any URL-resolving attribute or CSS value that is not `data:`, `#fragment`, or `mailto:`), any `<script>` at the document tier, oversize bodies, missing dark-mode support, and renders not authored on the matching Genre Plate — with model-actionable diagnostics so the agent self-corrects in-turn. Named after SkillSpector, the skill-publish trust gate.

### Public Share Link
A revocable, unguessable tokenized URL that serves a Document Artifact's live compiled render to anonymous readers outside the workspace (THINK-208). Live by definition — recompiles are visible to link-holders; freezing stays the Snapshot mechanism's job. Minted only for document artifacts (the scriptless DocSpector guarantee is the safety premise); the "workspace members" share option is just the canonical app URL, not a token. Contrast with the deferred canvas-era "published embed", which was snapshot-based.

### Genre Plate
A registered document genre's visual and structural identity: display name, use-for description, eyebrow, title suffix, palette tokens, and directive availability. Since the Document Compositor (THINK-154), a plate is compiler-owned configuration — the agent never authors on it; the server compiles every render from it, so plate conformance holds by construction. The exemplar-HTML plates shipped in the document-composer skill and DocSpector's off-plate rejection are the retired v1 mechanism. Shipped (THINK-153): plates are tenant-scoped registry rows — operators create and edit them as structured config, never freehand HTML. Target state (THINK-182/183): plates also carry a content contract — a Section Manifest and Declared Analyses — so a plate shapes what the agent authors, not just how it looks.

### Section Manifest
A plate's ordered declaration of the sections a document in that genre should contain. Each section carries a stable id, title, guidance text, optional suggested directives, and a tier: `required` (silent omission is a preflight rejection), `required-if-material` (required, but waiver-on-thin-data is the expected common case), or `suggested` (never blocks or warns). Section presence is checked against the compositor's id-anchored heading seam. A plate with no manifest behaves as pure styling config (THINK-183).

### Declared Analysis
A calculation a plate names as part of its content contract, referencing a typed op from the closed, platform-versioned analysis op registry (funnel conversion, ratio, variance-vs-prior, etc. — the calc-layer sibling of the Directive Block vocabulary). The server computes the result deterministically from raw inputs the model supplies at emission (`model-supplied` source, v1) and directives render the computed value by key — the model narrates numbers it was handed, never numbers it invented. The declared `source` seam accommodates a future binding-backed rung once document data bindings exist (THINK-183).

### Suitability Waiver
The explicit escape hatch for a required section the model cannot back with data: the model waives the section with a stated reason at emission. The waiver renders as a visible omission notice at the section's position in the document body, is recorded in the provenance footer, and is persisted queryably per plate (feeding conformance scoring). A waivered document still reaches `final` — omission is honest and loud, never silent, and never stalls recurring runs (THINK-183).

### Platform Floor
The governance rule for tenant customization of a platform plate's content contract (THINK-188): the platform's required sections and declared analyses are a floor — tenants can add sections and analyses, rewrite a floor section's guidance, raise its tier, and add suggested widgets, but never remove or retitle a platform section (the title is the enforcement key), lower its tier, or remove a platform analysis. Enforced server-side at save; contract merge layers tenant deltas over the floor so platform contract improvements keep propagating to customized tenants. Tenant-created plates have no floor — full contract ownership.

## Skills Distribution

### Skill Catalog
The per-tenant library of publishable skills: each entry holds the skill's source files plus its trust evidence, and is the unit operators install onto agents. Publication into the catalog is trust-gated — a skill enters or updates only through the Skill Trust Pipeline. Distinct from the installed copy an agent runs (see Skill Materialization).

### Skill Trust Pipeline
The gate sequence a skill passes to become runnable: publish (content lands in the Skill Catalog with a content hash), trust scan (automated review must pass), and signature (a platform signature over the approved content). All three must be current for the runtime to load the skill; a content change invalidates them and the sequence re-runs.

### Skill Materialization
The copy step from Skill Catalog to an agent's workspace: installing a skill writes its files into the agent's own skill folder, and the runtime reads only that materialized copy — never the catalog directly. Consequence: republishing a skill's catalog content does not change agent behavior until the installed copy is re-materialized; a plain install skips agents that already have the folder, so content updates require an explicit reinstall.

### Default Skill Seeding
The deploy-time process that publishes a curated allowlist of platform skills through the Skill Trust Pipeline into every tenant's Skill Catalog, auto-installing designated ones on the platform agent. Only allowlisted skills participate — a default skill absent from the allowlist never propagates, regardless of content changes.

### Document Compositor
The deterministic server-side compiler (v2 of the document pipeline, THINK-154) that turns an agent-authored markdown body — frontmatter, prose, and Directive Blocks — into the house-style HTML render at emission. Removes HTML from the model's hands entirely: identical input compiles to identical output, plate conformance holds by construction rather than by DocSpector rejection, and the same function powers corpus backfill.

### Directive Block
A fenced block in a compositor-authored markdown body carrying declarative data for a house component — a chart, stats strip, verdict grid, or timeline — from a versioned, closed, per-genre vocabulary. The model writes the data; the compiler renders the pixels. Unknown directives are a compile-time rejection, and there is no raw-HTML escape block. Because directives live in the canonical digest, agents and mobile read them as legible fenced data.

### House Chart Renderer
The compositor's deterministic SVG chart engine: palette-locked to the house tokens, dark-mode aware, scriptless by construction. Renders chart Directive Blocks at compile time so every document's visuals match. Launch catalog: bar, line, donut, stat-strip, sparkline, meter, funnel.

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

## Threads & Multiplayer

### Multiplayer Thread
A Spaces thread with two or more human participants. In a Multiplayer Thread the agent is not engaged automatically — a message dispatches only when the agent is mentioned or explicitly requested. A thread becomes Multiplayer the moment a second human becomes a participant, including via an @mention the person has not yet answered.

### Thread Mode
The per-thread dispatch posture — Agent (messages auto-dispatch to the agent) or Multiplayer (mention required). Derived server-side from the thread's human participant count, with an explicit per-thread override settable from the thread info panel that applies to all participants and wins over the derived default.

### Mention Invite
The grant created by @mentioning a user in a thread: the user becomes a thread participant and gains visibility to that one thread, even inside a private Space they are not a member of. It is thread-level access, not Space membership.

### Mention Trigger Character
The `@` and `#` sigils are disjoint by target type, not interchangeable delegation shortcuts: `@` addresses a user or agent (Mention Invite, per-sender context), `#` addresses an Agent Profile (delegation to that profile's lane). A name matching both a user and a profile resolves `@` to the user and produces zero profile mentions — `@` can never trigger profile delegation, regardless of what the matched alias also happens to be. This supersedes an earlier backward-compatible `@Profile` alias that was deliberately removed once product decided the ambiguity itself (not just automatic inference) was the defect.

### Per-Sender Context Injection
The rule that an agent turn is contextualized by whoever triggered it: the sending user's workspace projection and memory bank are injected into that turn, on every dispatch path. In multiplayer threads this means consecutive turns can carry different users' contexts.

## Deterministic Routines

### Deterministic Routine
An agent-authored, token-free Python function that replaces repeated agent-thread work. Its code lives only in the tenant-configured routine git repository (single source of truth — the platform stores metadata and SHA pointers, never a second copy); it is pulled at latest on execution with the commit SHA recorded per run, and is invocable as a "Run routine" action inside an Automation with zero agent turns.

### Validated SHA
The most recent commit of a routine that has passed that routine's recorded fixtures. A SHA the executor has not seen must pass the Fixture Gate before it becomes the validated SHA; execution falls back to the last validated SHA when a new SHA fails or when the git host is unreachable.

### Fixture Gate
The rule that a routine change — agent repair or direct human push — runs the routine's recorded input/expected-output fixtures before first production use, and that a routine cannot be used by an Automation without at least one fixture ("no fixture, no publish").

### Repair Ladder
The budgeted escalation path for routine failures: mechanical tier first at zero token cost (retry once, revert to the last Validated SHA), then a rate-limited agent wakeup that commits a fix which auto-publishes on green fixtures and is recorded in a visible repair log. Exhausting the repair budget disables the routine and notifies the operator rather than looping.

## Notifications

### Notification Tier
The three-grade contract classifying every push type by interrupt weight: Code (time-boxed decisions such as computer approvals — always breaks through), Page (blocked work or agent-needs-input — batched within minutes), Chart (completions and activity — silent badge or digest, never interruptive). Tier is carried in the push payload and governs delivery behavior; it is a server-side contract, not a user-facing setting.

## Delivery Loop

### Handoff Baton
The structured note that transfers an issue between phases of the delivery loop. A baton states the phase goal, what the previous phase completed, where to start, the inputs, and open risks — enough for a fresh worker with no prior context to continue the work. Each phase ends by posting the baton for the next phase; an issue entering a phase without one gets a baton synthesized by the dispatcher.

### Dogfood Verification
The verification pass that judges a shipped change by exercising the deployed product surface the way a real operator would, grading every claim against authoritative evidence — store-level state and provenance, not UI appearance or the agent's own replies. A pass produces a merged dogfood report with a PASS/FAIL verdict against the phase's verification contract. The verifier is a judge, not a mechanic: it records findings and evidence but does not fix the product.

### Paper Cut
A defect or friction observed during Dogfood Verification that does not violate the verification contract, so it is recorded rather than failing the verdict. Paper cuts are listed in the dogfood report and carried into the next planning pass, where they are re-ranked on their own merits — a paper cut that misleads users (such as a fabricated write confirmation) can outrank cosmetic or capability gaps.
