-- Compounding Memory (wiki) schema. pgvector is required for body_embedding
-- on wiki_page_sections. Extension is idempotent; already installed on dev
-- Aurora (0.7.4) but needed by any fresh environment.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "wiki_compile_cursors" (
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"last_record_updated_at" timestamp with time zone,
	"last_record_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_compile_cursors_pkey" PRIMARY KEY("tenant_id","owner_id")
);
--> statement-breakpoint
CREATE TABLE "wiki_compile_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"metrics" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_compile_jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "wiki_page_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_page_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_page_id" uuid NOT NULL,
	"to_page_id" uuid NOT NULL,
	"context" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_page_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"section_slug" text NOT NULL,
	"heading" text NOT NULL,
	"body_md" text NOT NULL,
	"position" integer NOT NULL,
	"body_embedding" vector(1024),
	"last_source_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"type" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"body_md" text,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english'::regconfig, coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(body_md,''))) STORED,
	"status" text DEFAULT 'active' NOT NULL,
	"last_compiled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_section_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_ref" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_unresolved_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"alias_normalized" text NOT NULL,
	"mention_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sample_contexts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_type" text,
	"status" text DEFAULT 'open' NOT NULL,
	"promoted_page_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "wiki_compile_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_compile_cursors" ADD CONSTRAINT "wiki_compile_cursors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_compile_cursors" ADD CONSTRAINT "wiki_compile_cursors_owner_id_agents_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_compile_jobs" ADD CONSTRAINT "wiki_compile_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_compile_jobs" ADD CONSTRAINT "wiki_compile_jobs_owner_id_agents_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_aliases" ADD CONSTRAINT "wiki_page_aliases_page_id_wiki_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_links" ADD CONSTRAINT "wiki_page_links_from_page_id_wiki_pages_id_fk" FOREIGN KEY ("from_page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_links" ADD CONSTRAINT "wiki_page_links_to_page_id_wiki_pages_id_fk" FOREIGN KEY ("to_page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_sections" ADD CONSTRAINT "wiki_page_sections_page_id_wiki_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_owner_id_agents_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_section_sources" ADD CONSTRAINT "wiki_section_sources_section_id_wiki_page_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."wiki_page_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_unresolved_mentions" ADD CONSTRAINT "wiki_unresolved_mentions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_unresolved_mentions" ADD CONSTRAINT "wiki_unresolved_mentions_owner_id_agents_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_unresolved_mentions" ADD CONSTRAINT "wiki_unresolved_mentions_promoted_page_id_wiki_pages_id_fk" FOREIGN KEY ("promoted_page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_wiki_compile_jobs_scope_status_created" ON "wiki_compile_jobs" USING btree ("tenant_id","owner_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_wiki_compile_jobs_status_created" ON "wiki_compile_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wiki_page_aliases_page_alias" ON "wiki_page_aliases" USING btree ("page_id","alias");--> statement-breakpoint
CREATE INDEX "idx_wiki_page_aliases_alias" ON "wiki_page_aliases" USING btree ("alias");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wiki_page_links_from_to" ON "wiki_page_links" USING btree ("from_page_id","to_page_id");--> statement-breakpoint
CREATE INDEX "idx_wiki_page_links_to" ON "wiki_page_links" USING btree ("to_page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wiki_page_sections_page_slug" ON "wiki_page_sections" USING btree ("page_id","section_slug");--> statement-breakpoint
CREATE INDEX "idx_wiki_page_sections_page_position" ON "wiki_page_sections" USING btree ("page_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wiki_pages_tenant_owner_type_slug" ON "wiki_pages" USING btree ("tenant_id","owner_id","type","slug");--> statement-breakpoint
CREATE INDEX "idx_wiki_pages_tenant_owner_type_status" ON "wiki_pages" USING btree ("tenant_id","owner_id","type","status");--> statement-breakpoint
CREATE INDEX "idx_wiki_pages_owner" ON "wiki_pages" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_wiki_pages_last_compiled" ON "wiki_pages" USING btree ("last_compiled_at");--> statement-breakpoint
CREATE INDEX "idx_wiki_pages_search_tsv" ON "wiki_pages" USING gin ("search_tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wiki_section_sources_section_kind_ref" ON "wiki_section_sources" USING btree ("section_id","source_kind","source_ref");--> statement-breakpoint
CREATE INDEX "idx_wiki_section_sources_kind_ref" ON "wiki_section_sources" USING btree ("source_kind","source_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wiki_unresolved_mentions_scope_alias_status" ON "wiki_unresolved_mentions" USING btree ("tenant_id","owner_id","alias_normalized","status");--> statement-breakpoint
CREATE INDEX "idx_wiki_unresolved_mentions_tenant_owner_status" ON "wiki_unresolved_mentions" USING btree ("tenant_id","owner_id","status");--> statement-breakpoint
CREATE INDEX "idx_wiki_unresolved_mentions_status_last_seen" ON "wiki_unresolved_mentions" USING btree ("status","last_seen_at");--> statement-breakpoint
-- Catch-up DROP COLUMNs for threads. The Task-concept strip (commit c4b92d2)
-- removed these from the Drizzle schema module but never emitted a migration.
-- Bundling them here keeps the schema snapshot (meta/0012_*_snapshot.json) and
-- the live DB consistent. Not part of the wiki feature.
ALTER TABLE "threads" DROP COLUMN IF EXISTS "sync_status";--> statement-breakpoint
ALTER TABLE "threads" DROP COLUMN IF EXISTS "sync_error";--> statement-breakpoint
ALTER TABLE "threads" DROP COLUMN IF EXISTS "external_task_id";