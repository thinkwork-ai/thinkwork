# Structured Playbooks for Business Problem Solving — Requirements

**Date:** 2026-04-21
**Status:** Requirements (ready for planning) — revised after document-review pass 1
**Author:** Eric (eric@homecareintel.com)

## Summary

Introduce a first-class **Playbook** primitive in ThinkWork that lets a Strands agent execute a multi-phase, parallel-capable, long-running workflow against a concrete business problem — kicked off from chat, a recurring schedule, or an admin catalog — and deliver a packaged artifact (chat message, email) to the requesting user.

Playbooks generalize the compound-engineering "structured phases + document handoffs" pattern to non-engineering domains. V1 ships as code-authored definitions in the OSS monorepo plus a small seed library, with per-tenant enable/configure controls surfaced in the existing admin app. Tenant-facing authoring UIs are explicit phase-2 premium work.

**Positioning bet.** Playbooks are a deliberate commitment to explicit, versioned, code-authored workflows over emergent agent behavior — trading upfront authoring for predictability, auditability, and diff-able prompt iteration. This bet shapes what v1 should optimize for: correctness and observability of a defined workflow, not flexibility in an undefined one.

## Problem

Today, Strands agents in ThinkWork are single-turn ReAct loops. Skills drive multi-step behavior implicitly (prompt instructions plus tool sequencing), but the agent has no durable notion of "phase," "parallel fan-out," "artifact handoff," or "packaged deliverable." Consequences:

- Complex, repeatable business tasks (sales-meeting prep, account-health reviews, QBR prep) can't be expressed as a shareable, versionable unit. They live in prompts or in an operator's head.
- No primitive for scheduled, async execution that produces a packaged deliverable without a live user thread.
- No way to parallelize independent data pulls (CRM, AR, tickets, web) inside a single conceptual task.
- Admins can enable skills and edit system prompts, but can't compose a repeatable business workflow that end users can invoke by name or intent.

### Why not extend skills?

The above gaps could plausibly be addressed by growing the existing skills framework rather than introducing a peer primitive. Playbook is a separate primitive because it needs properties skills can't acquire without becoming playbooks in disguise:

- **Durable multi-phase state across invocations.** Skills are a single tool call in a single agent turn. Playbook runs span minutes, multiple LLM calls, and multiple sub-invocations; they need a run record that outlives any one Lambda invocation.
- **Triggers that fire without a live thread.** A scheduled or admin-catalog invocation has no chat turn to piggyback on. Skills are always called from inside an agent turn.
- **A deliverable contract.** Playbooks produce a packaged output (typed, rendered, routed). Skills produce tool-call outputs consumed by the agent's next turn.
- **Catalog discoverability + versioning.** A playbook is an addressable, versioned product unit that admins enable per-agent. Skills are a lower-level primitive that playbooks compose.

Playbooks call skills. The boundary is: if the unit produces a deliverable and is directly invokable by a user or schedule, it's a playbook; if it's a primitive used inside a workflow, it's a skill.

## Who this is for

- **End users (sales reps, account owners, ops leads):** invoke a playbook by chat intent, receive a packaged deliverable, optionally see the run's progress.
- **Admins (tenant-side):** enable/disable which playbooks are available to their agents, set per-tenant configuration overrides (default email recipient, output destinations, tool credentials), observe runs.
- **Playbook authors (ThinkWork team + OSS contributors):** author new playbooks as code in the monorepo, with phases, prompts, and templates stored as diff-able files.
- **Future premium customers:** author playbooks via a hosted editor UI (explicit phase-2).

## Goals

1. End-to-end execution of the **anchor playbook** (sales-meeting prep) from chat intent, a cron/rate-scheduled trigger, and an admin catalog pick — all hitting the same execution engine.
2. A concrete, versioned playbook file format stored in `packages/playbooks/<id>/` that supports:
   - Typed inputs with default resolvers and an `on_missing_input` policy
   - Sequential phases
   - A single level of parallel fan-out per phase, with per-branch `critical` flag
   - Named phase artifacts passed to later phases
   - Multiple output destinations
   - Chat-intent examples and cron/rate schedule triggers
   - An explicit `tenant_overridable:` allowlist naming which fields a tenant admin may override
