---
title: "Agent Builder smoke cleanup must patch routing rows and regenerate manifest"
date: 2026-04-26
category: docs/solutions/workflow-issues/
module: apps/admin agent-builder workspace files
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "Cleaning up S3-backed agent workspace files after manual or UI smoke tests"
  - "Verifying Agent Builder sub-agent affordances against deployed admin"
  - "Editing workspace storage directly instead of using the workspace-files API"
tags: [agent-builder, workspace-files, s3, manifest, sub-agents, smoke-test]
---

# Agent Builder smoke cleanup must patch routing rows and regenerate manifest

## Context

The Agent Builder `agents` section is a synthetic UI grouping driven by the root
`AGENTS.md` routing table, not by a physical `agents/` storage prefix. A deployed
smoke test can therefore leave two kinds of state behind:

1. S3 objects such as `codex-agents-smoke/CONTEXT.md`
2. Routing rows in root `AGENTS.md` that make those folders appear under the
   synthetic `agents` section

After direct S3 cleanup, the workspace `manifest.json` also needs to be rebuilt.
The normal workspace-files API does this automatically, but direct `aws s3 rm`
and `aws s3 cp` commands bypass that helper. Session history confirmed this is
the existing codebase contract: `packages/api/workspace-files.ts` imports
`regenerateManifest`, and `packages/api/src/lib/workspace-manifest.ts` rebuilds
the runtime inventory from the current workspace prefix.

## Guidance

For deployed Agent Builder smoke tests, verify both the user-visible behavior
and the storage contract:

- Create the sub-agent through the deployed UI.
- Confirm it appears under the synthetic `agents` section.
- Confirm the seeded `CONTEXT.md` opens.
- Confirm root `AGENTS.md` gained the expected routing row.
- During cleanup, remove both the smoke files and the matching routing rows.
- Regenerate `manifest.json` after any direct S3 cleanup.
- Refresh the deployed UI and confirm the synthetic `agents` section is empty
  or contains only real routed sub-agents.

Prefer the workspace-files API for cleanup when practical because it already
regenerates the manifest and records the same mutations the UI would. If direct
S3 cleanup is faster or necessary, treat manifest regeneration as part of the
same operation, not as an optional follow-up.

## Why This Matters

Deleting only the folder object leaves stale routing rows, so the UI can still
render missing routed entries under `agents`. Removing only the routing row
leaves orphan workspace folders outside the synthetic group. Skipping manifest
regeneration can leave runtime or inventory consumers with stale file metadata
even though S3 has changed.

The visible UI can also be cached in the browser after direct storage work.
Storage verification should come first (`aws s3api list-objects-v2` plus an
`AGENTS.md` read), then a browser refresh confirms the deployed admin reflects
the cleaned state.

## When to Apply

- After creating temporary sub-agents such as `codex-agents-smoke/` or
  `codex-subagent-test/`
- After smoke folders with nested inbox files such as `smoke-test/work/inbox/*`
- Any time an agent workspace is edited with raw S3 commands
- Any feature where a UI grouping is derived from a map file rather than a
  physical folder prefix

## Examples

The cleanup pattern for Marco's deployed Agent Builder smoke test was:

```bash
PREFIX='tenants/<tenant-slug>/agents/<agent-slug>/workspace'
BUCKET='thinkwork-dev-storage'

aws s3 cp "s3://${BUCKET}/${PREFIX}/AGENTS.md" /tmp/AGENTS-before-cleanup.md

awk '
  $0 ~ /^\| Workspace orchestration smoke test \|/ { next }
  $0 ~ /^\| codex-subagent-test specialist \|/ { next }
  $0 ~ /^\| codex-agents-smoke specialist \|/ { next }
  { print }
' /tmp/AGENTS-before-cleanup.md > /tmp/AGENTS-after-cleanup.md

aws s3 cp /tmp/AGENTS-after-cleanup.md \
  "s3://${BUCKET}/${PREFIX}/AGENTS.md" \
  --content-type 'text/markdown'

aws s3 rm "s3://${BUCKET}/${PREFIX}/codex-agents-smoke/CONTEXT.md"
aws s3 rm "s3://${BUCKET}/${PREFIX}/codex-subagent-test/CONTEXT.md"
aws s3 rm "s3://${BUCKET}/${PREFIX}/smoke-test/AGENTS.md"
aws s3 rm "s3://${BUCKET}/${PREFIX}/smoke-test/CONTEXT.md"
aws s3 rm "s3://${BUCKET}/${PREFIX}/smoke-test/work/inbox/codex-smoke-20260425194513.md"
aws s3 rm "s3://${BUCKET}/${PREFIX}/smoke-test/work/inbox/codex-smoke-20260425194536.md"
aws s3 rm "s3://${BUCKET}/${PREFIX}/smoke-test/work/inbox/native-s3-smoke-20260426021629.md"
aws s3 rm "s3://${BUCKET}/${PREFIX}/smoke-test/work/inbox/native-s3-smoke-20260426023559.md"
```

Then rebuild `manifest.json` from the remaining objects under the same prefix.
The generated file should include every workspace-relative path except
`manifest.json` itself, with each object's ETag, size, and last-modified time.

Final verification should show:

- `aws s3api list-objects-v2 ... | rg 'codex-agents-smoke|codex-subagent-test|smoke-test'`
  returns no rows
- root `AGENTS.md` has only the routing table header, or only real routing rows
- the deployed builder shows `agents` with its empty-state Add affordance

## Related

- `docs/plans/2026-04-26-002-feat-agents-folder-reserved-name-plan.md`
- `docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md`
- `docs/solutions/workflow-issues/workspace-defaults-md-byte-parity-needs-ts-test-2026-04-25.md`
- `packages/api/src/lib/workspace-manifest.ts`
- `packages/api/workspace-files.ts`
