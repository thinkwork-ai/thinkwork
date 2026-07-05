---
title: Skill trust gate silently drops installed skills from the agent prompt
date: 2026-07-04
category: diagnostics
module: packages/api/src/lib/skill-trust, packages/agentcore-pi
problem_type: diagnostics
component: skill_runtime
severity: high
applies_when:
  - "An installed skill is being ignored — the agent free-hands the task instead of following SKILL.md"
  - "A skill was just published or its catalog content was edited"
  - "threadTurn.systemPrompt does not contain the skill's slug despite skills/<slug>/ existing in the workspace"
tags:
  [skills, trust-pipeline, runtime-gate, silent-failure, signature, content-sha]
---

# Skill trust gate silently drops installed skills from the agent prompt

## Context

During THINK-147 E2E validation, the `document-composer` skill was installed in the dev platform agent's workspace (`skills/document-composer/SKILL.md` present, catalog row green in the Skill Library) — yet two consecutive live turns produced free-handed output that ignored the skill entirely. `threadTurn.systemPrompt` contained no mention of `document-composer`. Nothing in the UI or the turn evidence flagged a problem; the only trace was a Lambda log line listing untrusted skill IDs.

## Root cause

`isCurrentPassedSkillTrustReport` (`packages/api/src/lib/skill-trust/runtime-gate.ts`) gates prompt injection on a conjunction, and **every** clause must hold:

1. `trust_report.status = passed`
2. spec check `passed`
3. scanner `completed`
4. signature evidence `verified` **or** `approved_unverified`
5. `trust_report_content_sha == content_sha` (current catalog content hash)
6. pipeline version == current (`thinkwork-skill-trust-v1`)

Round 1 failed on (1) — no trust report at all (the skill had been synced to the catalog by hand, bypassing the draft-publish flow). Round 2 failed on (4): trust had been re-run and passed, but signature evidence was missing — passing trust does **not** produce signature evidence by itself. The failure mode is fail-closed and silent in both cases.

Also note: workspace-defaults seeding is not catalog publication. Skills under `agents/_catalog/defaults/workspace/skills/` reach only _newly bootstrapped_ agent workspaces; they never appear in the tenant catalog or Skill Library on their own.

## Diagnosis

1. Confirm the skill's slug is absent from the turn's `systemPrompt` (GraphQL `threadTurn`).
2. Check the full gate predicate in the tenant DB:

   ```sql
   SELECT s.slug, tr.status, tr.spec_status, tr.scanner_status,
          tr.signature_status, tr.content_sha = s.content_sha AS sha_current,
          tr.pipeline_version
   FROM skill_catalog s LEFT JOIN skill_trust_reports tr ON ...
   WHERE s.slug = '<slug>';
   ```

   Anything other than `passed | passed | completed | verified-or-approved_unverified | t | thinkwork-skill-trust-v1` is the answer.

## Remediation

Via the workspace-files API (`POST /api/workspaces/files`):

```json
{ "action": "run-skill-trust", "catalog": true, "slug": "<slug>" }
{ "action": "fix-skill-trust-evidence", "step": "signature", "slug": "<slug>" }
```

Run **both**, in that order, after **any** catalog content change — editing any file in the pack stales the content SHA and re-opens the gate. The proper publish path (skill-draft flow: create → files → currentContentHash → submit → publish) runs trust as part of publication; its strict YAML parser also rejects unquoted frontmatter descriptions containing colons, which the lenient catalog indexer accepts.

## Prevention

- Publish skills through the draft flow, not raw S3 sync + index rebuild.
- After any skill content edit, re-verify the gate predicate before declaring the change live.
- Product gap (THINK-160): default skills should auto-publish + auto-trust on deploy; until then, every new tenant needs the manual runbook (`docs/solutions/runbooks/publish-default-skill-to-tenant-catalog-2026-07-04.md`).
