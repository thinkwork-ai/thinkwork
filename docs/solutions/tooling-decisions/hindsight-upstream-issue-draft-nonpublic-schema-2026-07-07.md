# DRAFT upstream issue — Hindsight maintenance discovery no-ops on non-`public` schemas

**Status:** draft, not yet filed. Target: ghcr.io/vectorize-io/hindsight
issue tracker. Found during the ThinkWork 0.8.4 upgrade validation
(docs/solutions/tooling-decisions/hindsight-084-upgrade-validation-2026-07-06.md).

---

**Title:** Maintenance discovery routines no-op with warnings when
`HINDSIGHT_API_DATABASE_SCHEMA` is not `public`

**Body:**

We run Hindsight 0.8.4 with `HINDSIGHT_API_DATABASE_SCHEMA=hindsight` (shared
Postgres cluster, dedicated schema). Core retain/recall/consolidation work
correctly in this configuration, but the background maintenance discovery
routines silently no-op:

- `banks_needing_consolidation()`
- the `mental_models_with_cron` discovery query
- the `schemas_with_expired_rows` sweep

Each logs a warning and returns empty because the discovery SQL references
`public.`-qualified objects (or relies on `search_path = public`) rather than
the configured schema. Per-retain consolidation is unaffected — only the
cron-style discovery paths are dead, so banks that stop receiving writes are
never re-consolidated and expired rows are never swept.

**Repro:** run the standard image with
`HINDSIGHT_API_DATABASE_SCHEMA=<anything but public>`, retain a few
conversations, and watch the maintenance loop logs: each cycle warns and
processes zero banks.

**Expected:** discovery routines qualify their objects with the configured
schema (or set `search_path` to it), matching the behavior of the retain and
recall paths, which already respect `HINDSIGHT_API_DATABASE_SCHEMA`.

Happy to submit a PR if you can point at where the discovery SQL should pick
up the schema setting.
