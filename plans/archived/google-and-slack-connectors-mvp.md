# PRD: Google and Slack Connectors MVP

**Status:** Draft
**Owner:** Eric Odom
**Last updated:** 2026-04-14

---

## 1. Summary

This PRD defines the MVP connector model for Google and Slack in ThinkWork.

It locks in three product decisions:

- **Google is a personal connection**. A user connects their own Google account and ThinkWork uses that connection for personal tool access and later wakeups on that user's behalf.
- **Slack is a workspace install plus agent bindings**. A Slack app is installed once per Slack workspace. After install, many ThinkWork agents can be bound under that workspace, each with different triggers, channels, behaviors, and response policies.
- **GitHub is roadmap only for this phase**. We should not shape the MVP data model or UI around GitHub yet beyond leaving room for another workspace-level integration later.

The implementation consequence is important: **Slack is not a normal per-agent OAuth skill**, and the current Google-flavored OAuth flow is useful infrastructure but too agent-centric as the final Connectors product shape.

---

## 2. Problem

The current implementation and docs blur together several different concepts:

- user-owned OAuth connections
- agent skill installs
- connector routing
- workspace integrations

That is survivable for Google because user OAuth plus later agent use is close to the product truth. It is not survivable for Slack.

Today, the system is biased toward:

- `connections` owned by `(tenant_id, user_id, provider)`
- OAuth initiated from an agent skill configuration flow
- post-OAuth linking directly into `agent_skills`
- docs that suggest a connector can have a single default agent and optional routing rules

That model breaks down for the Slack direction we actually want:

- one Slack workspace may need many ThinkWork agents
- different people may want different agents watching different channels or events
- those agents may behave differently, route differently, and respond differently
- thread identity must account for `agent_id` or multiple agents will collide on the same Slack conversation

So the MVP needs a cleaner split:

- **personal connections** for Google
- **workspace installs** for Slack
- **agent bindings** layered on top of a Slack install

---

## 3. Product decisions

### 3.1 Google

Google is a **personal/user OAuth connection**.

Use cases in MVP:

- connect Gmail and Calendar for a specific user
- let an agent use those tools on that user's behalf
- support later wakeups, sync, and event-driven flows tied back to that connected user

Product framing:

- belongs under **Personal Connections**
- one user can connect their own Google account
- that connection may later be granted to one or more agents or skills
- the connection itself is not owned by any one agent

### 3.2 Slack

Slack is a **workspace-level install** with **many agent bindings**.

Use cases in MVP:

- install ThinkWork into a Slack workspace once
- choose which agents are active in which channels, DMs, mentions, or event routes
- allow multiple agents under the same workspace install, with distinct behavior

Product framing:

- belongs under **Workspace Installs**
- install is owned by the tenant/workspace admin context, not by a single user and not by a single agent
- each Slack-bound agent gets its own binding record and routing config
- there is no MVP concept of “the Slack default agent for the workspace” as the primary frame

A fallback binding may exist later, but it must not define the core model.

### 3.3 GitHub

GitHub is explicitly **roadmap** for this PRD.

Implications:

- do not build GitHub-specific UI in this MVP
- do not complicate Slack and Google decisions to preserve imagined GitHub parity
- do leave room for another workspace-level install pattern later, likely similar to Slack in ownership shape

---

## 4. Goals

- Ship a clear Connectors MVP that users can understand in the admin UI.
- Make Google connections user-centric instead of agent-centric.
- Make Slack installs workspace-centric with many bound agents.
- Support inbound Slack conversation handling without multi-agent thread collisions.
- Reuse the current OAuth/token machinery where it helps.
- Avoid hard-coding the current agent-skill OAuth flow as the final product abstraction.

---

## 5. Non-goals

- No GitHub connector implementation in this phase.
- No attempt to unify Slack and Google into one identical data model.
- No assumption that every connector is an OAuth skill attached directly to one agent.
- No universal routing engine for every future integration. Only what Slack MVP needs.
- No broad workflow builder for connector automations.
- No full Slack app marketplace surface or enterprise admin controls.

---

## 6. UX and information architecture

## 6.1 Connectors entry point

Create a top-level **Connectors** area in admin with two explicit sections:

1. **Personal Connections**
   - Google
   - later other user-owned OAuth connections

2. **Workspace Installs**
   - Slack
   - later GitHub, other tenant/workspace installs

This distinction matters more than provider grouping.

## 6.2 Google UX

Google should read like:

- “Connect your Google account”
- status of Gmail / Calendar scopes
- which agents can use this connection
- reconnect / disconnect / scope upgrade

Do not present Google as “add Google skill to this agent” as the primary information architecture.

Agent assignment can still be reachable from agent config, but the source of truth should live in Connectors.

