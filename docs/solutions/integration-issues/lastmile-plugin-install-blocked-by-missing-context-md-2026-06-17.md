---
title: LastMile plugin skills install can fail when legacy platform agents lack CONTEXT.md
date: 2026-06-17
last_updated: 2026-06-17
category: integration-issues
module: Application Plugins / Workspace Bootstrap
problem_type: integration_issue
component: tooling
symptoms:
  - "LastMile plugin install 89c88876-b0e0-44da-8c41-b7e3b07b8a56 was partially installed in TEI."
  - "The skills component failed with CONTEXT.md is required before installing a catalog skill."
  - "Later crm, tasks, and routing MCP components stayed pending because skills provisioning aborted first."
root_cause: missing_workflow_step
resolution_type: code_fix
severity: high
related_components:
  - plugin-engine
  - catalog-install
  - workspace-bootstrap
  - tenant-bootstrap
  - lastmile
tags:
  - thnk-38
  - application-plugins
  - lastmile
  - workspace-defaults
  - context-md
  - tei-e2e
---

# LastMile plugin install blocked by missing CONTEXT.md

## Context

THNK-38 reported a failed LastMile install in the TEI deployed ThinkWork
environment at `https://tei.thinkwork.ai`. The Linear screenshot showed the
LastMile plugin detail page in a partially installed state:

- `crm`, `tasks`, and `routing` MCP server components were still `Pending`.
- The `skills` component was `Failed`.
- The failed component message was:
  `CONTEXT.md is required before installing a catalog skill.`

The completed fix shipped in two layers: the plugin skills handler repairs
missing platform-agent defaults before installing bundled skills, and the
generic catalog installer now creates root `CONTEXT.md` when it is absent. The
live TEI install was also repaired and retried successfully after explicit
authorization.

TEI is a separate deployed customer stage, not the default local `dev` stack, so
debugging had to follow TEI's runtime config and deployed install state.

## Root Cause

The LastMile manifest includes one bundled plugin skill,
`lastmile--crm-basics`. Plugin skills are provisioned by
`packages/api/src/lib/plugins/handlers/skills.ts`, which:

1. Seeds the bundled `SKILL.md` into the tenant skill catalog.
2. Generates `WIRING.md` when needed.
3. Calls `installCatalogSkill` to materialize the skill under the tenant
   platform agent workspace.

At debug time, `installCatalogSkill` in
`packages/api/src/lib/catalog-install.ts` appended the selected wiring snippet
to the target workspace root `CONTEXT.md`. If that file did not exist, it threw
`CatalogInstallError` with code `context_md_missing` and the exact message seen
in the TEI UI.

TEI's tenant had a legacy platform-agent workspace that predated the current
workspace defaults materialization. Database and S3 evidence showed:

- tenant DB row: `tei`
- tenant S3 prefix: `tenants/original-moose-497/`
- platform agent: `thinkwork-agent`
- platform agent S3 files present:
  - `AGENTS.md`
  - `SOUL.md`
  - `agents/analyst.md`
  - `agents/coding.md`
  - `agents/research.md`
  - `agents/reviewer.md`
  - `manifest.json`
- platform agent S3 files absent:
  - `CONTEXT.md`
  - current default root files such as `GUARDRAILS.md`, `TOOLS.md`,
    `MEMORY_GUIDE.md`, `ROUTER.md`, `SPACE.md`, and `USER.md`

The tenant defaults catalog does contain `CONTEXT.md` at
`tenants/original-moose-497/agents/_catalog/defaults/workspace/CONTEXT.md`, so
the missing file is not a release artifact problem. The gap is that the legacy
platform agent was not rematerialized from those defaults before the plugin
skills installer required root `CONTEXT.md`.

Session history added one important live-debug detail: the active install
prefix must be derived from the tenant slug and resolved platform agent, not
guessed from an older tenant alias. In this incident, repairing only the legacy
`tenants/original-moose-497/...` prefix was not enough for the successful retry
because the active install also used `tenants/tei/agents/thinkwork-agent/`,
which lacked `CONTEXT.md` too. Repair observed legacy aliases only when runtime
evidence shows they are still referenced.

The component state proved the ordering: `skills` failed first with
`CONTEXT.md is required before installing a catalog skill.`, and the later
`crm`, `tasks`, and `routing` MCP components stayed pending because plugin
skills provision before MCP server components.

## Ruled Out

- Checking the default `dev` stack was misleading. That stack already had
  LastMile installed and did not represent the TEI customer environment.
- Not a LastMile OAuth/token restoration issue. No MCP rows were provisioned in
  TEI because the install failed before MCP component provisioning began.
- Not the THNK-36 CloudFront/S3 CSP issue. The TEI web host now serves CSP with
  regional S3 endpoints in `connect-src`; this failure is a server-side catalog
  install precondition.
