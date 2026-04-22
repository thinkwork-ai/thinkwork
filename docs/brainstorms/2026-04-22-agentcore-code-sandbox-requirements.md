---
date: 2026-04-22
topic: agentcore-code-sandbox
status: brainstormed — supersedes 2026-04-22-agentcore-code-sandbox-admin-skill-seed.md
---

# AgentCore Code Sandbox — v1 Requirements

## Problem Frame

ThinkWork today exposes capability to agents exclusively through a **typed-tool substrate** — every capability is a Python skill or MCP tool declared up-front with a JSON schema. That substrate is reliable and auditable, and it should remain the primary surface for high-frequency, stable workflows.

What it can't do is run arbitrary code at agent reasoning time. The capability gap shows up in four concrete shapes we expect to hit repeatedly:

- **Custom scripts mid-tool-call.** An agent in the middle of solving a step realizes it needs arbitrary Python — data shape coercion, a quick regex, a one-off transform — that doesn't deserve its own typed tool and doesn't belong in a template.
- **CLI-as-skill with small blast radius.** A new community CLI (`gh`, `stripe`, `linear`, `kubectl`, `aws`) should be usable by agents without a PR-cycle hand-written Python wrapper per subcommand. The sandbox is the dynamic-integration substrate; per-tenant IAM + network posture bound the blast radius.
- **Ad-hoc data transformations.** Pull data from ThinkWork / external APIs, reshape, summarize, chart, email. Each transform is single-shot; none earn a typed skill of their own.
- **Cross-CLI composition.** Stitch output of one CLI into input of another (`gh` → `linear` → Slack digest) with arbitrary logic between — no single typed skill covers the pattern.

This is a **strategic bet**, not a tenant-complaint response: we haven't had a customer hit an explicit wall yet, but every modern agent harness treats code execution as a baseline capability, and scaling ThinkWork without it would make us the category outlier rather than the safer option. Reference substrates we're in line with:

- Anthropic **Managed Agents** — per-session Environments with container, managed credentials via Vaults, optional network allowlist, pre-declared package lists.
- LangChain **Deep Agents** — per-thread or per-assistant sandboxes via provider (E2B, Modal, Daytona, Runloop).
- OpenAI **Agents SDK** — `SandboxRunConfig` + `ShellTool` with configurable network policy, `domain_secrets`, snapshot/rehydrate session state.
- **Claude Code** (Anthropic CLI) — OS-level Seatbelt/bubblewrap sandboxing with path policies and proxy-based domain allowlist.

All four ship code execution as developer-opt-in with **zero admin-approval ceremony**. We match that opt-in shape; tenant-level availability is a single tenant-admin toggle (R3a), not per-use ceremony.

The AWS-native substrate is **Bedrock AgentCore Code Interpreter** — a Strands-integrated sandboxed Python interpreter, subprocess-capable, per-session isolation, pay-per-second compute. It is the right substrate; this document specs how we adopt it.

**Non-goals:**
- Not a replacement for typed skills on stable, high-frequency paths. Typed > code-exec for reliability, auditability, allowlist granularity.
- Not a path to execute our own Terraform. Infra stays human-driven.
- Not a PHI/PII data processor in v1.
- Not a replacement for MCP tool servers — those remain the right shape for remote HTTP-backed capability.

## Requirements

### Substrate — Sandbox Environments as a First-Class Resource

- **R1.** A new first-class resource, `sandbox_environment`, represents a *definition* (network posture `PUBLIC`/`SANDBOX`/`VPC`, pinned base image, pre-installed package list). Each `sandbox_environment` definition is instantiated as a **per-tenant Bedrock AgentCore Code Interpreter** resource at tenant-provisioning time (mechanism TBD — see R-Q4) — one Code Interpreter per (tenant, environment) pair. Each per-tenant interpreter has an IAM execution role scoped to that tenant's Secrets Manager paths only; no other tenant's secrets are reachable from its sandbox. Tenants can reference only their own interpreter instances.
- **R2.** v1 ships **two** environment definitions:
  - **`default-public`** — network mode `PUBLIC` (full internet outbound). For community-CLI workloads, external-API calls, `pip install` at runtime. Larger blast radius; accepts residual threats T1/T2.
  - **`internal-only`** — network mode `SANDBOX` (S3 + DNS + AWS service endpoints only; no internet). For internal-data workloads (pulling `skill_runs` from our GraphQL, transforming tenant data without external egress). Smaller blast radius; T1/T2 materially reduced because no outbound path to attacker-controlled hosts. This should be the default choice for templates that do not need public internet.

  Both definitions share the same blessed base image (R14). Each tenant that has sandbox enabled (R3a) gets one per-tenant Code Interpreter instantiated from each definition at tenant-provisioning time (mechanism TBD — see R-Q4) — 2 interpreters per tenant. AgentCore's service quota of 1,000 interpreters per account bounds scale; at `project_enterprise_onboarding_scale` (4 enterprises × 2 environments), we use 8 of that budget. Additional environment definitions (e.g., `vpc-gated` with Network Firewall domain allowlist) are explicitly followup work, introduced when a template needs one.
