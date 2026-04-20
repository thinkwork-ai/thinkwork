-- Hand-edited: prepend CREATE EXTENSION so greenfield deploys bring pg_trgm
-- up before the GIN indexes reference `gin_trgm_ops`. On dev / prod RDS the
-- extension is already installed (shared with Hindsight's similarity filter)
-- so this is a no-op. `CREATE INDEX CONCURRENTLY` was considered but cannot
-- run inside a transaction block, and drizzle wraps every migration in one —
-- the plain form is safe for our table sizes (<10k rows per scope).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "idx_wiki_page_aliases_alias_trgm" ON "wiki_page_aliases" USING gin ("alias" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_wiki_pages_title_trgm" ON "wiki_pages" USING gin ("title" gin_trgm_ops);