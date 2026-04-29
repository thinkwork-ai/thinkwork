-- creates: public.tenant_context_provider_settings
CREATE TABLE IF NOT EXISTS "tenant_context_provider_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "provider_id" text NOT NULL,
  "family" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "default_enabled" boolean DEFAULT false NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_tested_at" timestamp with time zone,
  "last_test_state" text,
  "last_test_latency_ms" integer,
  "last_test_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_tenant_context_provider_settings_provider"
  ON "tenant_context_provider_settings" ("tenant_id", "provider_id");

CREATE INDEX IF NOT EXISTS "idx_tenant_context_provider_settings_tenant"
  ON "tenant_context_provider_settings" ("tenant_id");
