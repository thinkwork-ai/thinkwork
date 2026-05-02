---
title: Brain enrichment approval must sync wiki sections
date: 2026-05-02
category: database-issues
module: Brain enrichment / mobile wiki
problem_type: database_issue
component: database
symptoms:
  - "Mobile review thread reported accepted draft regions, but the wiki page did not show them after returning to the page."
  - "Postgres showed wiki_pages.body_md contained the accepted sections while wiki_page_sections still contained only the old sections."
root_cause: missing_workflow_step
resolution_type: code_fix
severity: high
related_components:
  - "GraphQL draft review apply"
  - "React Native wiki detail screen"
tags: [brain-enrichment, wiki, mobile, sections, writeback]
---

# Brain enrichment approval must sync wiki sections

## Problem

Brain enrichment draft approval reported success, but the mobile wiki page did
not show the accepted changes. The approved content was present in
`wiki_pages.body_md`, yet mobile continued rendering the old page because the
GraphQL `wikiPage` resolver reads display sections from `wiki_page_sections`.

## Symptoms

- The review thread showed `Draft applied to Eric: 2 accepted, 1 rejected.`
- The Eric wiki detail page still showed only the old `Overview` and `Notes`
  sections.
- A direct database query showed the accepted `Eric's Test Journal` and `Work`
  markdown in `wiki_pages.body_md`.
- The matching `wiki_page_sections` rows were missing, so GraphQL returned stale
  section data even on a fresh network query.

## What Didn't Work

- Treating this as a mobile cache bug was incomplete. Adding a focus-time
  network refetch is useful, but it cannot surface sections that were never
  written to `wiki_page_sections`.
- Looking only at `wiki_pages.body_md` made the backend apply step look correct.
  The mobile detail contract depends on section rows.

## Solution

When applying a draft review to `wiki_pages`, update the page body and the
derived section rows in the same transaction.

The apply path now:

1. Merges accepted and rejected draft regions into final page markdown.
2. Parses that final markdown back into ordered wiki sections.
3. Updates `wiki_pages.body_md`.
4. Deletes section rows no longer present.
5. Upserts current section rows by `(page_id, section_slug)`.

The mobile wiki screen also reexecutes the wiki page query with
`network-only` when the screen gains focus, so returning from the review thread
does not reuse a stale cached detail result.

## Why This Works

`wiki_pages.body_md` is the search/export-style whole-page body. The mobile
wiki detail view renders `wikiPage.sections`, and the resolver fills that field
from `wiki_page_sections`.

Before the fix, draft approval updated only the whole-page body. That made the
approval durable but invisible on mobile. Syncing section rows in the same
transaction keeps the storage surfaces consistent, and focus refetch ensures
the client asks for the fresh sections after the mutation.

## Prevention

- For any write path that mutates compiled wiki page prose, verify whether the
  consumer reads `wiki_pages.body_md`, `wiki_page_sections`, or both.
- Add regression coverage for the markdown-to-section-row conversion used by
  draft review apply.
- In manual verification, check the actual UI contract. For mobile wiki detail,
  that means `wiki_page_sections`, not just `wiki_pages.body_md`.
- For deployed end-to-end tests, create a fresh enrichment review after the API
  fix is deployed, approve a subset of regions, return to the wiki page, and
  confirm the accepted sections appear without a direct database backfill.

## Related Issues

- `docs/solutions/integration-issues/web-enrichment-must-use-summarized-external-results-2026-05-01.md`
