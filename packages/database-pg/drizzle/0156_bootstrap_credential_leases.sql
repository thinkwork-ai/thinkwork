-- Bootstrap credential lease metadata for browser-first customer deployments.
--
-- Credential material lives only in AWS Secrets Manager. This table stores
-- lease metadata, redaction-safe fingerprints, and cleanup state.
--
-- creates: public.bootstrap_credential_leases
-- creates: public.bootstrap_credential_leases_session_idx
-- creates: public.bootstrap_credential_leases_status_expires_idx
-- creates: public.bootstrap_credential_leases_secret_arn_uidx

CREATE TABLE IF NOT EXISTS "bootstrap_credential_leases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "customer_deployment_sessions"("id") ON DELETE cascade,
  "status" text NOT NULL DEFAULT 'pending',
  "lease_type" text NOT NULL,
  "secret_arn" text NOT NULL,
  "secret_fingerprint" text NOT NULL,
  "external_id_hash" text,
  "role_arn" text,
  "expires_at" timestamp with time zone NOT NULL,
  "validated_at" timestamp with time zone,
  "in_use_at" timestamp with time zone,
  "transferred_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "failed_cleanup_reason" text,
  "audit_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "bootstrap_credential_leases_status_allowed" CHECK (
    "status" IN (
      'pending',
      'validated',
      'in_use',
      'transferred',
      'revoked',
      'expired',
      'failed_cleanup'
    )
  ),
  CONSTRAINT "bootstrap_credential_leases_type_allowed" CHECK (
    "lease_type" IN ('temporary_credentials', 'assumable_role')
  )
);

CREATE INDEX IF NOT EXISTS "bootstrap_credential_leases_session_idx"
  ON "bootstrap_credential_leases" ("session_id");

CREATE INDEX IF NOT EXISTS "bootstrap_credential_leases_status_expires_idx"
  ON "bootstrap_credential_leases" ("status", "expires_at");

CREATE UNIQUE INDEX IF NOT EXISTS "bootstrap_credential_leases_secret_arn_uidx"
  ON "bootstrap_credential_leases" ("secret_arn");
