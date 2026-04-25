-- Agent operation leases for fat-folder import/swap serialization.
-- creates: public.agent_operation_leases
-- creates: public.idx_agent_operation_leases_agent_expires
-- creates: public.idx_agent_operation_leases_kind
-- creates: public.folder_bundle_import_rate_limits

CREATE TABLE IF NOT EXISTS "agent_operation_leases" (
	"agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE cascade,
	"lease_id" uuid NOT NULL DEFAULT gen_random_uuid(),
	"lease_kind" text NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" text,
	"acquired_at" timestamp with time zone NOT NULL DEFAULT now(),
	"last_heartbeat_at" timestamp with time zone NOT NULL DEFAULT now(),
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_operation_leases_pkey" PRIMARY KEY ("agent_id", "lease_id"),
	CONSTRAINT "agent_operation_leases_kind_check" CHECK ("lease_kind" IN ('shared', 'exclusive'))
);

CREATE INDEX IF NOT EXISTS "idx_agent_operation_leases_agent_expires"
	ON "agent_operation_leases" ("agent_id", "expires_at");

CREATE INDEX IF NOT EXISTS "idx_agent_operation_leases_kind"
	ON "agent_operation_leases" ("agent_id", "lease_kind");

CREATE TABLE IF NOT EXISTS "folder_bundle_import_rate_limits" (
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
	"utc_hour" timestamp with time zone NOT NULL,
	"import_count" integer NOT NULL DEFAULT 0,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "folder_bundle_import_rate_limits_pkey" PRIMARY KEY ("tenant_id", "utc_hour")
);
