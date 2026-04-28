---
title: "Injected built-in tools are not workspace skills"
date: 2026-04-28
category: docs/solutions/best-practices/
module: agent-runtime-capabilities
problem_type: best_practice
component: assistant
severity: high
applies_when:
  - "A capability appears skill-like in admin UI but is owned by platform runtime code"
  - "A built-in tool needs tenant or template configuration before it can be registered"
  - "A workspace skills backfill risks copying platform tools into workspace/skills"
  - "A hand-rolled template configuration migration ships with runtime code"
related_components:
  - database
  - tooling
  - development_workflow
tags:
  - builtin-tools
  - workspace-skills
  - web-search
  - send-email
  - agentcore
  - template-config
  - migration-drift
---

# Injected built-in tools are not workspace skills

## Context

ThinkWork has two capability shapes that can look similar in the UI but must stay separate at runtime:

- Workspace skills are editable filesystem content under `workspace/skills/<slug>/SKILL.md`.
- Built-in tools are platform-owned runtime tools injected from tenant, template, and agent policy.

The distinction mattered when `web_search` and `send_email` were both presented as capability-like features. `web_search` is still a skill-shaped model capability, but it is injected from provider configuration rather than copied into the workspace. `send_email` is a direct platform tool that calls the ThinkWork email API and needs per-turn context such as the agent email address, tenant, thread, and API secret. Neither belongs in `workspace/skills/`.

## Guidance

Treat platform-owned tools as injected built-ins, even when the operator UI lists them beside skills.

Use this boundary:

- If an operator should edit the instructions or source file, store it under `workspace/skills/<slug>/SKILL.md`.
- If the platform owns the implementation, credentials, policy, or request context, inject it as a runtime tool.
- Put the opt-in/default-on control on the agent template configuration, not in workspace files.
- Keep built-in tool slugs in `packages/api/src/lib/builtin-tool-slugs.ts` so install, list, derive, and backfill flows can filter them consistently.
- Make runtime config the handoff point from API policy to Strands/Pi registration.

For PR #670, `agent-email-send` became a blocked workspace skill slug and the runtime now injects `send_email` directly when template policy allows it. The Admin template page owns the default-on toggle, while Strands and Pi own tool registration.

## Why This Matters

Copying built-ins into `workspace/skills/` creates the wrong source of truth. Operators can see or preserve the file as editable user content, workspace backfills can re-create it, and `agent_skills` derivation can make a disabled or policy-gated tool look active.

Injected built-ins also often need data that a static skill file should not carry:

- Provider API keys or service secrets.
- Tenant and agent IDs.
- The active thread ID.
- Inbound email reply context.
- Template-level enablement or blocked-tool policy.

Keeping these in runtime config avoids stale files, credential leakage, and partial policy enforcement.

## When to Apply

- A capability is backed by platform code instead of a user-editable `SKILL.md`.
- The tool requires tenant secrets, API callbacks, or per-turn context.
- A template should enable or disable a capability for all agents using that template.
- A repair/backfill is about populating workspace skills folders but must not install platform tools.
- A deploy adds a hand-rolled template config migration such as `agent_templates.web_search` or `agent_templates.send_email`.

## Examples

Built-in tool filtering should happen at API boundaries, not only in UI:

```ts
export const BUILTIN_TOOL_SLUGS = ["web-search", "agent-email-send"] as const;
```

Runtime config should pass direct tool config separately from workspace skill config:

```ts
return {
  skillsConfig,
  webSearchConfig,
  sendEmailConfig,
};
```

The Strands/Pi runtime then registers a direct tool from that config:

```py
if send_email_config:
    tools.append(build_send_email_tool(send_email_config=send_email_config))
```

Do not create any of these files during backfill:

```text
workspace/skills/web-search/SKILL.md
workspace/skills/agent-email-send/SKILL.md
```

## Deploy Note

Template configuration for a new built-in often needs an additive hand-rolled migration. The deploy can build and update Lambdas/AgentCore successfully but still fail the drift gate until the new SQL has been applied to the dev database.

The recovery sequence for PR #670 was:

```bash
source scripts/smoke/_env.sh >/dev/null
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0045_add_send_email_template_config.sql
pnpm db:migrate-manual
gh run rerun <deploy-run-id> --failed
```

After the rerun, the deploy passed runtime image verification, composed-tree smoke, and migration drift check.

## Related

- `docs/solutions/architecture-patterns/workspace-skills-load-from-copied-agent-workspace-2026-04-28.md`
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
- `docs/solutions/best-practices/activation-runtime-narrow-tool-surface-2026-04-26.md`
- `docs/plans/2026-04-27-004-feat-skills-as-workspace-folder-plan.md`
- PR #670: `feat: inject send email tool by template`
