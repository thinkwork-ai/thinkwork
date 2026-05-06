---
date: 2026-05-06
topic: thinkwork-computer-product-reframe
---

# ThinkWork Computer — Product Reframe Requirements

## Problem Frame

ThinkWork's current **Agent** concept is carrying too many meanings at once: user identity, template customization, runtime invocation target, workspace/files, tool access, schedules, context injection, and orchestration. The implementation already spends significant effort dynamically assembling context and capabilities into AgentCore invocations, which suggests the product model is hiding a more durable entity.

The reframe is to make **ThinkWork Computer** the primary product object: a persistent, governed AWS-native AI workplace for each human user. A Computer owns the user's context, credentials, live workspace, tools, schedules, and orchestration. **Agents** remain in the product, but they become shared/delegated managed workers with specific capabilities that Computers can call for bounded work.

This is not a cosmetic rename. v1 should migrate user-specific Agents into Computers, make Computers the primary navigation/product surface, keep one always-on Computer per user, and prove the model through personal work orchestration: Google email/calendar/docs/files, an EFS-backed live workspace, and basic delegation to existing AgentCore workers.

---

## Actors

- A1. Human user: owns exactly one ThinkWork Computer in v1 and uses it as their persistent AI work environment.
- A2. Tenant admin/operator: provisions, governs, observes, and budgets Computers and shared Agents for a tenant.
- A3. Computer runtime: the always-on lightweight orchestration environment that owns live workspace state and delegates heavier work.
- A4. Agent: a shared managed worker with specific role, tools, and capabilities, delegated by Computers.
- A5. Planner/implementer: uses this document to plan the domain migration without preserving the old Agent ontology accidentally.

---

## Key Flows

- F1. User gets a Computer
  - **Trigger:** A user exists in a tenant after v1 rollout, or a new user joins after rollout.
  - **Actors:** A1, A2, A3
  - **Steps:** The product presents a Computer as the user's primary AI work surface; the Computer is always available by default; it carries the user's configured context, connected tools, and live workspace; the admin can observe and govern it.
  - **Outcome:** The user has one persistent ThinkWork Computer rather than one or more user-specific Agents.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Existing user-specific Agents migrate into Computers
  - **Trigger:** The Computer model is enabled for an existing tenant.
  - **Actors:** A1, A2, A5
  - **Steps:** Each existing user-specific Agent maps to that user's single Computer; durable user-facing state, schedules, workspace context, and history remain reachable through the Computer; post-migration, Agents are no longer the durable per-user entity.
  - **Outcome:** Users and admins see Computers as the primary object, while planning can still preserve necessary history and rollback discipline.
  - **Covered by:** R6, R7, R8, R9

- F3. Computer delegates work to an Agent
  - **Trigger:** The Computer receives a user request, schedule, webhook, or internal orchestration task that should be handled by a specialized managed worker.
  - **Actors:** A1, A3, A4
  - **Steps:** The Computer prepares the relevant context and workspace state; it delegates a bounded task to an Agent; the Agent executes through managed AgentCore infrastructure; the Agent returns results, files, notes, or structured output back to the Computer.
  - **Outcome:** The Computer remains the durable owner of the work, while the Agent is auditable as the worker that performed the delegated task.
  - **Covered by:** R10, R11, R12, R13

- F4. Computer performs personal work orchestration
  - **Trigger:** A user asks the Computer to manage work across email, calendar, docs, or files.
  - **Actors:** A1, A3, A4
  - **Steps:** The Computer uses the user's connected Google Workspace credentials and CLI/tooling to inspect or act on email/calendar/docs/files; it writes useful working state to its live workspace; it delegates heavier reasoning or production work to Agents when appropriate.
  - **Outcome:** The v1 launch proves that a Computer is more than a chat agent: it is a governed, persistent workplace for AI work.
  - **Covered by:** R14, R15, R16, R17

---

## Requirements

**Product ontology**

