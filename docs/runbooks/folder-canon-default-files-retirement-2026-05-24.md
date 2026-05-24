# Folder Canon Default Files Retirement

This runbook records the operator follow-up for retiring the four legacy root
contract files from tenant default catalogs after the consolidated `AGENTS.md`
substrate has deployed.

## Scope

Files to remove from each tenant defaults prefix after the deployment containing
the consolidated `AGENTS.md` is live:

- `_catalog/defaults/workspace/SOUL.md`
- `_catalog/defaults/workspace/IDENTITY.md`
- `_catalog/defaults/workspace/PLATFORM.md`
- `_catalog/defaults/workspace/CAPABILITIES.md`

Do not delete tenant agent-prefix copies in this step. Existing tenant agent
trees are migrated by the folder-canon migration script in the later migration
unit; this defaults cleanup only prevents future bootstrap/materialization paths
from rediscovering the retired defaults.

## Preconditions

- `packages/workspace-defaults` default content includes the new consolidated
  `AGENTS.md` with `## Personality`, `## Identity`, and
  `## Platform Behavior`.
- `bootstrapAgentWorkspace()` excludes the four retired root files for fresh
  agent prefixes.
- `PINNED_FILES` contains only `GUARDRAILS.md`.
- No manual production mutation is performed outside the normal reviewed
  deployment and approved operator migration window.

## Dry Run

For each stage and tenant, list the candidate keys first:

```bash
aws s3 ls "s3://$WORKSPACE_BUCKET/tenants/$TENANT_SLUG/agents/_catalog/defaults/workspace/" \
  | rg "SOUL.md|IDENTITY.md|PLATFORM.md|CAPABILITIES.md"
```

Expected result before cleanup: the four keys are present. Expected result
after cleanup: no matches.

## Apply

Run only after the deployment has landed and the operator has confirmed the dry
run output:

```bash
for file in SOUL.md IDENTITY.md PLATFORM.md CAPABILITIES.md; do
  aws s3 rm "s3://$WORKSPACE_BUCKET/tenants/$TENANT_SLUG/agents/_catalog/defaults/workspace/$file"
done
```

Repeat per tenant. If a key is already absent, treat it as a no-op.

## Verification

```bash
aws s3 ls "s3://$WORKSPACE_BUCKET/tenants/$TENANT_SLUG/agents/_catalog/defaults/workspace/" \
  | rg "SOUL.md|IDENTITY.md|PLATFORM.md|CAPABILITIES.md" || true
```

The verification command should print no retired filenames. Fresh agent
bootstrap should write `AGENTS.md`, `CONTEXT.md`, `GUARDRAILS.md`, and `USER.md`
without recreating the four retired root files.
