---
title: "Runbook: publish a default skill to a tenant catalog and pass the trust gate"
date: 2026-07-04
category: runbooks
problem_type: runbook
severity: medium
module: packages/api workspace-files API, packages/workspace-defaults
applies_when:
  - "A workspace-default skill (e.g. document-composer) must become live on an existing tenant"
  - "A new customer stack needs default skills that predate its bootstrap"
  - "A default skill's content changed and every tenant needs the update"
tags:
  [skills, trust-pipeline, tenant-catalog, workspace-files-api, apikey, runbook]
---

# Runbook: publish a default skill to a tenant catalog and pass the trust gate

Executed manually three times on 2026-07-04 (dev, TEI, McPherson) for `document-composer`. THINK-160 tracks automating this on deploy; until then this is the procedure.

Workspace-defaults seeding is **not** publication: defaults reach only newly-bootstrapped agent workspaces. An existing tenant needs the skill in its catalog, trust-passed, signed, and installed.

## Prerequisites

- Tenant identifiers: tenant ID, agent ID, owner principal ID (query `tenant_members` for the owner).
- `API_AUTH_SECRET` from the stage's `graphql-http` Lambda environment (`aws lambda get-function-configuration`).
- API base URL for the stage.

## Steps

### 1. Sync the skill into the tenant catalog

```bash
aws s3 sync packages/workspace-defaults/files/skills/<slug>/ \
  "s3://<workspace-bucket>/tenants/<tenant-slug>/skill-catalog/<slug>/"
```

### 2. Rebuild the catalog index

Upsert the `skill_catalog` row (via `rebuildSkillCatalogIndex` / the catalog-index endpoint) so the Skill Library sees it. The content SHA is `computeCatalogSkillSha`: sha256 over sorted `relativePath\0sha256hex(content)\n` lines.

### 3. Run the trust pipeline — BOTH steps

Against `POST <api>/api/workspaces/files` with headers:

```
x-api-key: <API_AUTH_SECRET>
x-tenant-id: <tenant-id>
x-principal-id: <owner-principal-id>   # apikey asserted identity; required for tenant-admin checks
```

Bodies, in order:

```json
{ "action": "run-skill-trust", "catalog": true, "slug": "<slug>" }
{ "action": "fix-skill-trust-evidence", "step": "signature", "slug": "<slug>" }
```

Trust passing does **not** create signature evidence; the runtime gate requires both. Re-run both after any content change.

### 4. Install to the platform agent

Same endpoint, add `x-agent-id: <agent-id>` header (required for apikey agent-target writes):

```json
{
  "action": "install-skill",
  "agentId": "<agent-id>",
  "slug": "<slug>",
  "wiring_choice": "always-on"
}
```

`wiring_choice` is the slugified heading from the skill's WIRING.md.

### 5. Verify the gate is green

```sql
SELECT tr.status, tr.signature_status, tr.spec_status, tr.scanner_status,
       tr.content_sha = s.content_sha AS sha_current, tr.pipeline_version
FROM ...
```

Expect `passed | verified-or-approved_unverified | passed | completed | t | thinkwork-skill-trust-v1`, then confirm the skill slug appears in a live turn's `threadTurn.systemPrompt`.

## Gotchas

- **401 Unauthorized** → expired token/secret; re-resolve `API_AUTH_SECRET` or refresh the session (`thinkwork me`).
- **"Caller is not a tenant admin or owner"** → missing `x-principal-id` header.
- **"slug and wiring_choice are required"** → the install body needs `wiring_choice`.
- **"malformed YAML frontmatter" on the draft-publish path** → the strict parser rejects unquoted `description` values containing colons; quote them (the lenient catalog indexer accepts them, so this only surfaces at publish).
- Silent-skip failure mode and gate details: `docs/solutions/diagnostics/skill-trust-gate-silently-drops-skills-2026-07-04.md`.