3. A playbook runtime in the existing AgentCore Strands container that persists phase artifacts durably, supports `continue-with-footer` on non-critical branch failure and hard-fail on critical-branch failure, and exposes live progress on demand.
4. Per-tenant enable/disable + configuration overrides in the existing admin app (piggyback on the agent skills/capabilities surface; no new editor), bounded by each playbook's `tenant_overridable:` allowlist.
5. Output delivery to `chat` and `email` in v1. Each destination is first-class and separately implemented — no pluggability abstraction for destinations that don't exist yet.
6. A seed library of **3 playbooks** (sales-meeting prep confirmed; 2 additional to be picked during planning from the candidates below) that doubles as demo, documentation-by-example, and test coverage, and exercises enough different integrations to surface missing DSL primitives.
7. A defined security posture: `actor` resolved server-side from the authenticated session, tenant-scoped run-detail URLs, path-component sanitization for any templated output paths, and a PII retention ceiling.

## Non-goals (v1)

- No hosted, form-based, or visual playbook **authoring** UI. Deferred to premium phase-2.
- No tenant-authored playbooks without code. Hosted-tier tenants hire us to author, OSS operators fork the repo. A tenant-private playbook directory is named as a phase-2 escape hatch if this pressure proves acute (see Risks).
- No loops, conditionals, or nested fan-out in the DSL. One level of parallel per phase; linear progression otherwise. Artifact naming is designed to accommodate future playbook-as-phase-call without schema migration.
- No playbooks calling other playbooks. A playbook can call skills (including agent-mode skills), but composition is flat.
- **No `wiki` output destination in v1.** The wiki surface is today a read-only compile-from-journal derivative with no page-write mutation. Deferred to phase-2 pending a wiki-write path.
- **No calendar-event-driven schedule triggers in v1.** No calendar integration exists in the codebase. V1 schedules use `rate` or `cron` only. Calendar-driven triggers deferred to phase-2.
- No additional output destinations (Slack DM, PDF, CRM attachment) — they are phase-2.
- No replacement of the existing `scheduledJobs` infrastructure. Playbook schedule triggers are a new job kind that reuses it.
- No cross-tenant or cross-agent playbook execution. A playbook run has a single tenant + invoking user + agent.

## Anchor use case: sales meeting prep

**User story.** A sales rep says in chat: *"Prep me for the ABC Fuels meeting Thursday."* Within a few minutes, they receive (in the thread and in email) a structured brief covering order trends, open AR, recent support incidents, external signals (news, competitor moves, LinkedIn changes), and prior-meeting context — plus suggested talking points and open questions the customer might ask. Optionally, the same brief is auto-generated on a weekday morning cron for named high-priority accounts.

### Strawman playbook definition (DSL shape)

```yaml
# packages/playbooks/prep-for-meeting/playbook.yaml
id: prep-for-meeting
version: 1
name: "Prep for Meeting"
description: "Gather account context, financials, activity, and external signals for a sales meeting."

triggers:
  chat_intent:
    examples:
      - "prep me for {customer} meeting"
      - "get me ready for my {customer} call {date}"
      - "brief me on {customer}"
    disambiguation: ask   # ask | highest_confidence | refuse
  schedule:
    type: cron            # cron | rate — calendar_event is phase-2
    expression: "0 14 ? * MON-FRI *"  # 8am CT weekdays, example
    bindings:
      customer: from_tenant_config   # named high-priority accounts per tenant
      meeting_date: today_plus_1

inputs:
  customer:
    type: string
    required: true
    resolver: resolve_customer   # named tool; returns one customer or a disambiguation list
    on_missing_input: ask        # ask | default | fail
  meeting_date:
    type: date
    required: true
    on_missing_input: ask
  focus:
    type: enum
    values: [financial, expansion, risks, general]
    default: general

outputs:
  destinations:
    - chat
    - email                     # defaults to the invoking user; tenant may override via allowlist

tenant_overridable:
  - outputs.destinations.email.recipient
  - budget_cap
  - triggers.schedule.expression
  - inputs.focus.default

budget_cap:
  tokens: 200000   # per-run ceiling; tenant override allowed within max 1M

phases:
  - id: frame
    mode: sequential
    prompt_file: phases/frame.md

  - id: gather
    mode: parallel
    branches:
      - { id: account_brief, skill: crm_account_summary,       critical: true }
      - { id: financials,    skill: ar_summary,                critical: false }
      - { id: activity,      skill: support_incidents_summary, critical: false }
      - { id: external,      skill: web_research,              critical: false, prompt_file: phases/external.md }
      - { id: prior_touch,   skill: wiki_search,               critical: false }
    on_branch_failure: continue_with_footer

  - id: synthesize
    mode: sequential
    reads: [frame, gather.*]
    prompt_file: phases/synthesize.md

  - id: package
    mode: sequential
    reads: [synthesize]
    deliverable_template: phases/brief.md.tmpl
```

