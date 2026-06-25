-- creates: public.billing_export_imports
-- creates: public.billing_export_line_items
-- creates-column: public.cost_events.billing_account_id
-- creates-column: public.cost_events.billing_service_code
-- creates-column: public.cost_events.billing_operation
-- creates-column: public.cost_events.billing_period_start
-- creates-column: public.cost_events.billing_period_end
-- creates-column: public.cost_events.billing_attribution_level

ALTER TABLE "cost_events"
  ADD COLUMN IF NOT EXISTS "billing_account_id" text,
  ADD COLUMN IF NOT EXISTS "billing_service_code" text,
  ADD COLUMN IF NOT EXISTS "billing_operation" text,
  ADD COLUMN IF NOT EXISTS "billing_period_start" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "billing_period_end" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "billing_attribution_level" text;

CREATE INDEX IF NOT EXISTS "idx_cost_events_billing_period"
  ON "cost_events" ("tenant_id", "billing_service_code", "billing_period_start");

CREATE TABLE IF NOT EXISTS "billing_export_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text DEFAULT 'aws' NOT NULL,
  "source_type" text DEFAULT 'aws_cur' NOT NULL,
  "manifest_bucket" text NOT NULL,
  "manifest_key" text NOT NULL,
  "billing_period_start" timestamp with time zone NOT NULL,
  "billing_period_end" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'imported' NOT NULL,
  "row_count" integer DEFAULT 0 NOT NULL,
  "error_count" integer DEFAULT 0 NOT NULL,
  "error_summary" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "imported_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_export_imports_status_check"
    CHECK ("status" IN ('imported', 'imported_with_errors', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_export_imports_manifest_uidx"
  ON "billing_export_imports" ("provider", "manifest_bucket", "manifest_key");

CREATE INDEX IF NOT EXISTS "billing_export_imports_period_idx"
  ON "billing_export_imports" (
    "provider",
    "billing_period_start",
    "billing_period_end"
  );

CREATE TABLE IF NOT EXISTS "billing_export_line_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_id" uuid NOT NULL REFERENCES "billing_export_imports"("id") ON DELETE cascade,
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE set null,
  "provider" text DEFAULT 'aws' NOT NULL,
  "line_item_id" text NOT NULL,
  "usage_account_id" text,
  "service_code" text NOT NULL,
  "operation" text NOT NULL,
  "line_item_type" text,
  "usage_start" timestamp with time zone NOT NULL,
  "usage_end" timestamp with time zone NOT NULL,
  "billing_period_start" timestamp with time zone NOT NULL,
  "billing_period_end" timestamp with time zone NOT NULL,
  "amount_usd" numeric(12, 6) NOT NULL,
  "usage_amount" numeric(20, 6),
  "currency" text DEFAULT 'USD' NOT NULL,
  "model" text DEFAULT 'unknown' NOT NULL,
  "region" text,
  "resource_id" text,
  "attribution_level" text NOT NULL,
  "attribution_key" text NOT NULL,
  "source_uri" text NOT NULL,
  "raw_row" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_export_line_items_attribution_check"
    CHECK ("attribution_level" IN ('tenant', 'account', 'service_window'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_export_line_items_import_line_uidx"
  ON "billing_export_line_items" ("import_id", "line_item_id");

CREATE INDEX IF NOT EXISTS "billing_export_line_items_period_idx"
  ON "billing_export_line_items" (
    "provider",
    "billing_period_start",
    "billing_period_end"
  );

CREATE INDEX IF NOT EXISTS "billing_export_line_items_tenant_idx"
  ON "billing_export_line_items" (
    "tenant_id",
    "service_code",
    "billing_period_start"
  );

CREATE INDEX IF NOT EXISTS "billing_export_line_items_attribution_idx"
  ON "billing_export_line_items" (
    "provider",
    "attribution_level",
    "attribution_key"
  );
