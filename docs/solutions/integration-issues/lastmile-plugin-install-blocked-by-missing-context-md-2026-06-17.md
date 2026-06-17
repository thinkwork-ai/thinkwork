---
title: LastMile plugin skills install can fail when legacy platform agents lack CONTEXT.md
date: 2026-06-17
category: integration-issues
module: Application Plugins / Workspace Bootstrap
problem_type: production_debug
component: plugin-installer
severity: high
applies_when:
  - "Installing an application plugin that bundles catalog skills"
  - "The tenant platform agent was created before the current workspace defaults were materialized"
  - "A plugin install shows the skills component failed while later MCP components remain pending"
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

TEI is not the default local `dev` stack. Its web runtime config identifies the
actual deployed target as:

- stage: `tei-e2e`
- AWS account: `637423202447`
- app URL: `https://tei.thinkwork.ai`
- GraphQL URL: `https://8puq24dl63.execute-api.us-east-1.amazonaws.com/graphql`
- workspace bucket: `thinkwork-tei-e2e-storage`
- release: `v0.1.0-canary.198`

## Root Cause

The LastMile manifest includes one bundled plugin skill,
`lastmile--crm-basics`. Plugin skills are provisioned by
`packages/api/src/lib/plugins/handlers/skills.ts`, which:

1. Seeds the bundled `SKILL.md` into the tenant skill catalog.
2. Generates `WIRING.md` when needed.
3. Calls `installCatalogSkill` to materialize the skill under the tenant
   platform agent workspace.

`installCatalogSkill` in `packages/api/src/lib/catalog-install.ts` appends the
selected wiring snippet to the target workspace root `CONTEXT.md`. If that file
does not exist, it throws `CatalogInstallError` with code `context_md_missing`
and the exact message seen in the TEI UI.

TEI's tenant has a legacy platform-agent workspace that predates the current
workspace defaults materialization. Database and S3 evidence from the `tei` AWS
profile showed:

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

## Confirmed TEI Evidence

TEI plugin install DB state:

- `plugin_installs.plugin_key = 'lastmile'`
- install id: `89c88876-b0e0-44da-8c41-b7e3b07b8a56`
- pinned version: `0.1.0`
- state: `partially_installed`
- created: `2026-06-16 23:46:27 UTC`
- updated: `2026-06-16 23:46:38 UTC`

TEI component state:

- `skills`: `failed`, last error
  `CONTEXT.md is required before installing a catalog skill.`
- `crm`: `pending`
- `tasks`: `pending`
- `routing`: `pending`

This component ordering matches the plugin engine: skills provision first, and
a failed component aborts the later MCP components, leaving them pending.

## Ruled Out

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

## Fix Plan

Implement the product fix before mutating TEI:

1. Make plugin skill provisioning repair missing platform-agent workspace
   defaults before calling `installCatalogSkill`.
   - Preferred path: call
     `bootstrapAgentWorkspace(agent.id, { mode: "preserve-existing" })` after
     resolving the tenant platform agent and before installing bundled skills.
   - This writes only missing default files and preserves existing
     operator-authored files.
   - Treat non-repairable bootstrap errors as the existing component failure so
     the plugin remains retryable.
2. Add a focused unit test in
   `packages/api/src/lib/plugins/handlers/skills.test.ts`.
   - Simulate the installer throwing `context_md_missing`.
   - Assert the handler invokes a workspace-default repair seam and retries or
     performs repair before the install.
   - Keep the existing "propagates non-409 install failures" coverage for
     unrelated catalog install errors.
3. Consider whether generic catalog skill installs from the admin Skills tab
   should keep failing with `context_md_missing` or share the same repair path.
   The plugin path is the production incident; the broader admin path can be a
   follow-up if the first change needs to stay narrow.

After the code fix is deployed to `tei-e2e`, perform the operational repair:

1. Retry the failed `skills` component through the ThinkWork plugin UI or
   GraphQL `retryPluginComponent` mutation.
2. Confirm the installer materializes:
   - `tenants/original-moose-497/agents/thinkwork-agent/CONTEXT.md`
   - `tenants/original-moose-497/agents/thinkwork-agent/skills/lastmile--crm-basics/SKILL.md`
   - `tenants/original-moose-497/agents/thinkwork-agent/skills/lastmile--crm-basics/WIRING.md`
   - `tenants/original-moose-497/agents/thinkwork-agent/skills/lastmile--crm-basics/.catalog-ref.json`
3. Confirm the plugin install converges to `installed` and all four components
   are `provisioned`.
4. Activate/verify LastMile MCP as in THNK-31:
   - `/api/mcp/tools/list` exposes `lastmile--crm`, `lastmile--tasks`, and
     `lastmile--routing`.
   - A tool call reaches LastMile; an upstream directory denial such as
     `401 User not found in LastMile directory` is a LastMile membership issue,
     not a ThinkWork install failure.

## Why No Direct Production Mutation Was Done In Debug

The direct TEI workaround is to materialize missing workspace defaults for the
live platform agent and retry the failed component. That writes production S3
workspace files and changes plugin component state. The Debug phase requested
root-cause analysis and an artifact, and explicitly required no production
mutation without action-time authorization. This document therefore stops at
confirmed diagnosis plus a concrete repair plan.

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