Adjacent files in the same directory hold the per-phase prompts and the deliverable template. Keeping YAML structural and markdown textual makes prompt iteration a prompt-file diff and admin-side review easier.

**Critical-branch semantics.** A branch with `critical: true` failing causes the run to move to `failed` status and skip the synthesize and package phases. The deliverable is replaced with a short failure notice delivered to `chat` only (not written to `email`). A branch with `critical: false` failing produces a footer note and the run continues. A run with every critical branch succeeding but some non-critical branches failing completes normally with footers noting the gaps.

**Tenant-overridable allowlist.** The admin auto-generated form renders only fields named in `tenant_overridable:`. Any attempt (via GraphQL or otherwise) to override a field not in the allowlist is rejected at mutation time. Output path templates are not tenant-overridable (the fields inside them can be referenced, but the structure is locked).

## Invocation paths

All three paths converge on a single `startPlaybookRun(playbookId, inputs)` GraphQL mutation. `actor` is resolved server-side from the authenticated Cognito session on the API side and is never caller-supplied — preventing impersonation via `startPlaybookRun`. The three surfaces share one execution engine.

### A — Chat intent (marquee)

1. Rep types a natural-language request in their agent thread.
2. The agent (via a playbook dispatcher skill loaded per-agent based on enabled playbooks) matches the message against every enabled playbook's `triggers.chat_intent.examples`. When multiple playbooks match, the dispatcher's `disambiguation:` setting controls behavior:
   - `ask` (default) — agent lists the candidate playbooks with a short description each and asks the user to pick
   - `highest_confidence` — agent picks the highest-scoring match and names it in the acknowledgement ("running *Prep for Meeting* — if you meant something else, reply 'cancel'")
   - `refuse` — agent refuses and asks the user to be more specific
3. Each extracted input is resolved. For `resolver: resolve_customer`:
   - **One match** — agent proceeds and names the resolved entity in the acknowledgement ("running prep for *ABC Fuels Inc.*")
   - **Multiple matches** — agent posts an inline selectable list ("I found 3 customers matching 'ABC': ABC Fuels Inc., ABC Logistics, ABC Holdings — which one?") and waits
   - **Zero matches** — controlled by the input's `on_missing_input:` setting (`ask` asks for clarification; `default` uses the default if any; `fail` aborts with an explanatory chat message)
4. Agent posts one acknowledgement message in the thread once inputs are resolved. Content is specified: **(a)** one-line restatement of what's being run and for whom ("Running *Prep for Meeting* for **ABC Fuels Inc.** — meeting Thu 2026-04-23"), **(b)** expected duration as a static per-playbook default (e.g., "~3 minutes"), **(c)** a link with text *"View progress →"* pointing to the run-detail view, and **(d)** where the deliverable will land ("I'll post the brief here and email you a copy"). The run proceeds asynchronously via a detached execution path (see Execution model).
5. Idempotency: a second chat-intent dispatch for the same playbook + inputs from the same user within 60s is deduplicated to the in-flight run rather than starting a second one.
6. On completion, the runtime posts the deliverable into the thread (summary card + "Full brief →" link to run-detail view; not the entire body inline) and fires the other configured destinations.

