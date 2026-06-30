---
date: 2026-06-29
topic: apps-surface-twenty-engagement-dashboard
focus: "Incorporate the engagement dashboard into ThinkWork as part of the Twenty CRM plugin; create a main-shell Apps surface for installed plugin applications."
mode: repo-grounded
status: active
source_branch: origin/feat/engagement-dashboard
---

# Ideation: Apps Surface and Twenty Engagement Dashboard

## Recommendation

Build **Apps** as the main-shell delivery surface for custom, use-case-specific
CRM projections backed by installed plugin `ui-surface` declarations. Ship the
Twenty engagement dashboard as the first premium-style projection app. Do not
revive the retired Settings -> Applications surface, and do not simply iframe
the raw Twenty CRM product. The better first slice is:

1. A new main-shell route family: `/apps` and `/apps/$pluginKey/$surfaceKey`.
2. A sidebar `Apps` item that only appears when at least one installed,
   launchable plugin app exists.
3. A popover/command menu listing installed apps and readiness states.
4. A Twenty-owned `engagement-dashboard` UI surface declared in
   `plugins/twenty/src/manifest.ts`.
5. A ThinkWork-native dashboard rendered in the main content area, adapting the
   dashboard UI and application logic from the referenced branch while using the
   current ThinkWork design system.
6. A projection-pack shape for future premium upgrades: use case, data adapter,
   launchable surface, entitlement key, and verification smoke test.

This keeps the user-facing shape exactly where the screenshots point: the app
opens in the current ThinkWork workspace, not inside Settings. It also frames
the business model cleanly: ThinkWork can sell focused CRM apps without asking
customers to live inside the generic CRM UI.

## Grounding Context

### Codebase Context

- `apps/web/src/routes/_authed/_shell.tsx` already gives the web app the right
  host shape: persistent sidebar, top bar, and main content outlet.
- `apps/web/src/components/shell/ChatSidebar.tsx` owns the current main nav
  entries: New thread, Search, Work Items, Automations, Threads, and Spaces.
- `apps/web/src/components/SpacesSidebar.tsx` already queries plugin activation
  state for reconnect warnings, so the main shell has a precedent for
  plugin-aware navigation outside Settings.
- `packages/database-pg/graphql/types/plugins.graphql` exposes plugin catalog
  entries, install state, component state, and `launchUrl`.
- `packages/database-pg/src/schema/plugins.ts` and
  `packages/api/src/lib/plugins/engine.ts` already recognize `ui-surface`, but
  comments and implementation treat it as declared-only/no-op today.
- `plugins/twenty/src/manifest.ts` already owns the Twenty plugin manifest with
  `mcp-server` and `infrastructure` components. Version `0.2.0` adds
  opportunity record link hints, which is useful for dashboard drill-through.
- `apps/web/src/applets/mount.tsx` proves a robust iframe sandbox for generated
  app artifacts, while `apps/web/src/components/workbench/McpAppFrame.tsx`
  proves host theme/context messaging for embedded UI. Both are relevant
  substrate, but neither is currently an installed plugin app product model.
- `docs/solutions/architecture-patterns/managed-app-mcp-oauth-lifecycle-2026-06-06.md`
  says managed apps own lifecycle while MCP servers own per-user OAuth. Apps
  should compose those states instead of replacing either.
- `docs/solutions/architecture-patterns/plugin-source-boundaries-package-owned-deploy-verified-2026-06-17.md`
  says plugin-specific UI/source should live under the owning plugin package,
  with shared hosts and generic contracts in platform packages.
- `docs/plans/2026-06-08-003-feat-connected-application-registry-plan.md`
  already frames Twenty opportunity events, capability readiness, and
  cross-app flows as a future data spine.

### Referenced Branch Context

The referenced `origin/feat/engagement-dashboard` branch is not a clean,
small diff against this checkout; it includes a broader historical admin app
split. It is useful as source material for dashboard/admin-shell ideas, but it
should not be treated as a patch to merge directly into the current web shell.

The reusable pieces appear to be the admin dashboard route and component layer,
especially:

- `apps/admin/src/routes/_authed/_tenant/dashboard.tsx`
- `apps/admin/src/components/PageLayout.tsx`
- `apps/admin/src/components/PageHeader.tsx`
- `apps/admin/src/components/MetricCard.tsx`
- `apps/admin/src/components/StatusBadge.tsx`
- shared table, badge, pagination, chart, and filter primitives under
  `apps/admin/src/components/ui/`

