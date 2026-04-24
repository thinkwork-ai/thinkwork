---
problem_type: runbook
severity: medium
module: packages/skill-catalog
tags:
  - mcp
  - deprecation
  - skill-catalog
  - migration
date: 2026-04-24
---

# Retiring `packages/skill-catalog/thinkwork-admin/`

The Python admin skill shipped 2026-04-22 was the first iteration of agent-accessible admin ops. PRs #480 → #487 replaced it with an MCP server (`POST /mcp/admin`) that wraps the same operations with per-tenant Bearer auth and a public URL (`mcp.thinkwork.ai` once the custom-domain dance completes). This doc captures the cutover steps so operators can retire the skill cleanly.

## Prereqs (before the deletion PR merges)

1. **MCP reachable for every tenant** — verify `thinkwork mcp provision --all -s <stage>` succeeded against every stage where agents run:
   ```bash
   thinkwork mcp provision --all -s dev
   thinkwork mcp provision --all -s prod   # when prod exists
   ```
   Each success creates a `tenant_mcp_servers` row with `slug="admin-ops"` + auth config referencing Secrets Manager.

2. **At least one agent per tenant has admin-ops enabled via MCP** — check via admin SPA's MCP → Agents tab, or:
   ```sql
   SELECT t.slug, t.name, count(ams.id) AS agents_with_admin_ops_mcp
   FROM tenants t
   JOIN tenant_mcp_servers tms ON tms.tenant_id = t.id AND tms.slug = 'admin-ops'
   LEFT JOIN agent_mcp_servers ams ON ams.mcp_server_id = tms.id AND ams.enabled = true
   GROUP BY t.id, t.slug, t.name
   ORDER BY agents_with_admin_ops_mcp DESC;
   ```
   If any tenant with enabled admin-skill agents has zero MCP-enabled agents, assign the server before retiring the skill.

3. **Count live Python-skill consumers** — any agent_skills row still enabled for the old skill is a breakage risk:
   ```sql
   SELECT count(*) AS enabled_rows
   FROM agent_skills
   WHERE skill_id = 'thinkwork-admin' AND enabled = true;
   ```
   Non-zero counts mean the next invocation of those agents will fail skill loading (the `scripts/` folder is gone). Run the retire SQL below first.

## Retire SQL (operator runs against each stage's Aurora)

```sql
-- Idempotent: disables remaining agent_skills + trims the skill from
-- agent_templates.skills JSONB array. Rows stay (audit), just flipped
-- off. Reversible via `UPDATE … SET enabled = true` if rollback needed.
BEGIN;

-- 1. Disable any agent_skills rows for the retired skill.
UPDATE agent_skills
   SET enabled = false, updated_at = now()
 WHERE skill_id = 'thinkwork-admin' AND enabled = true;

-- 2. Remove the skill from every template's skills list so newly-stamped
--    agents don't get it re-added.
UPDATE agent_templates
   SET skills = COALESCE(
     (SELECT jsonb_agg(elem) FROM jsonb_array_elements(skills) elem
      WHERE elem->>'skillId' IS DISTINCT FROM 'thinkwork-admin'
        AND elem->>'skill_id' IS DISTINCT FROM 'thinkwork-admin'
        AND elem IS DISTINCT FROM '"thinkwork-admin"'::jsonb),
     '[]'::jsonb
   )
 WHERE skills @? '$[*] ? (@.skillId == "thinkwork-admin" || @.skill_id == "thinkwork-admin")'
    OR skills @> '["thinkwork-admin"]'::jsonb;

COMMIT;
```

Run in dev first, verify both SELECTs return zero, then prod.

## What the PR deletes

- `packages/skill-catalog/thinkwork-admin/` — entire directory (SKILL.md, skill.yaml, scripts/, tests/).
- `packages/api/src/__tests__/thinkwork-admin-e2e-smoke.test.ts` — Python-skill-specific createAgent smoke test; the createAgent resolver is still covered by `agents-authz.test.ts` and `set-agent-skills-subset.test.ts`.
- Drops the `skill.yaml` regex-exclusion block from `packages/api/src/__tests__/never-exposed-tier.test.ts`. The `requireNotFromAdminSkill` guard itself stays — it applies to every non-Cognito auth path, not just the retired skill.

## What the PR keeps

- `requireNotFromAdminSkill`, `requireAdminOrApiKeyCaller`, `requireAgentAllowsOperation` — defensive primitives. They're useful even without the skill: peer skills and the agent-broker (Phase 2 work) both rely on the "service-auth can't reach catastrophic ops" posture.
- The shipped migrations (`0020`, `0022`) — historical record of what was applied. A down-migration would be reversible SQL, not file deletion.
- Comments in resolvers/handlers that mention the skill as historical context.
- `packages/api/src/__tests__/admin-authz.test.ts`, `templates-authz.test.ts`, etc. — test the resolver-side authz that survives the skill, applied to the MCP surface now.

## Rollback

If retirement causes an incident, reverse in this order:

1. Re-enable agent_skills rows:
   ```sql
   UPDATE agent_skills SET enabled = true WHERE skill_id = 'thinkwork-admin';
   ```
   (Old entries still reference the deleted `scripts/` folder — invocations will log skill-load errors and continue. Rollback only unblocks the data side.)

2. Revert the PR — restores the `scripts/` folder so the runtime can load the skill again.

3. If revert is impractical, cherry-pick the skill back from git history (`git show <sha>:packages/skill-catalog/thinkwork-admin/...`) and ship as a hotfix.

## Post-retirement verification

- `thinkwork mcp provision --all -s <stage>` still succeeds (unchanged).
- `curl -X POST -H 'Authorization: Bearer tkm_...' https://<api>/mcp/admin -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` returns the 28 admin-ops tools.
- A dev-stage chat turn where the target agent has admin-ops MCP assigned can still invoke tenants_get / teams_list / etc.
- `grep -r "thinkwork_admin\|skill-catalog/thinkwork-admin" packages/agentcore-strands/` returns zero non-comment hits (aside from docstrings describing history).