## 6.3 Slack UX

Slack should read like:

- “Install Slack for this workspace”
- workspace install status
- connected Slack workspace metadata
- signing secret / bot token health
- list of **agent bindings** under that install

Each Slack binding should let an admin configure:

- agent
- enabled status
- allowed channels or channel patterns
- DM support yes/no
- mention handling yes/no
- event types enabled in MVP
- posting identity / response policy
- optional trigger filters

Recommended layout:

- **Workspace Installs → Slack → [workspace]**
  - Install details
  - Agent bindings table
  - Add binding button
  - Per-binding edit drawer/page

## 6.4 Agent config UX

`AgentConfigSection.tsx` should stop being the main home for connector ownership.

Instead:

- Google-related controls in agent config should become “grant access to an existing personal connection” or deep-link into Connectors.
- Slack-related controls in agent config should become “add Slack binding” or show existing bindings for this agent, backed by the workspace install.

The admin mental model should be:

- connections exist first
- agents are granted or bound onto them second

---

## 7. Data model proposal

## 7.1 Reuse what exists

### Keep using `connect_providers`

This remains the provider catalog.

Use it to distinguish at least:

- `google_productivity`
- `slack`

Add provider metadata indicating ownership shape, for example in `config`:

- `connection_scope: "user" | "workspace"`
- `product_surface: "personal_connection" | "workspace_install"`

### Keep using `connections` for Google

Current `connections` is a good base for Google because it already models:

- tenant
- user
- provider
- status
- metadata
- external account id

For Google MVP, keep this table as the canonical user connection record.

### Keep using `credentials`

Continue storing credential references there for OAuth secrets and rotated credentials. This is good shared infrastructure.

### Keep using `threads`

The existing `threads.agent_id` field is load-bearing for Slack. Slack thread mapping must use it as part of identity so multiple agents can work in the same Slack workspace without stepping on each other.

---

## 7.2 Gaps in the current model

Current `connections.user_id NOT NULL` is wrong for Slack workspace installs.

A Slack workspace install is not fundamentally “a user's connection”. Even if a user initiates install, the durable object belongs to the tenant's Slack workspace relationship.

Current `oauth-callback` behavior also directly links some OAuth flows into `agent_skills`, which is wrong for Slack and too narrow even for Google.

---

## 7.3 Proposed new entities

### A. `workspace_installs`

New table for tenant-scoped installs.

Suggested fields:

- `id`
- `tenant_id`
- `provider_id`
- `status` (`pending`, `active`, `disabled`, `error`)
- `external_workspace_id` (Slack team id)
- `external_workspace_name`
- `installed_by_user_id` nullable
- `metadata` JSONB
- `connected_at`
- `disconnected_at`
- timestamps

Why:

- avoids overloading `connections`
- cleanly models Slack now and GitHub later
- lets Google stay personal without compromise

### B. `workspace_install_credentials`

Option 1: reuse `credentials` with a nullable `workspace_install_id` and nullable `connection_id`.

Option 2, preferred for cleanliness: add a dedicated table:

- `id`
- `workspace_install_id`
- `tenant_id`
- `credential_type` (`bot_token`, `signing_secret`, `oauth2`, etc.)
- `encrypted_value`
- `expires_at`
- timestamps

Recommendation: **prefer dedicated `workspace_install_credentials`** if we want to avoid making `credentials` polymorphic right now. It is simpler for an implementation agent.

### C. `slack_agent_bindings`

New table for many agents under one Slack install.

Suggested fields:

- `id`
- `tenant_id`
- `workspace_install_id`
- `agent_id`
- `status` (`active`, `paused`, `disabled`)
- `binding_type` (`channel`, `dm`, `mention`, `all_dm`, etc.)
- `channel_ids` JSONB nullable
- `channel_patterns` JSONB nullable
- `respond_to_mentions` boolean
- `respond_in_dms` boolean
- `can_initiate_posts` boolean
- `priority` integer
- `config` JSONB for response behavior
- timestamps

Unique/index guidance:

- index on `(workspace_install_id, agent_id)`
- index on `(tenant_id, status)`
- likely unique constraint preventing duplicate equivalent bindings for same install/agent/channel mode

### D. `slack_thread_bindings`

New table for deterministic Slack conversation mapping.

Suggested fields:

- `id`
- `tenant_id`
- `workspace_install_id`
- `agent_id`
- `thread_id`
- `slack_team_id`
- `slack_channel_id`
- `slack_thread_ts`
- `slack_root_ts`
- `slack_user_id` nullable
- `status`
- timestamps

Unique constraint should include agent identity:

- unique `(workspace_install_id, agent_id, slack_channel_id, slack_thread_ts)`

This is the most explicit way to avoid multi-agent collisions.

