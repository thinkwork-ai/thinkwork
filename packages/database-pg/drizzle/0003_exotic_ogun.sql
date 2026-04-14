ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk";
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE set null ON UPDATE no action;