- R1. **Computers replace user-specific Agents as the primary product model.** The main product surface should lead with Computers, not Agents, for durable user-owned AI work.
- R2. **Each human user has exactly one Computer in v1.** Multiple Computers per user are not part of v1.
- R3. **Computers are always-on by default.** Sleep/wake can exist later as an optimization or policy control, but v1's product promise is that the Computer is available like a real workplace machine.
- R4. **Computers own persistent user work state.** Context, workspace files, tool configuration, schedules, connected credentials, and orchestration state belong to the Computer.
- R5. **ThinkWork Computer is positioned as a governed AWS-native workplace.** The differentiator is control: customer-owned AWS boundary, audit, budgets, files, credentials, and runtime governance.

**Migration and naming**

- R6. **Existing user-specific Agents migrate into Computers.** The migration should preserve user-facing continuity for history, schedules, workspace state, and configuration.
- R7. **After migration, Agents mean shared/delegated managed workers.** Agents are no longer durable per-user primary actors.
- R8. **Templates remain, but become typed.** Existing Agent Templates split into Computer Templates and Agent Templates, or an equivalent typed Templates model.
- R9. **The primary nav changes to Computers.** Agents may remain as a separate surface for shared/delegated workers, but they should not continue to represent the user's primary AI workplace.

**Delegation model**

- R10. **Computers delegate bounded work to Agents.** Delegated Agents should be managed workers with roles, capabilities, and templates.
- R11. **Delegated results return into the Computer.** Files, notes, thread updates, or structured results created by an Agent should flow back into the Computer's context/workspace.
- R12. **Audit must preserve delegation attribution.** Even when the Computer owns the result, the system must record which delegated Agent performed the work.
- R13. **Managed Agent remains valid category language.** Product UI may use "Agents"; docs and technical comparison pages may use "managed agents" where it clarifies the architecture.

**Personal work orchestration proof**

- R14. **v1 must prove the Computer with personal work orchestration.** The launch slice includes Google Workspace work across email, calendar, docs, and files.
- R15. **Google CLI/tooling is part of the v1 proof.** The Computer should be able to use CLI-backed or equivalent tool access for Google Workspace rather than only narrow hand-written skills.
- R16. **The Computer has a live filesystem workspace.** EFS-backed workspace state is the live working layer for files, CLI artifacts, and durable local context.
- R17. **S3 remains part of durability and audit, not the primary live workspace.** S3 should continue to serve snapshots, artifacts, backups, event records, and audit needs where it is the better storage layer.

**Experience and governance**

- R18. **Streaming and lower latency are architectural upsides, not v1 acceptance gates.** v1 should not depend on proving faster first-token or full live-streaming behavior.
- R19. **Computer cost target is acceptable below roughly `$10/month/user` before variable storage/network effects.** Planning must verify current AWS pricing and call out cost drivers, but the product direction accepts this order of magnitude.
- R20. **Per-user credentials remain user-owned.** Computers should use the user's connected accounts and consent model rather than tenant admins configuring personal credentials on their behalf.
- R21. **Governance applies to Computers and Agents.** Budgets, audit, tool controls, guardrails, and tenant boundaries must remain visible after the ontology migration.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R9.** Given a tenant after the v1 migration, when a user opens the admin or app primary work surface, they see their Computer as the durable AI workplace rather than a user-specific Agent list.
- AE2. **Covers R6, R7, R8.** Given an existing user-specific Agent before migration, when the migration completes, that durable user-facing object is represented as the user's Computer, while Agents after migration represent shared/delegated managed workers.
- AE3. **Covers R10, R11, R12.** Given a Computer delegates a research task to an Agent, when the Agent produces notes and a file, the result appears in the Computer's workspace/context and the audit trail attributes the work to the delegated Agent.
- AE4. **Covers R14, R15, R16, R17, R20.** Given a user has connected Google Workspace, when they ask their Computer to inspect email, schedule a calendar event, create or update a doc, and save related files, the Computer uses the user's credentials, writes working artifacts to its live workspace, and preserves durable artifacts/audit through the platform.
- AE5. **Covers R18, R19, R21.** Given v1 ships without a measured streaming improvement, the release still succeeds if Computers are persistent, governed, cost-accounted, and capable of personal work orchestration plus delegation.

---

## Success Criteria

