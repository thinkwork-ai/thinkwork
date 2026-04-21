# Compounding Memory — v1 Scoping Correction

## Purpose

This note course-corrects the current build plan before more implementation hardens around the wrong privacy model.

For v1, **Compounding Memory should be agent-scoped**.

That means the system should compound memory for **one agent at a time**, not implicitly aggregate memory across all agents in a tenant. Team-level or company-level compounding can come later, but it should be an explicit higher-scope design, not an accidental side effect of the v1 schema.

## Why this matters

The current build plan is mixed-scope:
- compile jobs and cursors are already shaped around `(tenant_id, owner_id)`
- but `entity` pages are currently defined as **tenant-shared**
- that creates an early cross-agent knowledge layer even though the intended v1 behavior is **agent brain first**

That is the wrong default for privacy, trust, and product clarity.

The clean model is:
- **v1:** agent-scoped compounding only
- **later:** optional team/shared/company compounding as a distinct layer with its own rules

## v1 scoping rule

In v1, all compiled memory objects should be scoped to:
- `tenant_id`
- `owner_id` (the agent identity / owner scope)

This applies to:
- compiled pages
- page sections
- aliases
- unresolved mentions
- compile jobs
- compile cursors
- GraphQL read paths
- agent tools
- markdown export bundles

In practical terms: **every compiled page in v1 belongs to exactly one agent scope**.

## Required architecture correction

### 1. Page scope

Change the page model from:
- `entity` = tenant-shared
- `topic` = owner-scoped
- `decision` = owner-scoped

to:
- `entity` = owner-scoped in v1
- `topic` = owner-scoped in v1
- `decision` = owner-scoped in v1

So the page type decides the shape of the page, **not** whether it is shared.

Scope is a separate concern from page type.

## 2. Database/schema correction

Because migrations have not been applied yet, this is the right time to fix the schema.

### `wiki_pages`

Change the schema assumptions so that:
- `owner_id` is **NOT NULL** in v1
- remove the special meaning of `owner_id IS NULL`
- remove the check constraint that forces `entity` pages to be tenant-shared
- uniqueness should be based on `(tenant_id, owner_id, type, slug)`

Replace the current idea:
- `NULL = tenant-shared`

with:
- every row is agent-scoped in v1

### `wiki_unresolved_mentions`

Also make `owner_id` **NOT NULL** in v1.

Uniqueness should be based on:
- `(tenant_id, owner_id, alias_normalized, status)`

Do not allow unresolved mentions to float at tenant scope in v1.

### `wiki_compile_jobs`

`owner_id` should also be **NOT NULL** for v1 compile jobs.

Jobs should always be for a specific agent scope.

### `wiki_compile_cursors`

Keep the cursor table, but remove the `NULL owner_id means shared scope` logic.

In v1, a cursor always belongs to one `(tenant_id, owner_id)` pair.

If later we introduce shared/team/company compounding, that should use:
- a different explicit scope model, or
- an additional scope discriminator

It should **not** piggyback on `owner_id = NULL` in v1.

## 3. Compiler behavior correction

The compiler should read and write within a single agent scope.

That means:
- a compile job runs for one `(tenant_id, owner_id)`
- planner candidate pages come only from that same scope
- alias resolution happens only inside that same scope
- unresolved mention accumulation happens only inside that same scope
- page creation and updates happen only inside that same scope

No cross-agent page lookup.
No tenant-level entity merge behavior.
No shared entity namespace in v1.

## 4. GraphQL and agent read-path correction

The read path should reflect the same privacy boundary.

### GraphQL

Queries should require or derive `ownerId` for v1 reads.
Do not let `wikiSearch` or `wikiPage` silently search across all agent scopes in a tenant.

Preferred behavior:
- read within the requesting agent scope by default
- admin/debug tooling may explicitly pass `ownerId`
- there is no tenant-wide wiki read in v1 unless we deliberately build an admin-only inspect path

### Agent tools

`search_wiki` and `read_wiki_page` should resolve against the current agent's owner scope.

The tool should not accidentally expose another agent's compiled knowledge just because it lives in the same tenant.

## 5. Export correction

Markdown export should be scoped per agent in v1.

That means exports should produce an agent-scoped compiled memory bundle, not a tenant-wide vault.

If later we add team/company compilation, that can produce its own separate export surface.

## 6. Build-plan changes needed

The current build plan should be amended in at least these places:

- change the page-type/scoping statement so `entity` is no longer tenant-shared
- change schema examples so `owner_id` is not nullable for v1 compiled objects
- remove `NULL owner_id = shared scope` logic from tables and constraints
- remove any compiler behavior that reads both `(tenant, owner)` and `(tenant, null-owner)` scopes
- tighten GraphQL/API examples so all reads are owner-scoped in v1
- tighten export language so bundles are owner-scoped in v1
- update verification steps so success means **GiGi can read GiGi's compiled brain**, not tenant-wide compiled knowledge

## 7. Future extensibility, without painting ourselves into a corner

We still want future shared scopes. Just not yet.

The likely future model is:
- **agent scope**
- **team scope**
- **company scope**

But that should be introduced explicitly later with a real scope model, for example:
- `scope_type` = `agent | team | company`
- `scope_id`

or an equivalent normalized scope table.

That future model should come with explicit rules for:
- promotion across scopes
- visibility and privacy
- what can be copied up vs linked up
- whether higher scopes are derived from lower scopes or compiled independently

Do **not** fake that future system by overloading `owner_id = NULL` in v1.

## 8. Recommended implementation order

Before moving further with implementation:

1. amend `.prds/compounding-memory-v1-build-plan.md`
2. update schema definitions to make v1 strictly owner-scoped
3. update compiler assumptions to one scope per job
4. update GraphQL and agent-tool assumptions to one scope per read
5. only then continue with schema/application work

This is worth doing now because the database changes have not been applied yet.

## Hand-off prompt for the implementation agent

Use this if you want the coding agent to make the correction directly:

> We need to course-correct the v1 Compounding Memory implementation to be **strictly agent-scoped**.
>
> Read first:
> - `.prds/compounding-memory-v1-build-plan.md`
> - `.prds/compounding-memory-implementation-plan.md`
> - `.prds/compounding-memory-scoping.md`
> - `.prds/compiled-memory-layer-engineering-prd.md`
> - `.prds/thinkwork-memory-compounding-pipeline-deep-dive.md`
>
> Then update the build plan and any in-progress implementation assumptions so that v1 compounding is owner-scoped only.
>
> Required changes:
> - all compiled pages are owner-scoped in v1, including `entity`
> - `owner_id` should be treated as required for v1 compiled-memory rows
> - remove `owner_id IS NULL = shared scope` semantics from the current schema plan
> - compile jobs/cursors operate on exactly one `(tenant_id, owner_id)` scope
> - planner, alias resolution, unresolved mentions, GraphQL, agent tools, and export all stay within a single owner scope in v1
> - leave room for a future explicit shared/team/company scope model, but do not implement that now
>
> Deliverable:
> - update `.prds/compounding-memory-v1-build-plan.md`
> - if code changes have already started, update them to match
> - provide a concise summary of what changed and any remaining edge cases

## Bottom line

The correct v1 mental model is simple:

**each agent gets its own compounding brain first.**

Shared or company-level compounding can come later, but only as an explicit product capability with its own privacy and governance model.
