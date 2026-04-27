---
title: Mobile Wiki search needs separator-aware FTS and prefix queries
date: 2026-04-27
category: logic-errors
module: Mobile Wiki Search
problem_type: logic_error
component: database
symptoms:
  - Mobile Wiki search misses obvious compiled pages unless the query matches exact indexed terms.
  - "Terms split by punctuation, such as cafe/restaurant, appear as a combined lexeme in search_tsv."
  - Partial mobile input such as empan does not find pages containing empanada.
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [mobile-wiki, search-tsv, postgres-fts, generated-column, prefix-search]
---

# Mobile Wiki search needs separator-aware FTS and prefix queries

## Problem

Mobile Wiki search was already using `wiki_pages.search_tsv`, but the indexed text and query builder were too literal for a mobile search box. A page whose compiled text contained `Cafe/Restaurant`, `GoGo Fresh`, `Miami Beach`, and `empanada` could still fail searches such as `restaurant` or `empan`.

## Symptoms

- The mobile Wiki tab returned results only for exact-enough full terms.
- A `search_tsv` value showed punctuation-separated text as a combined lexeme like `'cafe/restaurant':4`.
- The mobile resolver had its own direct `plainto_tsquery` SQL instead of reusing shared wiki search behavior.

## What Didn't Work

- Checking the mobile UI alone was misleading. The client passed the query through and rendered server results; the brittle behavior lived in server-side FTS.
- Replacing FTS with semantic recall would have undone the earlier performance fix that moved mobile search off Hindsight.
- Adding client-side filtering or fallback `ILIKE` scans would have duplicated search behavior and weakened the GIN-indexed path.

## Solution

Keep Postgres FTS as the source of truth, but make both sides of the match less brittle:

- Normalize punctuation before `to_tsvector` so separator-heavy text contributes separate lexemes.
- Build a safe prefix `to_tsquery` from normalized alphanumeric terms.
- Route `mobileWikiSearch` through the shared `searchWikiForUser` helper so mobile and admin wiki search do not drift.
- Preserve the mobile response shape with `matchingMemoryIds: []`.

The generated column expression should normalize separators before indexing:

```ts
search_tsv: tsvector("search_tsv").generatedAlwaysAs(
  sql`to_tsvector('english'::regconfig, regexp_replace(coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(body_md,''), '[^[:alnum:]]+', ' ', 'g'))`,
),
```

The shared helper should convert user input into safe prefix terms, not raw tsquery syntax:

```ts
export function normalizeWikiSearchTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const term of terms) {
    if (term.length < 2) continue;
    seen.add(term);
  }
  return [...seen];
}

export function buildPrefixTsQuery(query: string): string | null {
  const terms = normalizeWikiSearchTerms(query);
  if (terms.length === 0) return null;
  return terms.map((term) => `${term}:*`).join(" & ");
}
```

Use both plain and prefix matching in the same indexed query:

```sql
p.search_tsv @@ plainto_tsquery('english', ${query})
OR p.search_tsv @@ to_tsquery('english', ${prefixQuery})
OR ah.page_id IS NOT NULL
```

When changing a generated `tsvector` expression, ship an explicit migration that drops and recreates the derived column and GIN index. Include drift reporter markers:

```sql
-- creates-column: public.wiki_pages.search_tsv
-- creates: public.idx_wiki_pages_search_tsv
```

## Why This Works

The separator normalization fixes the data shape: `Cafe/Restaurant` becomes independently searchable as `cafe` and `restaurant` before Postgres builds the tsvector. The prefix query fixes the mobile input shape: `empan:*` can match `empanada` while still using the GIN-indexed `search_tsv` column.

The helper centralization matters as much as the SQL. Once `mobileWikiSearch` delegates to `searchWikiForUser`, alias boost, prefix matching, ranking, tenant/user scoping, and future tuning stay consistent across mobile and admin wiki search.

## Prevention

- Treat mobile search boxes as prefix-input surfaces unless product explicitly requires exact-token search.
- Add tests for punctuation-heavy text (`Cafe/Restaurant`) and partial queries (`empan`) when changing FTS behavior.
- Keep `mobileWikiSearch` as a thin adapter over shared wiki search; avoid resolver-local SQL unless the mobile response shape truly needs a different search contract.
- For generated columns, update both the Drizzle schema and a hand-rolled migration that recreates the column/index safely.

## Related Issues

- [Plan: Mobile Wiki search uses flexible search_tsv matching](/docs/plans/2026-04-27-001-fix-mobile-wiki-search-tsv-plan.md)
- [Compounding Memory API docs](/docs/src/content/docs/api/compounding-memory.mdx)
- [Compounding Memory Pages concept docs](/docs/src/content/docs/concepts/knowledge/compounding-memory-pages.mdx)
