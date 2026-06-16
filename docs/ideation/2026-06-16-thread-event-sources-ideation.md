---
date: 2026-06-16
topic: thread-event-sources
focus: "ThinkWork as a Twenty app package that enhances Twenty with ThinkWork resources"
mode: repo-grounded
---

# Ideation: Thread Event Sources

## Grounding Context

ThinkWork already has Twenty as a first-party plugin with infrastructure and MCP
components in `plugins/twenty/src/manifest.ts`. The plugin catalog currently
supports `mcp-server`, `skills`, `infrastructure`, and a declared-only
`ui-surface` component in `packages/plugin-catalog/src/contracts.ts`.

Twenty's app extension model can add fields to standard objects, define custom
objects, add record page tabs/widgets, expose command menu actions, define
server-side logic functions, expose workflow actions/tools, and declare
app-scoped permissions. This makes it possible for a Twenty app package to be a
native event producer and UI convenience layer, not only a status handle.

The product split from
`docs/brainstorms/2026-06-16-twenty-native-operating-surface-requirements.md`
still matters: Twenty owns CRM records and business views; ThinkWork owns
Threads, Goals, execution history, approvals, audit, runtime health, and
governance. The Twenty package should be optional: a high-leverage enhancement
for tenants using Twenty, not a dependency of core ThinkWork.

## Ranked Ideas

### 1. Thread Event Sources

**Description:** Let any approved external producer send structured events into
ThinkWork. ThinkWork verifies, deduplicates, normalizes, routes, and appends
those events to a Thread, Goal, or review inbox. A route's wake policy decides
whether the event only appears in the timeline or wakes the agent to respond.

**Warrant:** `direct:` ThinkWork already has Threads, Goals, linked task events,
agent wakeup concepts, and webhook/event-adjacent precedent; the Twenty app
docs provide native ways to emit events from record updates, notes, tasks,
commands, and workflow actions.

**Rationale:** This avoids a CRM-specific linkage model while still enabling
Twenty task updates, notes, and status changes to become first-class thread
context. Twenty becomes the first rich producer, but the same contract can work
for Linear, GitHub, Slack, email, Stripe, support tools, or customer apps.

**Downsides:** The routing model must stay simple enough for producers to use
while still preventing noisy or misrouted agent wakeups. The product must also
distinguish external events from user-authored chat messages.

**Confidence:** 90%

**Complexity:** Medium-High

**Status:** Explored

### 2. Native ThinkWork Companion Package

**Description:** Treat the Twenty app package as a new component of the
existing Twenty plugin, alongside infrastructure and MCP. It declares the
Twenty-side objects, fields, UI components, command actions, and logic functions
needed to make ThinkWork work visible from CRM records.

**Warrant:** `direct:` `plugins/twenty/src/manifest.ts` already bundles Twenty
infrastructure plus MCP in one first-party plugin; `packages/plugin-catalog/src/contracts.ts`
already reserves `ui-surface` as a plugin component type.

**Rationale:** This makes the Twenty app package part of the same
install/provision lifecycle users already understand, instead of introducing a
parallel install lane.

**Downsides:** Requires extending plugin contracts beyond declared-only UI
surfaces and deciding where the Twenty app source package lives.

**Confidence:** 88%

**Complexity:** Medium

**Status:** Unexplored

### 3. Record-Level ThinkWork Panel

**Description:** Add a ThinkWork tab/widget to Company and Opportunity pages.
The panel shows linked ThinkWork Goals/Threads, current state, owner, next
action, review-needed state, and a deep link into ThinkWork for the full
execution ledger.

**Warrant:** `external:` Twenty page-layout docs support adding tabs/widgets to
standard record pages; repo requirements say Twenty should show lightweight
status while ThinkWork keeps the full execution ledger.

**Rationale:** This is the clearest native surface: users stay on the CRM
record and see agent work in business context without duplicating ThinkWork.

**Downsides:** Front components are sandboxed, so the UI has to work through
approved host APIs and/or logic functions; auth and deep-link behavior need
care.

**Confidence:** 86%

**Complexity:** Medium

**Status:** Unexplored

### 4. Start or Resume ThinkWork Command

**Description:** Add command menu actions for "Start ThinkWork Goal" or "Resume
ThinkWork Work" on Opportunity, Company, Person, Task, and record selections.
The command opens a small Twenty-native front component to choose the
outcome/template, then calls ThinkWork to create or reopen linked work.

**Warrant:** `external:` Twenty command menu items can be scoped by object,
page, and selection and can launch headless or modal front components; repo
requirements need CRM-record-centered work promotion with idempotent
reopen/resume behavior.

**Rationale:** This converts Twenty from a passive source of context into the
natural starting point for governed work.

**Downsides:** Needs careful duplicate detection and a clear first workflow so
the action does not become another generic prompt box.

**Confidence:** 84%

**Complexity:** Medium

**Status:** Unexplored

### 5. Twenty Workflow Action Bridge

**Description:** Expose one or two ThinkWork operations as Twenty workflow
actions, such as "Create or resume onboarding Goal" or "Request ThinkWork
review." These call ThinkWork through a logic function with app-scoped
permissions and explicit configured inputs.

**Warrant:** `external:` Twenty logic functions can be exposed as workflow
actions and tools; repo requirements call for configured CRM workflows, not
only manual launches.

**Rationale:** This unlocks no-code CRM automation while still routing
accountable work into ThinkWork governance.

**Downsides:** Background automation can feel magical or unsafe unless the
first action is narrow, idempotent, and review-aware.

**Confidence:** 78%

**Complexity:** Medium-High

**Status:** Unexplored

## Rejection Summary

| #   | Idea                                                    | Reason Rejected                                                                   |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | Thin status writeback only                              | Too small; duplicates earlier status-handle direction and underuses Twenty apps.  |
| 2   | Full ThinkWork thread viewer embedded in Twenty         | Too much source-of-truth duplication; ThinkWork should keep full execution/audit. |
| 3   | Convert ThinkWork resources into Twenty source of truth | Subject replacement; makes Twenty own ThinkWork execution state.                  |
| 4   | Auto-promote every closed-won opportunity               | Too broad and risky for v1; explicit/configured workflows should come first.      |
| 5   | Workflow-action-first vs front-component-first          | Implementation variants of stronger ideas, not standalone product directions.     |
| 6   | Marketplace app for arbitrary external Twenty installs  | Valuable later, but v1 should prove the managed/plugin path first.                |
