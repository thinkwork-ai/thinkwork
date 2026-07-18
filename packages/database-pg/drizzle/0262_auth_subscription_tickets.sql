-- One-use AppSync authorization tickets and durable revocation invalidations.
-- creates: public.auth_subscription_tickets
-- creates: public.auth_subscription_invalidations

CREATE TABLE IF NOT EXISTS "auth_subscription_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "nonce_digest" text NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'issued' NOT NULL,
  "stage" text NOT NULL,
  "appsync_api_id" text NOT NULL,
  "key_id" text NOT NULL,
  "cognito_issuer" text NOT NULL,
  "cognito_sub" text NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE restrict,
  "auth_route_client_id" uuid NOT NULL REFERENCES "auth_route_clients"("id") ON DELETE restrict,
  "operation_name" text,
  "operation_hash" text,
  "resource_kind" text,
  "resource_id" text,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "auth_subscription_tickets_kind_allowed"
    CHECK ("kind" IN ('connect', 'registration')),
  CONSTRAINT "auth_subscription_tickets_status_allowed"
    CHECK ("status" IN ('issued', 'consumed', 'expired', 'revoked')),
  CONSTRAINT "auth_subscription_tickets_operation_shape"
    CHECK (("kind" = 'connect' AND "operation_name" IS NULL AND "operation_hash" IS NULL)
      OR ("kind" = 'registration' AND "operation_name" IS NOT NULL AND "operation_hash" IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_auth_subscription_tickets_nonce"
  ON "auth_subscription_tickets" ("nonce_digest");
CREATE INDEX IF NOT EXISTS "idx_auth_subscription_tickets_principal"
  ON "auth_subscription_tickets" ("cognito_issuer", "cognito_sub", "status");
CREATE INDEX IF NOT EXISTS "idx_auth_subscription_tickets_expiry"
  ON "auth_subscription_tickets" ("status", "expires_at");

CREATE TABLE IF NOT EXISTS "auth_subscription_invalidations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE restrict,
  "user_id" uuid REFERENCES "users"("id") ON DELETE restrict,
  "resource_kind" text NOT NULL,
  "resource_id" text,
  "reason" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "auth_subscription_invalidations_status_allowed"
    CHECK ("status" IN ('pending', 'processing', 'complete', 'failed'))
);

CREATE INDEX IF NOT EXISTS "idx_auth_subscription_invalidations_pending"
  ON "auth_subscription_invalidations" ("status", "available_at");
