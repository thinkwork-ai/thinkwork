---
title: Update user documentation for Spaces and the tenant agent framework
status: active
created: 2026-05-23
origin: user request
---

# Update user documentation for Spaces and the tenant agent framework

## Problem frame

The application now uses a single tenant platform agent with Space-scoped context and runtime overrides. Several user-facing docs still describe the retired per-agent roster, per-agent runtime selection, per-agent email addresses, and template-driven fleet operations as the primary model. The docs need to match the current operator and end-user experience.

## Scope

Update public documentation under `docs/src/content/docs/` and the docs sidebar in `docs/astro.config.mjs`.

In scope:

- Explain the tenant platform agent as the baseline agent identity for a tenant.
- Document the Admin Tenant Agent page and its Config, Workspace, and Sub-agents tabs.
- Document Spaces as contextual workrooms with configuration, workspace, tools, memory, automations, email triggers, and runtime overrides.
- Replace stale per-agent routing language in conceptual agent and thread docs.
- Update mobile thread/chat documentation to describe Space-scoped chat rather than per-agent workspace selection.
- Keep legacy template pages honest by clarifying their relationship to the platform-agent/Space model.

Out of scope:

- Product or runtime behavior changes.
- Regenerating API reference from GraphQL.
- Deployment docs unrelated to user-facing Spaces, threads, tenant agent configuration, or mobile chat.

## Existing patterns to follow

- Docs are Astro Starlight pages with frontmatter and short conceptual sections.
- Existing user docs prefer route names, operator workflows, known limits, and related-page links.
- Sidebar entries live in `docs/astro.config.mjs`.

## Implementation units

### Unit 1: Admin docs and sidebar

Files:

- `docs/astro.config.mjs`
- `docs/src/content/docs/applications/admin/index.mdx`
- `docs/src/content/docs/applications/admin/agents.mdx`
- `docs/src/content/docs/applications/admin/spaces.mdx`

Requirements:

- Rename the admin sidebar and overview language from the retired agent roster to Tenant Agent.
- Add a Spaces page to the admin docs and sidebar.
- Document `/tenant-agent`, `/spaces`, and `/spaces/:spaceId/*` workflows.
- Document Space email trigger behavior and runtime override inheritance.

Verification:

- `pnpm --filter @thinkwork/docs build`

### Unit 2: Concept docs

Files:

- `docs/src/content/docs/concepts/agents.mdx`
- `docs/src/content/docs/concepts/agents/runtime-selection.mdx`
- `docs/src/content/docs/concepts/agents/templates.mdx`
- `docs/src/content/docs/concepts/spaces.mdx`
- `docs/src/content/docs/concepts/threads.mdx`
- `docs/src/content/docs/concepts/threads/routing-and-metadata.mdx`

Requirements:

- Reframe Agents around the tenant platform agent, sub-agent workspace folders, and Space runtime overrides.
- Add a Spaces concept page.
- Replace per-agent runtime-selection guidance with tenant-agent and Space runtime configuration guidance.
- Clarify that templates are legacy/reusable authoring infrastructure rather than the primary tenant-agent operation surface.
- Update thread routing examples so inbound email and channel work route through Spaces and the tenant platform agent.

Verification:

- `pnpm --filter @thinkwork/docs build`

### Unit 3: Mobile and related user docs

Files:

- `docs/src/content/docs/applications/mobile/threads-and-chat.mdx`

Requirements:

- Describe the Threads tab as Space-aware.
- Replace active-agent workspace picker wording with Space picker wording.
- Keep HITL review behavior accurate while avoiding retired human-paired agent assumptions.

Verification:

- `pnpm --filter @thinkwork/docs build`

## Risks

- Some older agent-template surfaces still exist in code. The docs should avoid claiming they are removed unless the UI actually removed them.
- The CLI may still expose retired agent commands as stubs. User docs should direct operators to Admin Tenant Agent and Spaces unless a verified CLI command exists.
