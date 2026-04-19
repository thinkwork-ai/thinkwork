DROP INDEX "uq_wiki_page_links_from_to";--> statement-breakpoint
ALTER TABLE "wiki_page_links" ADD COLUMN "kind" text DEFAULT 'reference' NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_page_sections" ADD COLUMN "aggregation" jsonb;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD COLUMN "parent_page_id" uuid;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD COLUMN "hubness_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD COLUMN "tags" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_unresolved_mentions" ADD COLUMN "cluster" jsonb;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_parent_page_id_wiki_pages_id_fk" FOREIGN KEY ("parent_page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wiki_page_links_from_to_kind" ON "wiki_page_links" USING btree ("from_page_id","to_page_id","kind");--> statement-breakpoint
CREATE INDEX "idx_wiki_page_links_kind" ON "wiki_page_links" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_wiki_pages_parent" ON "wiki_pages" USING btree ("parent_page_id");