Recommendation: extract the application logic and UX patterns from those files,
then reimplement the production version as a Twenty plugin app inside the
current `apps/web` shell and shared ThinkWork design system. Avoid importing
the historical `apps/admin` route structure as-is.

### External Context

- Twenty's developer docs describe APIs with cloud and self-hosted base URLs and
  bearer API-key authentication: <https://docs.twenty.com/developers/extend/api>.
- Twenty's webhooks docs list record update events including
  `opportunity.updated`: <https://docs.twenty.com/developers/extend/webhooks>.
- Twenty's developer overview describes APIs, webhooks, OAuth, and an app
  framework for custom objects, logic, UI components, and apps:
  <https://docs.twenty.com/developers/introduction>.
- MDN documents iframes as nested browsing contexts, which supports using an
  iframe boundary where plugin app code is not same-origin trusted:
  <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe>.

## Ranked Ideas

### 1. Installed Apps Launch Registry

**Description:** Add a generic installed-apps read model that turns installed
plugin `ui-surface` components into main-shell launch targets. The sidebar
shows `Apps` only when this query returns at least one launchable app. Selecting
an app navigates to `/apps/$pluginKey/$surfaceKey`, where the main content area
renders the app.

**Warrant:** `direct:` The plugin schema already includes `ui-surface`, Settings
already reads plugin catalog/install/component state, and the user explicitly
asked for "Apps -> Popover -> select app" only when apps are installed.

**Rationale:** This is the clean product primitive. It keeps Settings as
installation/configuration and makes Apps the day-to-day work surface. It also
avoids hard-coding Twenty into the sidebar.

**Downsides:** Requires a new GraphQL/API projection or careful reuse of plugin
catalog data in the main shell. Needs route-generation and sidebar tests.

**Confidence:** 92%

**Complexity:** Medium

**Status:** Unexplored

### 2. Twenty Engagement Dashboard as a Premium CRM Projection App

**Description:** Build the first app as a Twenty-owned engagement projection
rendered by ThinkWork, not as a raw iframe of the Twenty product. The dashboard
should summarize opportunities, stale engagement, next actions, and owner
accountability, with links back to Twenty records using manifest record-link
hints. Pull the useful dashboard logic and UI structure from the branch, but
adapt it to current ThinkWork components and shell behavior.

**Warrant:** `direct:` `plugins/twenty/src/manifest.ts` already owns Twenty as a
plugin with infrastructure, MCP, and opportunity link hints. Twenty's docs
confirm self-hosted API access and `opportunity.updated` webhook events.

**Rationale:** A native ThinkWork dashboard can look and behave like the rest of
the app, respect ThinkWork auth/readiness states, and focus on agent-assisted
engagement work rather than duplicating CRM navigation.

**Downsides:** Needs a data access decision: live API/MCP reads first, or a
ThinkWork projection table. Direct API access also raises credential and
permission questions.

**Confidence:** 88%

**Complexity:** Medium-High

**Status:** Unexplored

### 3. Projection Packs as the Premium Product Boundary

**Description:** Treat each premium CRM app as a projection pack: a plugin-owned
use case, data adapter, launchable UI surface, entitlement key, and smoke-test
contract. The Twenty engagement dashboard becomes the first pack; later packs
could cover renewal risk, onboarding health, pipeline review, or executive
account summaries.

**Warrant:** `inference:` The user clarified that ThinkWork should offer custom
CRM projections for specific use cases, possibly as premium upgrades. The repo
already supports plugin-owned source boundaries and installed plugin state.

**Rationale:** This avoids turning Apps into a vague launcher. The commercial
unit, code ownership, and verification boundary all line up around a concrete
customer use case.

**Downsides:** Entitlements may not exist in the product yet. The first
implementation may need to stub the entitlement field as metadata and enforce it
later.

**Confidence:** 84%

**Complexity:** Medium

**Status:** Unexplored

### 4. Promote `ui-surface` From Declared-Only to Launch Contract

**Description:** Extend the plugin manifest contract for `ui-surface` so it can
declare launchable app surfaces: key, display name, icon, mount kind, route
segment, readiness dependencies, optional required activation, and ownership.
The plugin engine can still provision it as a no-op component, but GraphQL and
the web shell should treat it as launch metadata.

**Warrant:** `direct:` `packages/api/src/lib/plugins/engine.ts` already orders
`ui-surface` components but does nothing for them. This is a clear unused
extension point.

**Rationale:** This converts an existing placeholder into the exact product
capability requested, without inventing a second app registry. It also keeps
app declarations package-owned under `plugins/twenty`.

