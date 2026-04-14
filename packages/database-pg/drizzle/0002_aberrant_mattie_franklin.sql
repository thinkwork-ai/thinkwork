CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid,
	"tenant_id" uuid,
	"target_type" text,
	"provider_id" uuid,
	"provider_name" text,
	"provider_event_id" text,
	"external_task_id" text,
	"provider_user_id" text,
	"normalized_kind" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_ip" text,
	"body_preview" text,
	"body_sha256" text,
	"body_size_bytes" integer,
	"headers_safe" jsonb,
	"signature_prefix" text,
	"signature_status" text NOT NULL,
	"resolution_status" text NOT NULL,
	"thread_id" uuid,
	"thread_created" boolean,
	"status_code" integer,
	"error_message" text,
	"duration_ms" integer,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"is_replay" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "connect_provider_id" uuid;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_provider_id_connect_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."connect_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_webhook_received" ON "webhook_deliveries" USING btree ("webhook_id","received_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_tenant_received" ON "webhook_deliveries" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_status" ON "webhook_deliveries" USING btree ("resolution_status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_webhook_deliveries_provider_event" ON "webhook_deliveries" USING btree ("provider_name","provider_event_id") WHERE provider_event_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_connect_provider_id_connect_providers_id_fk" FOREIGN KEY ("connect_provider_id") REFERENCES "public"."connect_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_webhooks_provider_tenant" ON "webhooks" USING btree ("connect_provider_id","tenant_id");