If we want less schema, this mapping can live in `threads.metadata` for MVP, but that is the riskier shortcut. Recommendation: **add the dedicated mapping table**.

### E. Optional `connection_grants` or `agent_connection_grants`

For Google, we likely need a clean way to attach personal connections to multiple agents without implying ownership.

Suggested fields:

- `id`
- `tenant_id`
- `connection_id`
- `agent_id`
- `scope` / `permissions` JSONB
- timestamps

This is better long-term than encoding all Google linkage through `agent_skills.config.connectionId`.

For MVP, we can continue using `agent_skills.config.connectionId` as a transitional bridge, but the PRD should frame it as an implementation shortcut, not the product truth.

---

## 8. Runtime and event architecture

## 8.1 Google runtime model

Google flow should be:

1. User connects Google under Personal Connections.
2. OAuth callback stores tokens against the personal connection.
3. One or more agents are granted use of that connection.
4. At runtime, skill/tool execution resolves the granted personal connection for the acting user or configured agent grant.
5. Wakeups and event processors resolve back to the owning user connection.

The current `oauth-token.ts` patterns are useful and should be preserved:

- shared token refresh
- provider-native user lookup
- env override construction for runtime

But the ownership model should shift from:

- “agent installed a Google skill and now has a token”

to:

- “user connected Google, and ThinkWork can grant specific agents access to that connection”

## 8.2 Slack inbound architecture

Slack flow should be:

1. Tenant admin installs Slack once.
2. OAuth callback stores bot token and install metadata on `workspace_installs`.
3. Signing secret is stored for webhook verification.
4. Admin creates one or more Slack agent bindings.
5. Incoming Slack event is validated against the workspace install.
6. Routing resolves candidate bindings for that channel / DM / mention event.
7. For each chosen binding, ThinkWork loads or creates a ThinkWork thread bound to `(workspace_install_id, agent_id, slack conversation)`.
8. The correct agent handles the turn.
9. Outbound post uses the workspace install credentials.

## 8.3 Routing rule for Slack MVP

Slack routing in MVP should not be a general connector-rules engine first.

It should be a deterministic binding matcher with simple filters:

- channel match
- DM flag
- mention flag
- optional priority ordering

If multiple bindings match the same event, we need an explicit policy.

Recommendation for MVP:

- either allow only one active binding per exact route shape
- or pick highest priority and log the conflict

Do not fan one Slack message out to multiple agents by default in MVP.

## 8.4 Thread mapping and `agent_id`

This is non-negotiable.

A Slack conversation cannot map to a single ThinkWork thread globally across the workspace if multiple agents may participate differently.

The mapping key must include `agent_id`.

Recommended identity:

- `(workspace_install_id, agent_id, slack_channel_id, slack_thread_ts_or_root_ts)`

And the created ThinkWork thread must set:

- `threads.channel = "slack"`
- `threads.agent_id = matched agent`
- `threads.metadata` with Slack source metadata

This prevents one agent from accidentally resuming another agent's Slack thread.

## 8.5 Slack outbound architecture

Outbound posting should resolve from the thread or binding back to:

- `slack_thread_bindings`
- `slack_agent_bindings`
- `workspace_installs`
- workspace install credentials

Do not store Slack bot tokens in agent config.

---

## 9. Implementation sequence

## Phase 1: product and schema foundation

- Add provider metadata for personal vs workspace connection shape.
- Add `workspace_installs`.
- Add Slack credential storage path.
- Add `slack_agent_bindings`.
- Add `slack_thread_bindings`.
- Optionally add `agent_connection_grants` for Google, or explicitly defer and use transitional config.

## Phase 2: Connectors IA and admin UI

- Add Connectors top-level area with Personal Connections and Workspace Installs.
- Move Google connection UX out of agent-first framing.
- Add Slack install detail page and agent bindings management UI.
- Make agent config deep-link to these connector surfaces instead of owning them.

## Phase 3: Google integration cleanup

- Keep current OAuth authorize/callback/token refresh machinery.
- Refactor callback paths so Google connection creation is not conceptually an agent install.
- Preserve transitional compatibility for current `agent_skills` linkage where needed.

## Phase 4: Slack install and event ingestion

- Implement Slack OAuth install callback into `workspace_installs`.
- Store bot token and signing secret.
- Build Slack event handler.
- Implement binding matcher.
- Implement thread mapping keyed by `agent_id`.
- Implement outbound posting.

## Phase 5: docs and migration cleanup

- Update docs so Connectors no longer present Slack as “set a default agent and optional routing rules” as the primary story.
- Update Google docs so it reads as a personal connection first.
- Mark GitHub as roadmap.

---

## 10. Concrete file and module touchpoints

Likely touchpoints for the implementation agent:

### Docs

- `docs/src/content/docs/concepts/connectors.mdx`
  - split personal connections vs workspace installs
  - remove Slack-as-default-agent framing
- `docs/src/content/docs/concepts/connectors/integrations.mdx`
  - revise Slack and Google sections to match this PRD

### Database schema

- `packages/database-pg/src/schema/integrations.ts`
  - keep providers and Google connections
  - likely add provider metadata for ownership shape
  - possibly add or reference workspace install tables
- `packages/database-pg/src/schema/threads.ts`
  - no major ownership change, but document Slack thread metadata usage
- `packages/database-pg/src/schema/agents.ts`
  - if adding Google grants or binding relations, likely touched here or nearby
- new schema files or additions for:
  - `workspace_installs`
  - `workspace_install_credentials`
  - `slack_agent_bindings`
  - `slack_thread_bindings`
  - optional `agent_connection_grants`

### API handlers and libs

- `packages/api/src/handlers/oauth-authorize.ts`
  - stop assuming all OAuth authorize flows are user+agent skill flows
  - support Slack workspace install flow separately
- `packages/api/src/handlers/oauth-callback.ts`
  - branch Google personal connection callback vs Slack workspace install callback
  - remove direct agent-skill linkage as the primary model
- `packages/api/src/lib/oauth-token.ts`
  - keep shared token refresh patterns for Google
  - add workspace-install credential resolution path as needed
- likely new Slack modules, for example:
  - `packages/api/src/handlers/slack-events.ts`
  - `packages/api/src/integrations/slack/*`
  - binding matcher / thread resolver / outbound sender

### Admin UI

- `apps/admin/src/components/agents/AgentConfigSection.tsx`
  - downgrade connector ownership role
  - deep-link to connector resources
  - show grants/bindings instead of raw OAuth ownership where possible
- likely new Connectors pages/components for:
  - personal Google connections
  - Slack install management
  - Slack agent bindings table/editor

---

## 11. Acceptance criteria

This MVP is successful when:

1. A user can connect Google as a personal connection without needing to think in terms of “installing a Google skill into one agent”.
2. An admin can install Slack once for a workspace.
3. An admin can bind multiple different ThinkWork agents under that Slack install.
4. Each Slack binding can target distinct channels / DM / mention behavior.
5. Incoming Slack events resolve to the correct binding and agent.
6. Slack thread mapping includes `agent_id`, preventing cross-agent collisions.
7. Outbound Slack replies use workspace install credentials, not per-agent tokens.
8. Existing Google token refresh and wakeup behavior still works.
9. Docs and UI clearly distinguish Personal Connections from Workspace Installs.
10. GitHub is presented as roadmap, not half-included in the MVP surface.

---

## 12. Tradeoffs and recommendations

### Recommendation 1: do not force Slack into `connections`

We could try to stretch `connections` to support both user and workspace installs by making `user_id` nullable and stuffing more metadata into JSON.

I do not recommend that for MVP.

It creates ambiguity at the exact moment we need clarity. A dedicated `workspace_installs` table is the cleaner move and makes GitHub easier later.

### Recommendation 2: treat current Google agent-skill flow as transitional

The current flow is useful infrastructure, especially:

- OAuth initiation
- callback exchange
- credential storage
- token refresh
- runtime env injection

But product-wise it is too agent-centric. Keep the machinery, change the ownership model.

### Recommendation 3: add explicit Slack binding and thread mapping tables

We could push binding and thread linkage into JSON blobs on installs or threads.

I do not recommend it. Slack is the first integration where multi-agent routing matters structurally. Explicit tables will save time and bugs.

---

## 13. Open questions

- Should Google grants be modeled in a new `agent_connection_grants` table immediately, or can we ship MVP with `agent_skills.config.connectionId` as a bridge?
  - Recommendation: bridge if needed, but document it as transitional.
- Should Slack bindings support only channel ids in MVP, or also DMs and mentions from day one?
  - Recommendation: include channels, DMs, and mentions because they materially affect product shape.
- Should multiple bindings ever match one Slack event in MVP?
  - Recommendation: no. Enforce one winner.
- Should workspace install credentials reuse `credentials` polymorphically or get a dedicated table?
  - Recommendation: dedicated table if we want the cleanest implementation path.

---

## 14. Bottom line

ThinkWork should stop pretending every connector is just an agent-owned OAuth skill.

For MVP:

- **Google is a personal connection** that agents can be granted access to.
- **Slack is one workspace install with many agent bindings** layered on top.
- **GitHub is roadmap**.

That gives us a connector model that matches the product we actually want to build, keeps the useful OAuth/token plumbing we already have, and avoids a bad Slack architecture that would collapse multiple agents into one default-agent story.