**Downsides:** Contract design matters. If mount kinds are too generic, this
becomes marketplace runtime scope too early; if too narrow, the next app will
need another migration.

**Confidence:** 86%

**Complexity:** Medium

**Status:** Unexplored

### 5. Shared App Host With Trusted Route First, Iframe Later

**Description:** Create one app host route that can render either a trusted,
bundled React surface or an iframe-isolated app surface. The first Twenty
dashboard can be trusted/bundled. Future generated or remote app surfaces can
reuse the iframe substrate and host-context messaging already proven by applets
and MCP UI frames.

**Warrant:** `direct:` `apps/web/src/applets/mount.tsx` provides iframe
sandbox/loading/failure behavior; `McpAppFrame` provides host theme context.
The stale iframe-canvas decision still preserves the generic lesson that full
embedded apps need a sandbox boundary.

**Rationale:** This gives ThinkWork a real app substrate without making the
first dashboard pay the full cost of untrusted dynamic plugin execution. For
premium CRM projections, trusted bundled React is also the best way to keep the
experience coherent with the ThinkWork design system.

**Downsides:** Two mount modes add contract surface. The team must keep the
first slice small and avoid building a full marketplace runtime prematurely.

**Confidence:** 82%

**Complexity:** Medium

**Status:** Unexplored

### 6. Readiness-Aware Apps Picker

**Description:** The Apps popover should show launchable apps plus concise
states: Ready, install in progress, runtime parked, user reconnect needed, or
operator setup required. A ready app launches; an unready app routes to the
right fix path, usually plugin detail or MCP activation.

**Warrant:** `direct:` Existing plugin activation state can be `needs_reauth`,
managed apps can be parked/running/disabled, and the sidebar already uses an
amber reconnect warning for plugins.

**Rationale:** Without readiness, the first failed click will feel like the app
is broken. Apps are user-facing; they need to explain why an installed app is
not launchable for this user.

**Downsides:** Requires a readiness resolver that composes plugin install,
component state, managed app state, and per-user activation state.

**Confidence:** 80%

**Complexity:** Low-Medium

**Status:** Unexplored

### 7. Engagement Data Spine: Live Reads First, Webhook Projection Later

**Description:** Start the dashboard with the lowest viable data source
available through the current Twenty plugin path, then graduate to a webhook-fed
projection when connected application registry work lands. The dashboard should
be designed around the future projection but not blocked on it.

**Warrant:** `direct:` The connected application registry plan already scopes
Twenty `opportunity.updated` events and capability flows. Twenty's docs confirm
webhook support for opportunity updates.

**Rationale:** This gives the app a practical first implementation path while
keeping the long-term architecture aligned with event-driven connected apps.
The dashboard can later become faster and more historical without changing the
main-shell Apps UX.

**Downsides:** There is a migration risk from live reads to projection-backed
reads. The first implementation should isolate data access behind a small
dashboard data adapter.

**Confidence:** 78%

**Complexity:** High

**Status:** Unexplored

## Rejection Summary

| #   | Idea                                   | Reason Rejected                                                                                           |
| --- | -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Raw Twenty iframe as first app         | Likely auth, framing, theming, and UX mismatch; weaker than a ThinkWork-native dashboard with deep links. |
| 2   | External-link-only Apps                | Already mostly covered by `launchUrl`; does not satisfy rendering in the main content area.               |
| 3   | Revive Settings -> Applications        | Conflicts with current Settings tests and the plugin migration direction.                                 |
| 4   | Treat plugin Apps as artifact applets  | Conflates installed applications with generated thread artifacts.                                         |
| 5   | Full dynamic marketplace runtime now   | Too expensive before one first-party app proves the launch contract.                                      |
| 6   | BI/Metabase dashboard first            | Already covered by older executive-dashboard ideation; the requested first proof is Twenty engagement.    |
| 7   | Static seeded dashboard as the product | Useful as a development slice, but below the product bar by itself.                                       |
| 8   | Put Apps under Settings                | The requested workflow and screenshots point to a main work surface, not admin configuration.             |

## Implementation Direction To Brainstorm Next

Recommended next brainstorm seed:

> Define the v1 Apps launch contract and Twenty engagement dashboard scope:
> plugin manifest shape, installed-apps query, sidebar popover behavior,
> readiness states, route/mount contract, Twenty CRM projection-pack model,
> premium entitlement metadata, the branch dashboard logic to adapt, and the
> first dashboard data adapter.

Do not jump directly to a build plan from this ideation. The next step should be
`ce-brainstorm` on the launch contract and first Twenty dashboard scope.