### B — Scheduled (marquee)

1. Admin creates a scheduled playbook run from the admin app's catalog page: picks a playbook, fills inputs/bindings, sets a cron or rate expression. The admin app writes a `playbook_run` row to `scheduledJobs`. Playbook YAML `triggers.schedule` is an author-suggested default that an admin can accept, override, or skip — the YAML does not self-register into `scheduledJobs`. (Auto-registration is explicitly out of scope for v1.)
2. `job-trigger` gains a new branch for `job_kind: playbook_run`. When fired, it reads the playbook id + input-binding rules from the job payload, resolves inputs server-side (from bindings like `from_tenant_config` or `today_plus_1`), and calls `startPlaybookRun`. The dispatcher enforces that the playbook is still enabled for the tenant; if it isn't, the run is marked `skipped_disabled` and no deliverable is fired.
3. Deliverables route to the playbook's configured destinations. Without a chat thread, `chat` is dropped silently and `email` remains. The invoking user for retention and authz purposes is the admin who created the schedule (captured on the `scheduledJobs` row at registration time).
4. If the original schedule-creator is deprovisioned, the schedule is auto-paused on next fire rather than running under a stale identity.

### C — Admin catalog (fallback, discovery)

1. Admin app grows a "Playbooks" catalog page showing enabled playbooks for the current agent/tenant. Empty state: "No playbooks enabled for this agent — see *Playbooks → Enable* to add one."
2. User picks one, fills a form auto-generated from the playbook's `inputs` schema (validation inline; submit disabled until required fields are filled), and hits **Run**.
3. UI calls the same `startPlaybookRun` GraphQL mutation and redirects to the run-detail view, which renders the "queued" state until the first phase artifact arrives.

## Execution & visibility model

- **Engine location.** New Python module inside `packages/agentcore-strands/agent-container/` that wraps the Strands runtime. Planning must resolve whether the engine runs in-process within the existing AgentCore Lambda (900s cap, threading for parallel fan-out) or as a separate orchestration Lambda invoked per-phase; the latency target below gates that choice.
- **Async kickoff from chat.** The chat-intent path cannot complete end-to-end within the `chat-agent-invoke` 300s timeout at the 3-minute target. The dispatcher skill posts the acknowledgement message, persists a `playbook_runs` row in `queued` status, and triggers execution via an async path (new SQS queue → dedicated playbook-worker Lambda is the baseline; planning may pick Step Functions if state-machine primitives earn their keep). The chat Lambda returns immediately after the ack. Completion posts a new assistant message via the existing thread/message APIs.
- **State model.** Two new tables: `playbook_runs` (run metadata, status, invoking actor, input values, budget config, started_at, completed_at) and `playbook_phase_artifacts` (run_id, phase_id, branch_id?, content pointer, source citations, started_at, finished_at, status). Artifact bodies >64KB land in S3 with a pointer; smaller bodies inline. Storage choice is load-bearing for the run-detail UI streaming pattern; planning must pick before the UI is built.
- **Relationship to existing routines + threadTurns.** Planning must decide whether playbook runs dual-write `threadTurns` rows (for chat-invoked runs) for observability parity with existing agent turns, or stand fully alone. Default recommendation: chat-invoked runs write a single summary `threadTurns` row referencing the `playbook_runs.id`, while scheduled/catalog-invoked runs do not.
- **Durability & retention.** Phase artifacts are durable and linkable. Retention default: **30 days tenant-configurable**, with a hard ceiling of **180 days**. Indefinite retention is no longer an option — deliverables sent via email persist only in the recipient's mailbox and in the `playbook_runs` table up to the ceiling. A tenant-facing `deleteRun(runId)` mutation supports data-subject deletion requests; deletion purges `playbook_runs` + `playbook_phase_artifacts` + any S3 bodies. Error messages in footers are sanitized (status code + short reason; no internal hostnames, no stack traces).
- **Failure semantics.** Defaults: `on_branch_failure: continue_with_footer` for non-critical branches; any `critical: true` branch failure flips the run to `failed` status, skips synthesize + package phases, and delivers a short failure notice (chat only, not email). `on_branch_failure` values remain `continue_with_footer` (default) or `fail` (abort). Transient tool errors (timeouts, 5xx, Bedrock throttles) get up to 2 retries with exponential backoff *inside the branch* before a branch is considered failed — this is per-tool-call, not per-run, and does not count against the "no mid-run retries" rule at the run level.
- **Cost guardrails.** Per-run budget cap (`budget_cap.tokens`) read from playbook config with tenant-level override bounded to a hard ceiling of 1M tokens. Exceeding the cap aborts the run with `cost_bounded_error` status; the rep gets a chat message explaining the abort; no deliverable is written to email; any phase artifacts already produced remain visible in the run-detail view but are flagged `partial`. Re-runs consume a fresh budget; admins can see aggregate tenant spend on the runs page and rate-limit accordingly.
- **Concurrency / config-at-start.** A run binds its tenant config (destinations, recipients, enabled state, tool credentials) at the moment `startPlaybookRun` is called. Mid-run admin changes (disable playbook, rotate credentials, change email recipient) do not affect in-flight runs — only subsequent ones. This is deliberately simpler than read-through and avoids mid-run race conditions.