- **R3.** Templates declare sandbox use in their definition via a top-level `sandbox` field: `sandbox: { environment: "default-public", required_connections: ["google", "github"] }`. The `environment` field is required when `sandbox` is declared; it must name an environment scoped to the template's tenant. `required_connections` is a list of connection-type identifiers (see R11) and defaults to `[]` if omitted. A template declares at most one sandbox environment, and the skill dispatcher **enforces** that the runtime interpreter routed to is the template-declared environment — agent-supplied parameters cannot override the declared choice at call time. No admin-approval step on the per-user assignment. No tenant-admin gate on template declaration. This matches the developer-opt-in posture of every peer harness.
- **R3a.** Tenant-level availability gate: `tenants.sandbox_enabled` boolean, default `true`. Tenant admin flips it in tenant settings (admin UI affordance). When `false`, the skill dispatcher refuses to register the sandbox tool on any agent in that tenant regardless of template declarations; an agent's sandbox tool call returns `SandboxDisabled(tenant)`. This is a configuration-time gate, not per-use ceremony — admin owns the knob, no friction on individual template assignments. Supports regulated-tenant "no code-exec" needs without bringing back per-assignment approval.
- **R4.** Every environment runs on AgentCore's fixed per-session resource envelope: 2 vCPU, 8 GB RAM, 10 GB disk, Python 3.12. These are not tunable at our layer; they are AWS-fixed per-session caps.

### Session Model

- **R5.** One Code Interpreter session per **agent turn**. State (installed packages, filesystem, in-memory variables) persists across all sandbox tool calls within one turn. State is wiped at turn end. State never persists across turns in v1.
- **R6.** Session wall-clock cap: **5 minutes** in v1 (set via `sessionTimeoutSeconds`; AWS default is 15 min). Loosen per-environment later if real workloads need more. No warm pool in v1.
- **R7.** On session timeout, OOM, or other sandbox-side failure, the skill dispatcher returns a structured error (`SandboxTimeout`, `SandboxOOM`, `SandboxError`) to the agent as a tool result. The agent retries or abandons at its discretion. No automatic retry at the runner layer.
- **R8.** When stdout exceeds 256 KB or stderr exceeds 32 KB in a single `executeCode` call, the agent's tool result receives the truncated output with a `stdout_truncated: true` (or `stderr_truncated: true`) flag. The full untruncated streams persist to logs per R17; the agent never sees them silently swallowed, but it does not receive them in its reasoning context. (Truncation thresholds are tied to CloudWatch's 256 KB per-event limit; revisit if that limit changes.)

### Credentials and Auth

