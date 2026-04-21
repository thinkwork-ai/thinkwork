-- Drop two wiki schema columns that were pre-emptively added in anticipation
-- of features that never shipped and were later killed by adversarial review:
--
--   - wiki_page_sections.body_embedding (vector(1024)):
--       "present but NULL in v1" per the original migration. pgvector
--       extension stays; only this column goes. Re-add later if embeddings
--       ship.
--
--   - wiki_unresolved_mentions.cluster (jsonb):
--       cluster enrichment feature was killed and superseded by the Place
--       capability (see docs/brainstorms/2026-04-21-wiki-place-capability-
--       requirements.md).
--
-- Pre-flight SQL run against dev on 2026-04-21 returned 0/1638 non-null
-- cluster rows and 0/2279 non-null body_embedding rows. Both columns are
-- verifiably unused.
--
-- Each DROP is wrapped in a DO-block that RE-CHECKS at migration apply time
-- and RAISEs EXCEPTION if a concurrent writer landed a value between
-- pre-flight and apply, so silent data loss is impossible.
DO $$ BEGIN IF (SELECT count(*) FROM wiki_page_sections WHERE body_embedding IS NOT NULL) > 0 THEN RAISE EXCEPTION 'wiki_page_sections.body_embedding contains non-null rows; aborting DROP COLUMN'; END IF; END $$;--> statement-breakpoint
ALTER TABLE "wiki_page_sections" DROP COLUMN IF EXISTS "body_embedding";--> statement-breakpoint
DO $$ BEGIN IF (SELECT count(*) FROM wiki_unresolved_mentions WHERE cluster IS NOT NULL) > 0 THEN RAISE EXCEPTION 'wiki_unresolved_mentions.cluster contains non-null rows; aborting DROP COLUMN'; END IF; END $$;--> statement-breakpoint
ALTER TABLE "wiki_unresolved_mentions" DROP COLUMN IF EXISTS "cluster";