### Progress UX (end user)

Silent in chat by default, with optional drill-in. Specifically:

- Agent posts exactly two chat messages per run: an **acknowledgement** at kickoff (content specified in Invocation path A, step 4) and a **completion** message with the deliverable summary + link. No per-phase chatter in the thread.
- The **run-detail view** lives at `/_tenant/playbook-runs/{runId}` and renders these states explicitly:
  - *Queued* — before the first phase starts (visible only in the admin-catalog flow)
  - *Running* — phases listed with per-phase status badges (`pending`, `running`, `succeeded`, `footered`, `critical_failed`); parallel-phase branches are nested underneath the parent phase
  - *Complete* — deliverable rendered at the top, phase artifacts below
  - *Failed (critical)* — the failure notice rendered at the top with the specific critical branch named
  - *Aborted (cost)* — partial artifacts visible, reason displayed
  - *Empty state* — no runs yet: "Kick off a playbook from chat or the catalog to see run history here."
- Live updates via **polling at 5-second intervals** while the view is open and the run is not in a terminal state. No websocket/SSE in v1. Artifact drill-in is a modal that loads the full body on demand (S3 fetch if off-inline).
- **Access control:** run-detail URLs are tenant-scoped (standard session auth, not signed-token). A user can only see runs they invoked or runs on agents where they have admin role. Mobile deep-links open the admin web route inside an in-app browser in v1 — no native run-detail screen.
- **Accessibility:** phase status changes announce via `aria-live="polite"` region; empty states and loading states meet WCAG AA keyboard-focus requirements.

This preserves the consultant-mode "fire and forget" feel, keeps the chat clean, and still gives curious users and on-call admins a defined surface to inspect what happened.

## Output destinations

V1 ships exactly two destinations, both first-class with direct implementations — no pluggability abstraction for destinations that don't exist yet:

```
destinations:
  - chat     # post into the invoking thread; dropped silently for scheduled runs with no thread
  - email    # defaults to the invoking user; tenant may override recipient via the allowlist
```

- **Chat delivery.** Summary card (one-paragraph brief + top 3 risks + top 3 talking points) plus a "Full brief →" link to the run-detail view. The full brief is not inlined in chat.
- **Email delivery.** Full rendered brief as HTML email. Sender is the agent's configured email address (existing infra). Requires a new outbound-send mode on the email primitive — the current `agent-email-send` skill is reply-bound (requires `INBOUND_MESSAGE_ID` etc.) and is not directly reusable. Planning must specify whether this is a new skill or a mode flag on the existing one.
- **Recipient override.** Tenant admin can set a different recipient per playbook, but only within a tenant-admin-configured domain allowlist (e.g., `@homecareintel.com`). Arbitrary external addresses are rejected.
- **Delivery failure** (SES bounce, hard-fail email) is logged to the run record but does not retry the entire run.
- Destinations are configurable per-tenant (disable `email` but keep `chat`, for instance), bounded by the playbook's `tenant_overridable:` allowlist.
- The runtime owns delivery; phase code stays focused on generating content, not shipping it.

