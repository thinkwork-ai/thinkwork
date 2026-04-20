# Wiki link density — operator dashboard

SQL to reproduce the link-densification observability picture without a BI tool.
Each section is copy-pasteable against the Aurora cluster; adjust `:tenant` and
`:owner` placeholders as needed.

## Per-agent density snapshot

Matches what `scripts/wiki-link-density-baseline.ts` prints. Useful before /
after the `WIKI_DETERMINISTIC_LINKING_ENABLED` flip.

```sql
WITH scope AS (
  SELECT a.id AS owner_id, a.name
  FROM agents a
  WHERE a.tenant_id = :tenant
),
pages AS (
  SELECT wp.owner_id, COUNT(*)::int AS pages
  FROM wiki_pages wp
  WHERE wp.tenant_id = :tenant
  GROUP BY wp.owner_id
),
linked AS (
  SELECT wp.owner_id, COUNT(DISTINCT wp.id)::int AS linked_pages
  FROM wiki_pages wp
  JOIN wiki_page_links wpl
    ON (wpl.from_page_id = wp.id OR wpl.to_page_id = wp.id)
   AND wpl.kind = 'reference'
  WHERE wp.tenant_id = :tenant
  GROUP BY wp.owner_id
),
links_by_kind AS (
  SELECT wp.owner_id, wpl.kind, COUNT(*)::int AS n
  FROM wiki_page_links wpl
  JOIN wiki_pages wp ON wp.id = wpl.from_page_id
  WHERE wp.tenant_id = :tenant
  GROUP BY wp.owner_id, wpl.kind
),
dup_titles AS (
  SELECT owner_id, COUNT(*)::int AS duplicate_candidates
  FROM (
    SELECT owner_id, title
    FROM wiki_pages
    WHERE tenant_id = :tenant
      AND status = 'active'
    GROUP BY owner_id, title
    HAVING COUNT(*) > 1
  ) dup
  GROUP BY owner_id
)
SELECT
  s.name,
  COALESCE(p.pages, 0)                                        AS pages,
  COALESCE(l.linked_pages, 0)                                 AS linked_pages,
  ROUND(100.0 * COALESCE(l.linked_pages, 0)
        / NULLIF(p.pages, 0), 1)                              AS percent_linked,
  COALESCE((SELECT n FROM links_by_kind k
            WHERE k.owner_id = s.owner_id AND k.kind = 'reference'), 0)
                                                              AS reference_links,
  COALESCE((SELECT n FROM links_by_kind k
            WHERE k.owner_id = s.owner_id AND k.kind = 'parent_of'), 0)
                                                              AS parent_of_links,
  COALESCE((SELECT n FROM links_by_kind k
            WHERE k.owner_id = s.owner_id AND k.kind = 'child_of'), 0)
                                                              AS child_of_links,
  COALESCE(d.duplicate_candidates, 0)                         AS duplicate_candidates
FROM scope s
LEFT JOIN pages        p ON p.owner_id = s.owner_id
LEFT JOIN linked       l ON l.owner_id = s.owner_id
LEFT JOIN dup_titles   d ON d.owner_id = s.owner_id
ORDER BY s.name;
```

## Per-compile metric rollup

Drives the three new `wiki_compile_jobs.metrics` keys from Unit 1.

```sql
SELECT
  owner_id,
  date_trunc('hour', created_at)                                     AS hour,
  COUNT(*)                                                           AS jobs,
  SUM((metrics->>'links_written_deterministic')::int)                AS det_links,
  SUM((metrics->>'links_written_co_mention')::int)                   AS co_links,
  MAX((metrics->>'duplicate_candidates_count')::int)                 AS dup_candidates,
  COUNT(*) FILTER (
    WHERE (metrics->>'deterministic_linking_flag_suppressed')::bool
  )                                                                  AS flag_off_jobs
FROM wiki_compile_jobs
WHERE tenant_id = :tenant
  AND status = 'succeeded'
  AND created_at >= now() - interval '24 hours'
GROUP BY owner_id, hour
ORDER BY owner_id, hour;
```

## Provenance audit (targeted rollback fodder)

Every deterministic row carries `context LIKE 'deterministic:%'`; every
co-mention row carries `context LIKE 'co_mention:%'`. Either can be dropped
cleanly if precision tanks, without disturbing LLM-emitted references.

```sql
-- Inspect a sample of deterministic rows
SELECT context, COUNT(*)::int
FROM wiki_page_links wpl
JOIN wiki_pages wp ON wp.id = wpl.from_page_id
WHERE wp.tenant_id = :tenant AND wp.owner_id = :owner
  AND wpl.context LIKE 'deterministic:%'
GROUP BY context
ORDER BY COUNT(*) DESC
LIMIT 20;

-- Rollback deterministic-parent rows for one agent (R5 tripped)
DELETE FROM wiki_page_links
WHERE context LIKE 'deterministic:%'
  AND from_page_id IN (SELECT id FROM wiki_pages
                       WHERE tenant_id = :tenant AND owner_id = :owner);

-- Rollback co-mention rows for one agent
DELETE FROM wiki_page_links
WHERE context LIKE 'co_mention:%'
  AND from_page_id IN (SELECT id FROM wiki_pages
                       WHERE tenant_id = :tenant AND owner_id = :owner);
```

## Flag state verification

`WIKI_DETERMINISTIC_LINKING_ENABLED` is pinned in terraform next to
`WIKI_AGGREGATION_PASS_ENABLED`. To verify the deployed Lambda sees the
value you expect, either:

```bash
# terraform side — shows the plan's env-var overrides
terraform show | grep -A1 WIKI_DETERMINISTIC_LINKING

# Lambda side — confirms what the running function actually reads
aws lambda get-function-configuration \
  --function-name thinkwork-prod-wiki-compile \
  --query 'Environment.Variables.WIKI_DETERMINISTIC_LINKING_ENABLED'
```

`WIKI_DETERMINISTIC_LINKING_ENABLED=false` ⇒ every subsequent compile
records `deterministic_linking_flag_suppressed: true` in its metrics and
both `links_written_*` counters stay at 0.