- A user can describe the product simply: "I have a ThinkWork Computer that does my AI work, and it can delegate to Agents."
- The primary product navigation and docs no longer imply that user-specific Agents are the core durable object.
- Existing user-specific Agent state is migrated or preserved under Computers without orphaning user-facing schedules, workspace history, or relevant threads.
- The v1 proof demonstrates Google email/calendar/docs/files plus live workspace behavior and basic delegation to managed Agents.
- Planning can proceed without inventing the product ontology, v1 proof workflow, or naming hierarchy.

---

## Scope Boundaries

### Deferred for later

- Multiple Computers per user.
- Shared/team-owned Computers.
- Rich remote desktop or full browser session UI for the Computer.
- Sleep/wake scheduling as a default product behavior.
- Streaming/first-token latency guarantees.
- A marketplace-style Agent catalog.
- Advanced Agent specialization, marketplace packaging, or customer-uploaded Agent runtimes.
- Deep migration cleanup that removes every legacy Agent-named internal table/API in the first implementation pass, if planning determines a compatibility layer is safer.

### Outside this product's identity

- ThinkWork Computer is not generic VM hosting.
- ThinkWork Computer is not a cloud desktop replacement for humans.
- ThinkWork Computer is not "browser automation with a nicer name."
- ThinkWork Computer is not a replacement for AgentCore managed execution; it coordinates and delegates to managed Agents.
- ThinkWork Computer is not a consumer personal assistant detached from tenant governance, audit, budgets, and AWS ownership.

---

## Key Decisions

- **Computer is the durable per-user entity:** This makes the architecture honest: the durable thing owns context, tools, credentials, schedules, files, and orchestration.
- **Agents remain as delegated workers:** Keeping "Agents" preserves category language while making the hierarchy clear: Computers own work; Agents perform delegated work.
- **One Computer per user in v1:** This keeps identity, credentials, cost, and migration understandable.
- **Always-on by default:** The product promise is stronger and matches the Computer metaphor. Cost at the expected low-profile runtime tier is accepted as reasonable.
- **Hard ontology migration, not parallel beta:** The product should commit to Computers as the primary model rather than hiding the insight behind an advanced feature flag.
- **EFS is the live workspace; S3 remains durable infrastructure:** This avoids treating object-store sync as the primary working filesystem while preserving S3's strengths for artifacts, backup, audit, and eventing.
- **Personal work orchestration is the v1 proof:** Google Workspace plus files and delegation demonstrates why a persistent Computer matters.
- **Governed AWS-native workplace is the differentiator:** If competitors adopt "cloud computer" language, ThinkWork still wins on customer-owned AWS boundary, audit, budgets, and control.

---

## Dependencies / Assumptions

- Assumes the current project can support an AWS-native always-on Computer runtime per user at an acceptable cost target, with exact sizing and pricing verified during planning.
- Assumes existing per-user OAuth/connectors remain the right credential ownership model for Google Workspace in v1.
- Assumes the current AgentCore managed runtime remains the right substrate for delegated Agents.
- Assumes existing Agent state can be mapped to one Computer per user without losing critical history or requiring a customer-visible reset.
- Assumes "Agents" as delegated workers will be understandable if the UI consistently frames Computers as owners and Agents as workers.
- Assumes the product can tolerate migration churn in docs, nav, and naming because the new ontology is materially stronger.

---

## Outstanding Questions

### Resolve Before Planning

(none)

### Deferred to Planning

- **[Affects R6, R7, R8][Technical]** Determine the safest migration shape from current Agent records/templates into Computers, Computer Templates, and Agent Templates.
- **[Affects R16, R17][Technical]** Define the exact EFS/S3 responsibility split, including snapshot, backup, artifact, and audit behavior.
- **[Affects R10, R11, R12][Technical]** Define the delegation contract between Computer and Agent, including result handoff, workspace writeback, and audit attribution.
- **[Affects R14, R15, R20][Needs research]** Confirm the Google CLI/tooling path for email, calendar, docs, and files, including OAuth scope and non-interactive behavior.
- **[Affects R19][Needs research]** Verify current AWS pricing for the always-on Computer runtime, EFS storage, logs, networking, and per-user cost drivers.
- **[Affects R21][Technical]** Map existing budgets, audit, guardrails, and tool controls onto the Computer/Agent split without weakening tenant governance.

---

## Next Steps

-> `/ce-plan` for structured implementation planning