## Admin surface (v1)

Reuses the existing admin app's agent/skills screens. No new editor. Specifically:

- **New page** `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.playbooks.tsx` — lists playbooks available in the codebase, toggles per-agent enablement, shows per-playbook config form auto-generated *strictly from* the YAML `tenant_overridable:` allowlist. Fields not in the allowlist are read-only / display-only. Any GraphQL mutation attempting to override a non-allowlisted field is rejected server-side.
- **Scheduled runs** — within the playbook config page, admins can add/remove/pause scheduled runs (cron or rate expression) for this agent. Each schedule row stores the admin's identity for authz on fire.
- **Run history** `apps/admin/src/routes/_authed/_tenant/playbook-runs/` — paginated list (50/page, newest first) with filters for agent, playbook, status, date range. Columns: started_at, playbook, agent, invoked_by, status badge, duration, actions (drill-in, re-run, delete). Drill-in to the run-detail view with live phase status and persisted artifacts.
- **Role-based visibility.** End users see only their own runs on agents they use. Tenant admins see all runs on all agents in their tenant. Cross-tenant access is blocked at the resolver.
- **No authoring UI.** Adding a new playbook requires a repo PR. This is by design; the editor is phase-2 premium.

## Security posture (v1)

Called out explicitly because the review surfaced this as a cluster of P1 gaps. Each bullet below is a v1 requirement, not an aspiration:

- **`actor` is server-resolved.** The `startPlaybookRun` mutation's caller identity is resolved from the authenticated Cognito session on the API side. It is never caller-supplied. For scheduled runs, the `job-trigger` Lambda reads the admin identity from the `scheduledJobs` row (captured at registration). Any run where the stored identity cannot be resolved to an active Cognito user is aborted with `invoker_deprovisioned` status.
- **Tenant-scoped run URLs.** Run-detail URLs are session-gated, not signed-token. Visibility is enforced at the resolver; direct URL access without a valid session redirects to login, and post-login an unauthorized user gets a 404.
- **Email recipient domain allowlist.** Tenant-admin configurable; the override form rejects recipients outside the allowlist. The default when an allowlist is not configured is "invoking user's email only" (no override).
- **Input sanitization.** The agent's intent-extraction output for entity inputs (customer names, dates, enums) is passed through a schema-validating resolver before being inserted into any downstream prompt or tool call. The resolved entity ID is what gets passed to skills, not the raw free-text. This defends against prompt injection via the user's chat message: an attacker cannot make `resolve_customer` return a customer record they shouldn't see; an attacker also cannot cause `synthesize` to see a prompt-injection payload inside a "customer name" field because downstream phases read the resolved record, not the raw string.
- **Path component sanitization.** Any templated output path fields (reserved for phase-2 destinations like wiki) must strip `/`, `..`, null bytes, and any path-separator characters from interpolated variables at render time. v1 does not use path templating in destinations, but the sanitization helper is implemented and unit-tested from day one to prevent regression when wiki lands.
- **Per-tenant tool credentials.** Stored in AWS Secrets Manager, referenced by a tenant-scoped key pattern (`/thinkwork/tenants/{tenantId}/tools/{tool}`). The playbook-worker Lambda's IAM role scopes read access to its own tenant's path prefix at invocation time (via assumed role with session tags), not a blanket read. Rotation is an admin operation on a separate path; secret values never appear in playbook YAML.
- **OSS monorepo hygiene.** Playbook YAML in the repo never references tenant-specific values — tenant config is exclusively in per-tenant admin config, not in the diff-able YAML. A CI check rejects PRs that introduce tenant-specific strings (hostnames, emails, slugs) in `packages/playbooks/`.

## Seed library for v1

V1 ships **3 playbooks**. Sales-meeting prep is confirmed. The other two are picked during planning from:

- **Account-health review** — monthly or ad-hoc summary of a customer account (usage, AR, support load, sentiment) delivered to the account owner.
- **Renewal-prep** — fires N days before contract renewal, produces a risk/opportunity brief.
- **QBR-prep** — quarterly business review deck outline for a named customer.

Recommended pick: **account-health review** (shares most integrations with prep-for-meeting, so the incremental cost is small and the reuse pressure surfaces DSL gaps) + **one of renewal-prep / QBR-prep** (different cadence shape, different deliverable). Planning confirms.

Rationale for the small seed list: each playbook we ship forces us to exercise a real set of integrations and surfaces missing DSL primitives; we want that pressure, but not so much that v1 becomes a content project. Three is also the minimum that actually tests the "any primitive that only one needs is a smell" risk mitigation.

## Success criteria

1. **Authoring velocity.** A ThinkWork engineer can ship a new playbook end-to-end in under a day by copying an existing directory and editing YAML + prompt files, *given that the referenced skills already exist*. (If net-new skill work is required, that time is additional and tracked separately.)
2. **Anchor latency.** The anchor sales-prep playbook completes end-to-end for a real customer in under 5 minutes median (p95 under 8 minutes), with graceful degradation if one non-critical data source is unavailable.
3. **Single execution engine.** Invocation paths A, B, and C route to the same runtime and leave identical `playbook_runs` + `playbook_phase_artifacts` row shape.
4. **Admin config via allowlist.** An admin can enable/disable a playbook, override its email recipient (within the domain allowlist), and set a cron/rate schedule without editing code. Attempts to override non-allowlisted fields are rejected at the resolver.
5. **Graceful partial failure.** A run in which a non-critical branch fails still delivers a useful brief with a clear, sanitized footer identifying the gap. A run in which a critical branch fails does not write to email and surfaces a failure notice in chat.
6. **Adoption outcome.** Within 2 weeks of launch at the first design-partner tenant, at least 3 distinct end users each invoke the anchor playbook at least once, and ≥60% of post-run feedback signals (thumbs-up equivalent on the chat deliverable, or lack of reported issues on the runs page) are positive. If we can't get to this bar, the product isn't working even if the mechanical criteria pass.

## Dependencies (existing infra this leans on)

- **Strands runtime** (`packages/agentcore-strands/agent-container/`) — the engine is new, but it runs in the same container and reuses model invocation, MCP wiring, and tool injection.
- **Skills framework** — parallel branches reference skills. The anchor references `crm_account_summary`, `ar_summary`, `support_incidents_summary`, `web_research`, `wiki_search`. **Three of these do not exist today** (`crm_account_summary`, `ar_summary`, `support_incidents_summary`) and each requires a corresponding data-connector (CRM, AR/accounting, ticketing). Their scope and owner must be established in planning; they are not free side-effects of the playbook runtime.
- **`scheduledJobs` + `job-schedule-manager` + `job-trigger`** — schedule-triggered playbooks register a new `playbook_run` job kind; `job-trigger` gains a new dispatch branch.
- **Admin app agent screens** — reused for enablement and config; new routes added for playbooks and runs.
- **Email primitive** — existing `agent-email-send` skill is reply-bound. A detached outbound-send mode (or a new skill) is required for playbook delivery.
- **Async execution path** — new SQS queue + playbook-worker Lambda (baseline) or Step Functions (planning may justify) to run the multi-minute playbook outside the `chat-agent-invoke` 300s window.
- **AWS Secrets Manager** — for per-tenant tool credentials, with IAM role scoping by session tag.
- **GraphQL API** — new `startPlaybookRun`, `playbookRuns`, `playbook`, and `deleteRun` queries/mutations in `packages/api/src/graphql/resolvers/`.

## Open questions (for planning to resolve)