- **R9.** AgentCore does not support env-var injection at session start. v1 uses **Secrets Manager fetched from inside the sandbox** via a preamble the skill dispatcher injects into the first `executeCode` call. The preamble contains only Secrets Manager path strings — never token values. At runtime inside the sandbox, the preamble uses the per-tenant interpreter's IAM role (R1) to read per-invoking-user OAuth tokens from paths like `/thinkwork/<stage>/sandbox/<tenant_id>/<user_id>/oauth/<connection_type>` and exports them into the sandbox's process environment. Because the interpreter's IAM role is tenant-scoped, only the invoking tenant's paths are reachable regardless of what values the preamble contains — cross-tenant secret access is denied at the AWS layer, not the dispatcher.
- **R10.** Token scope: **invoking user's identity**. If agent `A` runs on behalf of user `U`, the sandbox has access to `U`'s OAuth connections only. Not tenant-wide service creds. Matches the principle of least privilege and the `feedback_user_opt_in_over_admin_config` stance.
- **R11.** A `connection_type` is a user-scoped OAuth connection the invoking user has established with an external service (e.g., `google`, `github`, `slack`). Template declares `required_connections` as a list of type identifiers. At invocation time, if the invoking user has not connected one of the required types, or any required connection's status is `expired` with refresh failure, the tool call fails cleanly with `MissingConnection(connection_type)` before Secrets Manager is ever read. No silent degradation.
- **R12.** Tokens exist only for the duration of one session. Secrets Manager values are refreshed per session via the existing `oauth-token.ts` refresh path (same plumbing that powers today's `GMAIL_ACCESS_TOKEN`). **Only access tokens are written to Secrets Manager** — refresh tokens are never deposited at sandbox-reachable paths, keeping T1's 1-hour exfil-window claim load-bearing. The dispatcher writes fresh access-token values to Secrets Manager at session start (after `oauth-token.ts` refresh); the preamble code sent to AgentCore contains only ARN path references — no token value ever appears in the `executeCode` request payload and therefore never reaches AgentCore APPLICATION_LOGS as a value. The token value is read by the sandbox at runtime using the per-tenant IAM role (R1) and exported to `os.environ` for the session's lifetime only.
- **R13.** **Invariant (honestly scoped):** no token value reaches a persisted log, dashboard, or any record via **Python-stdio-mediated writes** (`print`, `sys.stdout.write`, `sys.stderr.write`, the `logging` module) or via **known-shape patterns** caught by the CloudWatch backstop (Authorization headers, JWT triples, known OAuth prefixes like `gho_`, `xoxb-`, `ya29.`). This covers env-var names, stdout, stderr, executed code, outbound request payloads observed in APPLICATION_LOGS via stdio, and any dispatcher-side trace. The scrubbing mechanism is two layers: (1) primary value-based redaction installed in the base image's `sitecustomize.py` as a stdio write-wrapper keyed on the session-scoped set of token strings and their standard / URL-safe base64 / URL-encoded / hex forms, and (2) a CloudWatch subscription-filter backstop doing pattern-based redaction before S3 tier. **Named residual coverage gaps** (explicitly out of the invariant, tracked as the Stdout-bypass class alongside T1): bytes that bypass Python stdio — direct `os.write(fd, ...)`, `subprocess` children inheriting the parent's fds (`subprocess.run(['env'])`, reading `/proc/self/environ`), C extensions writing to fd 1, `multiprocessing` workers with fresh Python processes where the session token set hasn't been populated, and adversarial split-writes that fragment a token across more bytes than the rolling-buffer window. The plan's Unit 12 pattern backstop catches the subset whose values match known OAuth prefixes; everything else is v2 hardening territory (in-process credential proxy).

### Package Management

- **R14.** The `default-public` environment ships with a pinned **blessed package list** in the base image: pandas, numpy, requests, boto3, httpx, pyyaml, openpyxl, python-dateutil. These install once at image bake, not per session.
- **R15.** Runtime `pip install` is allowed — the agent can install a package it needs mid-turn. Package comes from public PyPI (network permits). This is a known unmitigated attack surface (T2); agents are responsible for package choice, and regulated tenants should run with `sandbox_enabled = false` (R3a) until the v2 hardening track (private PyPI mirror or allowlist) lands.
- **R16.** Bumping a blessed package is an explicit PR + image rebuild. Agents do not control base image contents.

### Observability and Audit

- **R17.** Every sandbox invocation produces a structured log record with: `tenant_id`, `user_id`, `agent_id`, `template_id`, `tool_call_id`, `session_id`, `environment_id`, timestamp, full executed code (secret-scrubbed per R13), stdout (256 KB cap), stderr (32 KB cap), exit status, duration, peak memory via AgentCore USAGE_LOGS join, and a list of outbound hosts observed in the APPLICATION_LOGS payload when discoverable.
- **R18.** Logs persist to CloudWatch Logs for 90 days and cold-tier to S3 for compliance retention. In v1, only platform-level (ThinkWork staff) operators can query sandbox logs; tenant-admin self-service query is deferred to a followup admin-UI workstream and is **not** available at v1 ship. When that UI lands, tenantId enforcement must be server-side (not a client-applied filter) or use per-tenant CloudWatch log groups as the structural alternative.
- **R19.** AgentCore native metrics — `Latency`, `Invocations`, `SystemErrors`, `UserErrors`, `CPUUsed-vCPUHours`, `MemoryUsed-GBHours` — are surfaced on the existing AgentCore runtime dashboard, per tenant and per environment.

### Cost and Enforcement

- **R20.** v1 cost posture is a **real circuit breaker** sized for "no baseline yet, tighten until we learn more." Caps:
  - Per-tenant-per-day: **500 sandbox invocations**, **50 minutes wall-clock**.
  - Per-agent-per-hour: **20 invocations** (catches intra-tenant runaway loops that stay under the tenant aggregate).

  Breach returns a structured `SandboxCapExceeded` tool-level error (including the breached dimension and the UTC-day / hour reset time) until the window rolls. At AgentCore pricing (~$0.016 per 2 vCPU × 4 GB × 5-min session), max per-tenant monthly exposure is ~$240 — small enough to notice, big enough for legitimate usage. **Explicitly revisit** once real usage data exists (target: first 30 days post-ship). Loosening is expected; this is not a permanent ceiling.
- **R21.** Per-template throttle is not in v1. Per-agent-per-hour (R20) covers the intra-tenant runaway-agent shape; per-template is revisited alongside R20 once baseline data exists.
- **R22.** Cost enforcement lives in the skill dispatcher (our layer), not in Code Interpreter. Invocation count + cumulative wall-clock are tracked per tenant per UTC day. Storage options (ordered by safety for concurrent-write correctness): (a) DynamoDB with `UpdateItem` + `ConditionExpression` — the default recommendation; (b) extending the existing `packages/database-pg/src/schema/cost-events.ts` table with a `sandbox_*` request type and `SELECT ... FOR UPDATE` counter pattern; (c) a new Postgres counter table with the same lock discipline. Whichever storage is picked must be atomic — a concurrent-read + increment pattern without a guard will let runaway loops bypass the cap at the 400+ agent scale.

### Failure and Supply-Chain Hygiene

- **R23.** AWS-side session crash, IAM failure, or network-stack failure manifests as `SandboxError` to the agent. No partial-state guarantees.
- **R24.** Base image is rebuilt reproducibly: pinned Python version, pinned blessed-lib versions, SHA-verified in the Dockerfile. Bumping any of these is an explicit PR. No moving targets.
- **R25.** AgentCore-side supply chain (the interpreter runtime itself) is an AWS responsibility; we treat it the same as Lambda's runtime.

### Post-v1 Operations (not v1 requirements)

- **Graduation policy (ops note, not a requirement):** The sandbox is the permanent answer for the long tail. When a specific CLI or API call pattern shows sustained usage that makes a typed wrapper worth building, that's a separate product decision — a new declarative-CLI-skill project, not a sandbox requirement. There is no threshold that binds the platform team; graduation happens when engineering capacity and product priority align. Sandbox access is never auto-revoked when a typed wrapper ships; template authors adopt the typed path when they prefer it.
- **Usage observation (ops note, not a requirement):** Sandbox invocation patterns (by CLI, by tenant, by template) are visible in the audit log (R17). Periodic review surfaces candidates for typed-wrapper investment; no automation, no threshold, no promise.

## Known Unmitigated Threats (v1)

v1 ships with a named set of residual risks. Each is accepted as a v1 scope tradeoff, with an explicit mitigation track for v2.

- **T1. Prompt-injection-driven token exfil.** An agent under prompt injection — typically via untrusted data the agent reads (a Gmail body, a GitHub issue, a Linear ticket, a web page, a `pip install`-ed package's import-time code) — can read `os.environ`, extract the invoking user's OAuth tokens, and POST them to an attacker-controlled host over the `PUBLIC` network. Per-tenant IAM scoping (R1) blocks cross-tenant access but does not block in-tenant exfil of the invoking user's own tokens. Value-based log redaction (R13 invariant) catches trivial `print(token)` patterns but does not prevent outbound exfil. This is the canonical threat against code-exec agents; every peer harness (Managed Agents, Deep Agents, OpenAI Agents, Claude Code) ships with the same residual exposure and names it rather than solves it in v1.
  - **v1 mitigation:** (a) regulated tenants default `tenants.sandbox_enabled = false` (R3a); (b) the cleartext/base64/url-encoded value-based scrubber covers post-mortem audit; (c) `oauth-token.ts` refresh issues short-TTL tokens so the exfil window is bounded (typically 1 hour). (d) the doc names this threat publicly so template authors and admins can make informed choices.
  - **v2 hardening track:** in-process credential proxy. Tokens stored in a dispatcher-mediated Python context (not `os.environ`); the proxy wraps `requests`/`urllib`/`subprocess` and attaches credentials only for declared-allowed destinations; agent code never holds a token string.
  - **Owner:** platform security (named at planning time).

- **T1b. Intra-tenant template-author exfil.** The sandbox's IAM path is tenant-wildcard (`/thinkwork/<stage>/sandbox/<tenant_id>/*`) — the tenant is the documented trust boundary, not the individual user. A malicious template author's code, once assigned to and run on behalf of another user in the same tenant, can read that user's tokens from `.../{other_user_id}/oauth/*`. Tenant-owned shared templates become a lateral-movement vector: one compromised template reads up to N users' tokens across the tenant. This is a new v1 residual surfaced by the plan (R-Q4b); it has no analog in single-user harnesses (Managed Agents, Claude Code) because they lack a multi-user-per-tenant abstraction to exploit.
  - **v1 mitigation:** (a) short-TTL tokens (typically 1 hour) bound the per-template exposure window; (b) the operator runbook flags "shared-template author review" as a compensating control — template authors are accountable the same way code authors are; (c) tenant remains the trust boundary as recorded in the per-tenant fan-out ADR; intra-tenant isolation is out of scope for v1 and named rather than silent.
  - **v2 hardening track:** per-user ABAC session tags on the tenant IAM role (STS with `iam:PrincipalTag/UserId`), **or** the same in-process credential proxy that addresses T1. The credential-proxy track addresses T1 and T1b simultaneously and is therefore the preferred direction.
  - **Owner:** platform security (named at planning time).

- **T2. Malicious `pip install` credential harvest.** A typosquatted or compromised PyPI package executes arbitrary code at install time (`setup.py`, `__init__.py`) within the same process that holds OAuth tokens. R14's pinned blessed base image + R24's SHA-verified build protect installs done at image bake time; runtime `pip install` (R15) has no comparable guard.
  - **v1 mitigation:** blessed base image covers common cases; R24 ensures the image itself is pinned.
  - **v2 hardening track:** private PyPI mirror or explicit package allowlist for runtime install; OR preamble-after-install ordering where credentials are injected only after a no-more-installs turn boundary.

- **T3. PHI/PII / regulated-data handling.** The sandbox is not certified as a HIPAA or SOC-2 data processor in v1. There is no technical control preventing an agent from forwarding regulated data into the sandbox; 90-day CloudWatch retention captures stdout without PHI-aware scrubbing.
  - **v1 mitigation:** regulated tenants default `tenants.sandbox_enabled = false`; template authors are responsible for not forwarding regulated data; the SOW names this as out of scope.
  - **v2 hardening track:** regulated-tenant-specific environment with per-log-group encryption, shorter retention, and documented data-residency guarantees.

## Success Criteria

- A template author can declare `sandbox: { environment: "default-public", required_connections: [google, github] }` and ship it without opening a ticket, obtaining admin approval, or modifying Terraform.
- An agent with this template declaration can, in a single turn: fetch a user's Gmail via `gogcli` (typed) OR via raw `curl` + token in the sandbox, pull the last 90 days of `skill_runs` from our GraphQL, join the two in pandas, produce a chart, upload the chart to S3, and post the S3 URL to Slack — end-to-end.
- An agent can `pip install linear-sdk`, use it to query Linear, and emit a structured result — without any ThinkWork code change.
- Every sandbox invocation across every tenant is queryable in CloudWatch by tenant / user / template within 90 days.
- Tenant A's invocations are never visible to Tenant B, enforced structurally by per-tenant Code Interpreter instances (R1) with tenant-scoped IAM execution roles + per-tenant Secrets Manager path scoping + APPLICATION_LOGS tenant tagging. Cross-tenant secret access is denied at the AWS layer, not the dispatcher.
- No token value appears in any ThinkWork-persisted log, dashboard, or audit record **within R13's scope** (Python-stdio-mediated writes + known-shape CloudWatch patterns) under normal operation, enforced structurally by per-tenant IAM scoping (R1) + path-only preamble (R9/R12) + two-layer redaction (primary base-image stdio wrapper + backstop pattern subscription filter). Stdio-bypass residuals (subprocess env dumps, `os.write` at fd level, C-extension direct writes, adversarial split-writes) are named alongside T1 as the Stdout-bypass class and tracked for v2 hardening (in-process credential proxy). Deliberate exfil by agent code under prompt injection is the named unmitigated threat T1 (plus T1b for intra-tenant template-author exfil).
- Peer parity check — the Problem Frame's 4 reference harnesses (Managed Agents, Deep Agents, OpenAI Agents, Claude Code) inform posture on opt-in shape, network default, session model, and credential handling; ThinkWork either matches or names the gap in T1/T2/T3 (residual threats) or in Scope Boundaries (intentional v1 scope). ThinkWork's multi-tenancy posture (per-tenant IAM-isolated interpreters) is stronger than peer norm; residual threats match peer norm and are explicitly named.

## Scope Boundaries

- **Out of scope: admin-approval ceremony per assignment.** Every peer ships sandbox as developer-opt-in; we match that. Templates self-declare sandbox use.
- **Out of scope: per-template network allowlists.** AgentCore Code Interpreter is all-or-nothing at the interpreter-creation layer. We model per-environment, not per-template. Per-template allowlists need VPC + Network Firewall — a followup environment, not v1.
- **Out of scope: additional `sandbox_environment` definitions beyond `default-public` and `internal-only`.** Introduced when a template needs them. `vpc-gated` (Network Firewall domain allowlist) is named for the backlog, not built now.
- **Out of scope: filesystem persistence across turns.** v1 wipes at turn end. Per-OpenAI's `session_state` / per-Managed-Agents assistant-scoped persistence are v2.
- **Out of scope: warm session pool across turns.** Same reasoning — per-turn wipe in v1.
- **Out of scope: tenant-scoped service credentials.** Invoking-user OAuth only. Tenant-level service-account injection (e.g., a tenant-wide GitHub App token) is a v2 decision if real demand surfaces.
- **Out of scope: runtime typosquat detection** on `pip install`. Agents install from public PyPI; the blessed base list covers the common cases. Supply-chain linting on the base image catches most attacks at bake; runtime detection is v2.
- **Out of scope: customer PHI/PII data processing.** Sandbox is not certified as a HIPAA/SOC-2 processor in v1 (threat T3). Regulated tenants default `tenants.sandbox_enabled = false` (R3a). Template authors are responsible for not forwarding regulated data into the sandbox. Re-evaluate when regulated tenants onboard.
- **Out of scope: a sandbox-specific admin UI.** Logs go to CloudWatch; admin UI surface (per-tenant invocation browser) is a followup tracked with the broader observability rebuild.
- **Out of scope: UI-driven `sandbox_environment` editor.** Environment definitions (base image, package list, network mode) are code-managed (Terraform + Dockerfile). Per-tenant interpreter instances are provisioned by the tenant-create path (R-Q4). Tenants don't upload custom base images.

## Key Decisions

- **Adopt AgentCore Code Interpreter via Strands as the sandbox substrate.** AWS-native, Strands-supported, pay-per-second pricing, fits the AWS-resident-over-SaaS preference. Evaluated against custom Lambda-based sandboxes (too much surface to maintain) and external providers (E2B, Modal — would violate the AWS-native preference without significant gain).
- **Opt-in by template declaration, no admin ceremony.** Matches every reference harness (Managed Agents, Deep Agents, OpenAI Agents, Claude Code). Prior draft of this brainstorm had an admin-approval-per-assignment flow; that was an over-gate relative to category norm.
- **Sandbox environment as a first-class concept, separate from templates, instantiated per-tenant.** Mirrors Managed Agents' Environments abstraction. v1 ships two environment definitions (`default-public`, `internal-only`), each instantiated as a per-tenant Code Interpreter with a tenant-scoped IAM role. Tenant isolation is AWS-level, not dispatcher-level.
- **Two environments in v1: PUBLIC and SANDBOX-mode.** Per-template domain allowlists are not available at the AgentCore layer (SANDBOX / PUBLIC / VPC only). Rather than force all workloads through one permissive posture, we ship two definitions so internal-data workloads get the tighter blast radius they can use. True per-template allowlist requires VPC + Network Firewall — still a followup.
- **Invoking-user OAuth via Secrets Manager, not env-var injection.** AgentCore doesn't support env-var injection at session start. The dispatcher refreshes the OAuth token and writes it to a tenant-scoped Secrets Manager path; the preamble sent to `executeCode` contains only path references. The sandbox reads the token at runtime using its per-tenant IAM role and exports it to the process env. Token values never appear in the `executeCode` payload or in AgentCore APPLICATION_LOGS.
- **Per-turn session lifetime, wiped at turn end.** Matches the typical peer default. Avoids state-bleed across turns. Iterate-within-turn works (multiple sandbox calls in one turn share state). Cross-turn persistence is a v2 opt-in.
- **Tight cost circuit breaker, revisited post-ship.** No baseline usage data exists; v1 caps are deliberately tight (500 inv/day/tenant, 50 min/day/tenant, 20 inv/hour/agent) so that runaways are caught and so the product cannot silently accrue large unbudgeted cost. Loosening is expected once baseline data lands. Rejected earlier "circuit-breaker-as-ceiling" sizing (~$4,800/mo/tenant cap) because a runaway-catch that only fires after $160/day is not a circuit breaker.
- **Sandbox as permanent long-tail surface; typed-wrapper "graduation" is opportunistic, not promised.** Earlier drafts included a graduation path with usage thresholds as numbered requirements (R26/R27). Stripped — a graduation mechanism without a forcing function is indistinguishable from no mechanism, and adding a forcing function is itself a product decision that should come from observed need, not speculative process. v1 accepts that the sandbox is permanent surface for the long tail; typed wrappers happen when engineering weighs specific CLIs worth the investment, as separate product work.

## Dependencies / Assumptions

- Assumes IAM permissions for `bedrock-agentcore-code-interpreter:InvokeInterpreter` and `bedrock-agentcore-code-interpreter:CreateSession` on the Strands runtime role, plus Secrets Manager `GetSecretValue` on the scoped path. `strands-agents-tools` provides the `AgentCoreCodeInterpreter` wrapper, but does **not** expose `sessionTimeoutSeconds` or network mode as constructor params — v1 implementation either subclasses/replaces that wrapper or drives the `bedrock-agentcore` boto3 client directly to set the 5-minute cap. `packages/agentcore-strands/agent-container/server.py` gains the new sandbox tool wiring.
- Assumes `oauth-token.ts` continues to be the refresh authority for user OAuth tokens; the skill dispatcher re-uses it to hydrate Secrets Manager before session start. New OAuth provider branches **are** required: `packages/api/src/lib/oauth-token.ts:buildSkillEnvOverrides` currently has branches only for `google_productivity`, `microsoft_365`, and `lastmile`. Each new `required_connections` type (`github`, `slack`, etc.) needs a corresponding branch + a row in the connection-provider seed. This is a known delta; "no new OAuth infra" was overstated in an earlier draft.
- Assumes per-tool-call sandbox invocations do **not** fit the existing `skill_runs` table (which is per-composition, with a dedup-by-hash index). A new `sandbox_invocations` table, shaped for per-call auditing and joinable to `skill_runs` by `run_id`, is the planned shape — details in R-Q2.
- v1 ships sandbox support for exactly three `required_connections` types: **`google`**, **`github`**, **`slack`**. Each requires a new branch in `oauth-token.ts:buildSkillEnvOverrides` and a row in the connection-provider seed. Adding a fourth connection type post-v1 is additive work, not v1 scope.
- Assumes Secrets Manager under paths `/thinkwork/<stage>/sandbox/<tenant_id>/<user_id>/oauth/<connection_type>` is provisioned either on-demand per invocation or pre-warmed at connection-create time. Planning decision.
- Assumes AgentCore `sessionTimeoutSeconds` parameter is honored at our preferred 5-minute cap.
- Assumes AgentCore APPLICATION_LOGS + USAGE_LOGS can be routed to our existing CloudWatch + S3 log sinks per the observability docs. No new log pipeline.
- Assumes `feedback_dont_overgate_baseline_agent_capability` — we do not add approval ceremony on top of category-baseline capability. This brainstorm's earlier drafts violated that feedback; v1 as specced does not.
- Assumes `project_enterprise_onboarding_scale` sizing — 4 enterprises × 100+ agents × ~5 templates. v1 cost caps are sized for this scale, not for "n=1" simplification.
- Assumes Strands' `AgentCoreCodeInterpreter` tool wrapper does not expose per-session network mode; network posture is therefore fixed at environment creation, not per-invocation. Brainstorm verified this via AWS docs.

## Outstanding Questions

### Resolve Before Planning

- **R-Q1. Cost counter storage (ordered in R22; picking one is a planning task).** DynamoDB conditional-write is the safer default; extending `cost-events.ts` is viable if Postgres discipline is enforced.
- **R-Q2. `sandbox_invocations` column set.** Shape declared in Dependencies (separate from `skill_runs`, joined by `run_id`); exact column set (stdout blob, network-hosts array, timing breakdown) belongs in planning.
- **R-Q3. Secrets Manager hydration shape.** On-demand per invocation (simpler; adds first-token latency) vs. pre-warmed at OAuth-connection-create time (faster; requires refresh-at-session-start guard to avoid stale-token drift). Security requires the refresh-at-session-start guard regardless; the choice is latency vs. infra weight.
- **R-Q4. Tenant-provisioning mechanism for per-tenant Code Interpreters + IAM roles.** Tenants are runtime DB inserts (`createTenant.mutation.ts`), not Terraform-managed resources. Pick one: (a) synchronous boto3 call inside `createTenant.mutation.ts` — simple, blocks the mutation on AWS latency; (b) async Lambda triggered on tenant-create — non-blocking, introduces a provisioning-race window where `sandbox_enabled=true` but interpreter doesn't yet exist (dispatcher must fail closed with a distinguishable `SandboxProvisioning` error during that window); (c) background reconciler that polls the tenants table and drives Terraform — higher operational weight but declarative. None exists in the codebase today; pick the shape before planning.
- **R-Q4b. IAM path scoping shape.** Two viable options, pick one: (a) tenant-wildcard (`/thinkwork/<stage>/sandbox/<tenant_id>/*`) — simple, but any user in the tenant's sandbox can read any user's tokens; this is acceptable if we treat tenant-internal-user isolation as out of scope for v1 (consistent with the tenant-as-trust-boundary posture), (b) per-user scoping via ABAC session tags — the role's policy conditions on `aws:PrincipalTag/UserId == ${secret:resource-tag/UserId}`, requiring the dispatcher to assume a user-tagged role before invoking the interpreter; security-cleaner but adds an STS hop. Per-user Terraform-updated policy is ruled out (untenable at 100+ users/tenant). Pick (a) or (b) before planning.
- **R-Q7. Log-scrubber implementation locus.** R13 invariant is binding; R13 mechanism is "a planning concern." But an invariant that depends on an unimplemented component cannot be claimed as structurally enforced. Pick one: (a) dispatcher-side preprocessor that redacts APPLICATION_LOGS payloads before they reach our CloudWatch group (requires intercepting the AgentCore log stream), (b) CloudWatch Logs subscription filter with a Lambda transformer that redacts in-flight to S3 tier, (c) a scrubber baked into the preamble code itself that wraps `stdout`/`stderr` to strip values before they leave the sandbox. Must be decided + implemented before first production session, not a followup.
- **R-Q8. Cost-cap sizing sanity check.** R20's caps (500/day/tenant, 20/hour/agent) were set tight-to-start. At the stated `project_enterprise_onboarding_scale` of 100+ agents/tenant, 500/day/tenant = 5 inv/agent/day — which is the same order as the Success-criterion flagship demo's invocation count for a single turn. Planning must verify: is the stated scale an aspirational ceiling (most tenants run 10-20 active agents) or the real steady state? If the latter, raise the per-tenant cap before ship; otherwise first-week-of-traffic will trip the circuit breaker on legitimate workflows. This is sizing, not plumbing — no architectural change, but a numerical recalibration based on expected per-agent usage.
- **R-Q9. Regulated-tenant classification mechanism.** T1/T3 mitigations depend on "regulated tenants default `sandbox_enabled = false`." R3a sets the global default as `true`. Pick one: (a) a `tenants.compliance_tier` enum (`standard | regulated | hipaa`) with a DB trigger or application invariant that forces `sandbox_enabled = false` on non-`standard` tiers; (b) a tenant-onboarding checklist item (policy-only, error-prone); (c) drop the "regulated-tenant-default-off" language from T1/T3 entirely and accept that all tenants ship default-on. Pick before planning so the implementation aligns.
- **R-Q10. Tenant-provisioning race handling.** With `tenants.sandbox_enabled` defaulting to `true` (R3a) and interpreters provisioned async (R-Q4), there is a window where a new tenant's agents can attempt sandbox use before the interpreter exists. Pick: (a) dispatcher fails closed with a distinguishable `SandboxProvisioning(tenant)` error until the interpreter is ready; (b) gate sandbox registration on interpreter-ready state, not `sandbox_enabled` alone; (c) default `sandbox_enabled` to `false` on tenant-create and flip to `true` once provisioning completes. (c) inverts the default semantics; (b) is most operationally clean.
- **R-Q5. Strands tool registration semantics.** Does the sandbox tool register as a single `code_sandbox` tool in every agent's tool list (with the environment name as a parameter), or does each environment get its own tool (`code_sandbox_public`, `code_sandbox_internal`)? Planning decides; affects agent system-prompt shaping and how agents choose between environments.
- **R-Q6. Session termination mechanism.** R5 mandates "wiped at turn end"; planning picks the implementation shape of the explicit `TerminateSession` call at turn end (error-handling, retry, orphan-cleanup). Timeout-only reliance is explicitly out — an un-terminated session that AgentCore later times out can be reused by the next turn before reap fires, violating R5's wipe invariant.

### Resolve During Planning

- How does the skill dispatcher's preamble-injection mechanism actually work at the Python level — is it a string prefix to the agent's first `executeCode` submission, or an AgentCore-native file-upload of a preamble `.py` that the sandbox imports? Both are workable; planning picks.
- Session-start latency budget — end-to-end "agent calls sandbox → sandbox ready" should target under 3 seconds to feel responsive. If AgentCore warm-up plus our preamble blows past that, we need a mitigation (warm-pool opt-in, preamble caching, or a loading affordance in the UI).
- stdout/stderr capture path — AgentCore APPLICATION_LOGS `response_payload` contains stdout but is not separated structurally. Planning needs to decide if we parse it out into a structured field or consume it opaquely.
- Admin-UI surface — v1 ships without a dedicated sandbox browser; tenants read CloudWatch. Planning flags the admin-UI followup but does not build it in v1.
- Cost cap UX when a tenant hits the circuit breaker — is the error message exposed to end users, or only visible to admins in logs? Planning picks.

### Defer Until Post-v1 Observation

- Whether to introduce a `vpc-gated` environment with Network Firewall domain allowlists — decided by whether per-template allowlist becomes a real compliance need (e.g., a regulated tenant onboards).
- Whether to introduce assistant-scoped filesystem persistence — decided by observed long-running-agent workloads.
- Whether to introduce a warm session pool — decided by observed session-start latency impact.
- Whether to loosen / tighten cost caps (R20) — reviewed 30 days post-ship with baseline usage data; per-template throttles considered if per-agent-per-hour proves insufficient.
- Whether to invest in the v2 hardening tracks for T1 (in-process credential proxy) and T2 (private PyPI mirror) — decided by incident signal or regulated-tenant demand.
- Whether any specific CLI earns a typed-wrapper project — a separate product decision driven by observed sandbox usage patterns, not a scheduled commitment.

## Related

- Sibling brainstorm (companion): `docs/brainstorms/2026-04-21-bundled-cli-skills-gogcli-google-workspace-requirements.md` — the typed-wrapper path that code-sandbox complements (not replaces).
- Seed document this supersedes: `docs/brainstorms/2026-04-22-agentcore-code-sandbox-admin-skill-seed.md`.
- Strands runtime: `packages/agentcore-strands/agent-container/server.py`.
- Existing typed-skill substrate for contrast: `packages/skill-catalog/`.
- Memory: `feedback_dont_overgate_baseline_agent_capability`, `feedback_user_opt_in_over_admin_config`, `feedback_aws_native_preference`, `project_enterprise_onboarding_scale`.
