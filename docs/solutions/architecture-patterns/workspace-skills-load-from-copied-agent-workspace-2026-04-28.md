---
title: "Load agent skills from the copied workspace"
module: "agent workspace runtime"
date: "2026-04-28"
problem_type: architecture_pattern
component: assistant
severity: high
category: docs/solutions/architecture-patterns/
applies_when:
  - "Agent runtime needs operator-editable skills to affect the next turn"
  - "Workspace files are copied from S3 into a local runtime directory before execution"
  - "Skill activation should be derived from workspace/skills/<slug>/SKILL.md instead of a parallel catalog path"
  - "Built-in tools share skill-like UI/catalog concepts but must not become editable workspace files"
related_components:
  - tooling
  - development_workflow
  - documentation
tags:
  - agent-workspace
  - workspace-skills
  - s3-copy
  - strands-runtime
  - pi-runtime
  - filesystem-truth
  - builtin-tools
  - s3-versioning
---

# Load agent skills from the copied workspace

## Context

The Strands and Pi AgentCore runtimes both bootstrap an agent turn by copying the agent's S3 workspace prefix into the local runtime filesystem. Skills had drifted away from that model: catalog installs wrote to a parallel skill prefix, runtime config separately pointed at that skill prefix, and admin surfaces kept a skill list outside the Workspace tree.

That made the simple invariant hard to preserve: if an operator edits `workspace/skills/<slug>/SKILL.md`, the next agent turn should run that edited file. The shipped fix is to make the copied workspace the activation source for operator skills.

## Pattern

Use one filesystem truth for editable skills:

- Store installed catalog skills under `tenants/{tenantSlug}/agents/{agentSlug}/workspace/skills/{skillSlug}/`.
- Store template skills under `tenants/{tenantSlug}/agents/_catalog/{templateSlug}/workspace/skills/{skillSlug}/`.
- Treat the presence of `workspace/**/skills/<slug>/SKILL.md` as the activation signal.
- Derive `agent_skills` rows from that filesystem state. Do not use `agent_skills` as the runtime activation source.
- Copy the agent workspace S3 prefix into the AgentCore filesystem before each turn.
- Have Strands and Pi discover workspace skills from the copied local filesystem.

This removes the duplicate skill materialization path. Operator-installed skills are workspace files, and runtime activation reads the workspace copy that already exists for the turn.

## Built-In Tool Boundary

Do not put built-in tools into `workspace/skills/`.

`web-search` is a built-in tool, not an editable workspace skill. It can appear in template or runtime configuration, but it should not materialize as `workspace/skills/web-search/SKILL.md` and should not survive as an `agent_skills` row derived from workspace files. Keep the boundary explicit in code with a built-in slug list and template/tool configuration gates.

This distinction matters because the UI and storage shape can make built-ins look skill-like. If a built-in tool is copied into the workspace tree, operators see it as editable user content and repairs/backfills may preserve the wrong file forever.

## Implementation Notes

The pattern landed across the workspace-skill PR series:

- PR #660 moved catalog install destinations into `workspace/skills/` for agents and templates.
- PR #661 added the empty `skills/` folder default and workspace tree rendering behavior.
- PR #662 switched Strands and Pi to local workspace skill discovery after workspace bootstrap.
- PR #664 prevented built-in tools like `web-search` from being treated as workspace skills and enabled S3 bucket versioning.
- PR #665 made Web Search opt in through template configuration instead of a workspace skill folder.

Important files:

- `packages/api/src/handlers/skills.ts` installs catalog skills into the workspace prefix.
- `packages/api/src/lib/derive-agent-skills.ts` derives skill rows from `workspace/**/skills/<slug>/SKILL.md`.
- `packages/api/src/lib/builtin-tool-slugs.ts` defines slugs that must stay out of workspace skills.
- `packages/api/workspace-files.ts` triggers re-derivation when workspace skill files change.
- `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx` and `FolderTree.tsx` expose skills as workspace files.
- `packages/agentcore-strands/agent-container/container-sources/skill_runner.py` discovers workspace skills in the copied Strands workspace.
- `packages/agentcore-pi/agent-container/src/runtime/tools/workspace-skills.ts` discovers workspace skills in the copied Pi workspace.
- `terraform/modules/data/s3-buckets/main.tf` enables versioning on the storage bucket.

## Operational Repair

When a stage has already been polluted by a built-in tool or legacy skill prefix, repair it as data, then re-derive:

```bash
aws s3api get-bucket-versioning --bucket thinkwork-dev-storage
aws s3 ls s3://thinkwork-dev-storage/tenants/ --recursive | grep '/skills/' | grep -v '/workspace/skills/'
aws s3 rm --recursive s3://thinkwork-dev-storage/tenants/<tenant>/agents/<agent>/workspace/skills/web-search/
psql "$DATABASE_URL" -c "delete from agent_skills where skill_id = 'web-search';"
```

The 2026-04-28 dev repair verified GiGi and Marco kept their default workspace files, removed stale `web-search` workspace folders, removed `web-search` `agent_skills` rows, and left Web Search available through built-in tool configuration.

## Verification

Use focused checks that prove the invariant at each layer:

```bash
pnpm --filter @thinkwork/workspace-defaults test
pnpm --filter @thinkwork/api exec vitest run src/__tests__/derive-agent-skills.test.ts src/__tests__/workspace-files-handler.test.ts
pnpm --filter @thinkwork/api typecheck
pnpm --filter @thinkwork/admin build
pnpm --filter @thinkwork/agentcore-pi test
pnpm --filter @thinkwork/agentcore-pi typecheck
uv run --with pytest --with pytest-asyncio --with pyyaml --with strands-agents pytest packages/agentcore-strands/agent-container --ignore=packages/agentcore-strands/agent-container/test_workspace_composer_fetch.py
terraform fmt -check terraform/modules/data/s3-buckets/main.tf
```

The highest-signal end-to-end smoke is: install or edit a workspace skill, invoke the agent, and confirm the runtime uses the copied `workspace/skills/<slug>/SKILL.md` content. A UI smoke should also confirm an agent with no installed skills still renders the empty `skills/` folder without showing `.gitkeep`.

## Failure Modes

- Two S3 key shapes can coexist during a partial rollout: legacy `agents/<agent>/skills/<slug>/` and canonical `agents/<agent>/workspace/skills/<slug>/` (session history). Add deploy or repair checks for legacy prefixes before declaring a stage clean.
- Without S3 bucket versioning, deleted workspace files cannot be restored from S3 versions (session history). Keep storage bucket versioning enabled in Terraform and verify it in each stage.
- Built-in tools can leak into workspace skills if install/backfill code treats all skill-like catalog rows the same (session history). Guard built-in slugs at the API boundary and at derivation time.
- A failed Strands smoke can be unrelated to workspace skill discovery, such as duplicate MCP tool names (session history). Isolate runtime discovery checks from unrelated tool registration failures.

## Related

- `docs/plans/2026-04-27-004-feat-skills-as-workspace-folder-plan.md`
- `docs/solutions/workflow-issues/workspace-defaults-md-byte-parity-needs-ts-test-2026-04-25.md`
- `docs/solutions/workflow-issues/agent-builder-smoke-cleanup-needs-manifest-regeneration-2026-04-26.md`
- `docs/solutions/workflow-issues/skill-catalog-slug-collision-execution-mode-transitions-2026-04-21.md`
- `docs/solutions/best-practices/activation-runtime-narrow-tool-surface-2026-04-26.md`