- **Resolver implementation shape.** Is `resolver: resolve_customer` a named tool call, a named skill, or a lambda-per-input-type? The UX behaviors around it are specified (one/multiple/zero matches) but the implementation primitive is open. Planning picks one and ships `resolve_customer` as the reference.
- **Intent dispatcher mechanism.** Single per-agent dispatcher skill that loads all enabled playbooks' intents, vs. each enabled playbook registering as its own tool on the agent. Planning picks one; the disambiguation UX is already specified in Invocation path A regardless of choice.
- **Artifact storage inline-size threshold.** Specified as 64KB above; planning validates with measured artifact sizes from the seed playbooks and adjusts.
- **Engine hosting.** In-process within AgentCore Lambda (threading for fan-out), separate playbook-worker Lambdas (Lambda-per-branch), or Step Functions. Decided by measured latency against the 5-minute median target.
- **ThreadTurns dual-write.** Confirmed as recommendation above (chat-invoked runs dual-write a summary row; scheduled/catalog runs do not). Planning verifies this doesn't break existing thread rendering.
- **Two additional seed playbooks.** Planning confirms which 2 of the 3 candidates ship.

## Risks

- **DSL over-generalization.** Authoring one seed playbook in isolation risks baking in our assumptions. Mitigation: ship 3 seed playbooks from day one (tightened from 2–4 to match this mitigation); any primitive that only one needs is a smell.
- **Silent-by-default UX at 3–5 min.** A silent acknowledgement followed by a 3–5 minute wait sits in an uncanny valley — long enough for reps to context-switch and miss the completion, short enough that a progress-less wait feels broken. Mitigation: the run-detail view link in the acknowledgement is a first-class CTA, not a footer. Planning should instrument mid-run re-prompt rate ("where's my brief?") as an early signal; if it's high, we add an optional per-playbook `chatter_level:` flag (silent | brief | verbose) in a fast follow.
- **Execution cost.** Fan-out over many LLM calls + tool calls per run can be expensive at scale, especially on scheduled mode (calendars don't self-rate-limit even though reps do). Mitigation: per-run budget cap with tenant ceiling; aggregate spend visible on the admin runs page; jitter the `scheduledJobs` fire times (requires extending `job-schedule-manager` which does not currently jitter).
- **Observability gap.** Durable artifacts + a runs page is net-new surface. Mitigation: the runs-detail view is v1 scope (not fast-follow) with states explicitly enumerated above.
- **Tenant authoring pressure.** Hosted-tier tenants will ask for the editor UI immediately once they see the seed library, and "fork the repo" is not a credible answer for them. Mitigation: publish a phase-2 timeline commitment for the editor at v1 GA (target window stated up front); if that's not possible, ship a tenant-private playbook directory (S3-per-tenant, YAML-only) as a pre-editor escape hatch.
- **Connector skill substrate.** Three of the five anchor branches depend on skills that don't exist and require new CRM, AR, and ticketing connectors. Mitigation: planning scopes the connector work explicitly as a prerequisite track, not as a side-effect of playbook work; the anchor's v1 success criterion is lowered from "all 5 branches hit real systems" to "at least 3 of 5 do" if connector timelines slip.
- **Overlap with `routines`.** ThinkWork already has a `routines` primitive for repeatable workflows. Planning must explicitly call out whether routines are deprecated, coexist, or become a thin wrapper over playbooks — two "repeatable workflow" concepts in admin is a maintenance cost the product shouldn't carry long-term.

## Phase-2 work (explicit, deferred)

- Hosted authoring UI (form editor, premium tier).
- Visual DAG builder.
- Loops, conditionals, and playbook composition.
- **Wiki output destination** — requires a new wiki page-write path; revisit once that path exists.
- **Calendar-event schedule triggers** — requires a calendar integration (Google Workspace + Microsoft 365) that doesn't exist today.
- Additional output destinations (Slack DM, PDF, CRM attachment) — introduce pluggability abstraction only when the second non-chat-non-email destination actually lands.
- Tenant-private playbook libraries loaded from S3 per tenant (pre-editor escape hatch).
- Cross-playbook artifact reuse ("use last week's account brief if <7 days old").
- Guided (synchronous) execution mode — same playbook, but the agent walks the user through each phase conversationally.
- Routines consolidation / deprecation.