- Not missing bundled LastMile skill source. The LastMile manifest declares
  `lastmile--crm-basics`, and the plugin skills handler generates the required
  `WIRING.md` when the bundle omits it.
- Not missing tenant defaults. TEI's defaults catalog has `CONTEXT.md`; only the
  live platform-agent workspace is stale.
- Retrying before deploying or repairing workspace defaults would have exercised
  the same brittle precondition and failed again.

## Solution

Two product fixes landed after the debug artifact:

1. PR #2584 (`a8c2d97d`) made plugin skill provisioning repair missing
   platform-agent workspace defaults before calling `installCatalogSkill`.
   `provisionPluginSkillsComponent` now resolves the tenant platform agent and
   calls:

   ```ts
   await bootstrapWorkspace(agent.id, { mode: "preserve-existing" });
   ```

   This writes missing default files such as root `CONTEXT.md` while preserving
   tenant or operator-authored files.

2. PR #2588 (`5fb574ad`) removed the brittle lower-level precondition from the
   shared catalog installer. `installCatalogSkill` now treats a missing
   `CONTEXT.md` as empty content, appends the selected wiring snippet, and
   creates `CONTEXT.md`. If the final context write fails, rollback removes the
   copied skill files and `.catalog-ref.json`; it does not need to restore or
   delete `CONTEXT.md` because that write did not succeed.

Focused coverage now asserts both behaviors:

- `packages/api/src/lib/plugins/handlers/skills.test.ts` verifies the plugin
  handler repairs legacy platform-agent defaults before catalog skill install.
- `packages/api/src/lib/catalog-install.test.ts` verifies
  `installCatalogSkill` creates `CONTEXT.md` when it is missing.

After explicit authorization, TEI was repaired operationally:

1. Missing root workspace defaults were materialized into both relevant TEI
   platform-agent prefixes, preserving existing files:
   - `tenants/original-moose-497/agents/thinkwork-agent/`
   - `tenants/tei/agents/thinkwork-agent/`
2. The failed `skills` component for install
   `89c88876-b0e0-44da-8c41-b7e3b07b8a56` was retried through the product
   GraphQL mutation.
3. The install converged to `installed`; `skills`, `crm`, `tasks`, and
   `routing` all became `provisioned`.
4. `CONTEXT.md` contained the LastMile skill wiring snippet, and
   `skills/lastmile--crm-basics/` contained `SKILL.md`, `WIRING.md`, and
   `.catalog-ref.json`.
5. Tenant MCP rows existed for `lastmile--crm`, `lastmile--tasks`, and
   `lastmile--routing`.

## Why This Works

The plugin install path is now tolerant of stale tenant workspaces at both the
component layer and the shared catalog-skill layer. The plugin handler repairs
workspace defaults in `preserve-existing` mode before provisioning, and the
catalog installer no longer treats missing root `CONTEXT.md` as fatal.

That distinction matters because `CONTEXT.md` is ThinkWork agent routing and
skill wiring, not a LastMile dependency. The installer only needs a place to
append the generated "read this skill" snippet. Creating the file when absent
preserves the desired behavior without requiring every legacy platform-agent
workspace to have already been rematerialized.

## Why No Direct Production Mutation Was Done In Debug

The direct TEI workaround was to materialize missing workspace defaults for the
live platform agent and retry the failed component. That writes production S3
workspace files and changes plugin component state. The Debug phase correctly
stopped at root-cause analysis and a repair plan because it did not have
action-time authorization for production mutation. The later operational repair
only happened after explicit authorization during verification.

## Prevention

Application plugin installs must not assume that every existing tenant platform
agent has been rematerialized with the latest default workspace file set. Any
component handler that relies on current defaults should either:

- repair missing defaults in `preserve-existing` mode before provisioning; or
- fail with a remediation-specific error that includes the exact tenant, agent,
  and missing workspace files.

For plugin skills, repair-on-install is the safer default because the tenant
defaults catalog is already the source of truth and `preserve-existing` avoids
overwriting operator edits.

Keep tenant install health separate from per-user OAuth activation during
verification. Component convergence, materialized skill files, `CONTEXT.md`
wiring, and tenant MCP server rows prove the tenant install. User-scoped
`/api/mcp/tools/list` proof additionally requires a user activation row, so a
post-install `Connection: Not connected` state can be expected until a user
clicks Connect and completes LastMile OAuth.

## Related Issues

- THNK-38: Error installing LastMile Plugin
- PR #2581: Debug artifact for the LastMile `CONTEXT.md` failure
- PR #2584: Repair workspace defaults before plugin skills
- PR #2588: Create `CONTEXT.md` during catalog skill install
- `docs/solutions/architecture-patterns/plugin-source-boundaries-package-owned-deploy-verified-2026-06-17.md`
- `docs/solutions/architecture-patterns/workspace-skills-load-from-copied-agent-workspace-2026-04-28.md`
