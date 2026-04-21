-- Wiki Place capability v2 — first-class wiki_places table + wiki_pages.place_id FK.
--
-- See docs/plans/2026-04-21-005-feat-wiki-place-capability-v2-plan.md.
--
-- Purely additive; no existing rows are rewritten. The partial unique index
-- on (tenant_id, owner_id, google_place_id) WHERE google_place_id IS NOT NULL
-- enforces first-seen-wins for Google-sourced places within a scope.
--
-- No CI migration runner — apply manually via
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0017_wiki_places.sql
-- after PR A merges and before any code that references wiki_places runs in
-- production. See the plan's Documentation / Operational Notes section.
--
-- Pre-migration invariant (always true on day one since the table is new;
-- pattern documented for future loaders):
--   SELECT tenant_id, owner_id, google_place_id, count(*)
--   FROM wiki_places
--   WHERE google_place_id IS NOT NULL
--   GROUP BY 1, 2, 3 HAVING count(*) > 1;
-- must return zero rows before the unique index is created.
CREATE TABLE "wiki_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"google_place_id" text,
	"geo_lat" numeric(9, 6),
	"geo_lon" numeric(9, 6),
	"address" text,
	"parent_place_id" uuid,
	"place_kind" text,
	"source" text NOT NULL,
	"source_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD COLUMN "place_id" uuid;--> statement-breakpoint
ALTER TABLE "wiki_places" ADD CONSTRAINT "wiki_places_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_places" ADD CONSTRAINT "wiki_places_owner_id_agents_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_places" ADD CONSTRAINT "wiki_places_parent_place_id_wiki_places_id_fk" FOREIGN KEY ("parent_place_id") REFERENCES "public"."wiki_places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_wiki_places_tenant_owner" ON "wiki_places" USING btree ("tenant_id","owner_id");--> statement-breakpoint
CREATE INDEX "idx_wiki_places_parent" ON "wiki_places" USING btree ("parent_place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wiki_places_scope_google_place_id" ON "wiki_places" USING btree ("tenant_id","owner_id","google_place_id") WHERE "wiki_places"."google_place_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_place_id_wiki_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."wiki_places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_wiki_pages_place_id" ON "wiki_pages" USING btree ("place_id") WHERE "wiki_pages"."place_id" IS NOT NULL;