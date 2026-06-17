-- Purpose: add provider-neutral Email Channel plugin state, policy, ledger, and SES compatibility tables.
-- Plan: docs/plans/2026-06-17-003-feat-email-channel-plugin-plan.md (U2)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0170_email_channel_plugin.sql
-- creates: public.email_provider_installs
-- creates: public.email_domains
-- creates: public.email_readiness_checks
-- creates: public.email_space_policies
-- creates: public.email_space_sender_allowlists
-- creates: public.email_conversations
-- creates: public.email_body_objects
-- creates: public.email_ledger_events
-- creates: public.email_provider_events
-- creates: public.email_ses_compatibility_mappings
-- creates: public.uq_email_provider_installs_tenant_provider
-- creates: public.uq_email_provider_installs_active
-- creates: public.idx_email_provider_installs_tenant
-- creates: public.idx_email_provider_installs_provider_status
-- creates: public.uq_email_domains_tenant_domain
-- creates: public.idx_email_domains_provider
-- creates: public.idx_email_domains_tenant_status
-- creates: public.uq_email_readiness_check_scope
-- creates: public.idx_email_readiness_provider
-- creates: public.idx_email_readiness_tenant_status
-- creates: public.uq_email_space_policies_space
-- creates: public.idx_email_space_policies_provider
-- creates: public.uq_email_sender_allowlist_value
-- creates: public.idx_email_sender_allowlist_space
-- creates: public.idx_email_conversations_tenant_status
-- creates: public.idx_email_conversations_space
-- creates: public.idx_email_conversations_thread
-- creates: public.uq_email_conversations_thread_participants
-- creates: public.idx_email_body_objects_conversation
-- creates: public.idx_email_body_objects_retention
-- creates: public.idx_email_ledger_tenant_created
-- creates: public.idx_email_ledger_conversation
-- creates: public.idx_email_ledger_space
-- creates: public.idx_email_ledger_provider_message
-- creates: public.uq_email_provider_events_provider_event
-- creates: public.idx_email_provider_events_message
-- creates: public.idx_email_provider_events_type_created
-- creates: public.uq_email_ses_mapping_token
-- creates: public.idx_email_ses_mapping_message
-- creates: public.idx_email_ses_mapping_conversation

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.email_provider_installs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  display_name text,
  status text NOT NULL DEFAULT 'pending',
  active_for_production boolean NOT NULL DEFAULT false,
  credential_secret_ref text,
  webhook_secret_ref text,
  default_from_email text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_provider_installs_provider_allowed CHECK (provider IN ('resend', 'ses')),
  CONSTRAINT email_provider_installs_status_allowed CHECK (status IN ('pending', 'ready', 'failed', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_provider_installs_active
  ON public.email_provider_installs (tenant_id)
  WHERE active_for_production = true;
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_provider_installs_tenant_provider
  ON public.email_provider_installs (tenant_id, provider);
CREATE INDEX IF NOT EXISTS idx_email_provider_installs_tenant
  ON public.email_provider_installs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_email_provider_installs_provider_status
  ON public.email_provider_installs (tenant_id, provider, status);

CREATE TABLE IF NOT EXISTS public.email_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_install_id uuid NOT NULL REFERENCES public.email_provider_installs(id) ON DELETE CASCADE,
  domain text NOT NULL,
  ownership_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  sending_verified_at timestamptz,
  inbound_verified_at timestamptz,
  dns_records jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_domains_ownership_allowed CHECK (ownership_type IN ('thinkwork_owned', 'customer_owned')),
  CONSTRAINT email_domains_status_allowed CHECK (status IN ('pending', 'verified', 'failed', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_domains_tenant_domain
  ON public.email_domains (tenant_id, domain);
CREATE INDEX IF NOT EXISTS idx_email_domains_provider
  ON public.email_domains (provider_install_id);
CREATE INDEX IF NOT EXISTS idx_email_domains_tenant_status
  ON public.email_domains (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.email_readiness_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_install_id uuid NOT NULL REFERENCES public.email_provider_installs(id) ON DELETE CASCADE,
  domain_id uuid REFERENCES public.email_domains(id) ON DELETE CASCADE,
  check_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  last_checked_at timestamptz,
  failure_code text,
  failure_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_readiness_check_key_allowed CHECK (check_key IN ('credentials', 'sending_domain', 'inbound_receiving', 'webhook_signature', 'provider_events', 'loop_test')),
  CONSTRAINT email_readiness_status_allowed CHECK (status IN ('pending', 'pass', 'fail', 'blocked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_readiness_check_scope
  ON public.email_readiness_checks (
    tenant_id,
    provider_install_id,
    COALESCE(domain_id, '00000000-0000-0000-0000-000000000000'::uuid),
    check_key
  );
CREATE INDEX IF NOT EXISTS idx_email_readiness_provider
  ON public.email_readiness_checks (provider_install_id);
CREATE INDEX IF NOT EXISTS idx_email_readiness_tenant_status
  ON public.email_readiness_checks (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.email_space_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  provider_install_id uuid REFERENCES public.email_provider_installs(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT false,
  registered_users_allowed boolean NOT NULL DEFAULT true,
  private_space_membership_required boolean NOT NULL DEFAULT true,
  outside_sender_default text NOT NULL DEFAULT 'deny',
  first_send_review_required boolean NOT NULL DEFAULT true,
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_space_policies_outside_default_allowed CHECK (outside_sender_default IN ('deny', 'allowlist'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_space_policies_space
  ON public.email_space_policies (tenant_id, space_id);
CREATE INDEX IF NOT EXISTS idx_email_space_policies_provider
  ON public.email_space_policies (provider_install_id);

CREATE TABLE IF NOT EXISTS public.email_space_sender_allowlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  value_type text NOT NULL,
  value text NOT NULL,
  reason text,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_sender_allowlist_type_allowed CHECK (value_type IN ('email', 'domain'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_sender_allowlist_value
  ON public.email_space_sender_allowlists (tenant_id, space_id, value_type, value);
CREATE INDEX IF NOT EXISTS idx_email_sender_allowlist_space
  ON public.email_space_sender_allowlists (tenant_id, space_id);

CREATE TABLE IF NOT EXISTS public.email_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  space_id uuid REFERENCES public.spaces(id) ON DELETE SET NULL,
  thread_id uuid REFERENCES public.threads(id) ON DELETE SET NULL,
  provider_install_id uuid REFERENCES public.email_provider_installs(id) ON DELETE SET NULL,
  subject text,
  status text NOT NULL DEFAULT 'pending_approval',
  approved_at timestamptz,
  approved_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  last_message_at timestamptz,
  participant_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_conversations_status_allowed CHECK (status IN ('pending_approval', 'approved', 'closed', 'blocked'))
);

CREATE INDEX IF NOT EXISTS idx_email_conversations_tenant_status
  ON public.email_conversations (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_email_conversations_space
  ON public.email_conversations (tenant_id, space_id);
CREATE INDEX IF NOT EXISTS idx_email_conversations_thread
  ON public.email_conversations (thread_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_conversations_thread_participants
  ON public.email_conversations (tenant_id, thread_id, participant_hash)
  WHERE thread_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.email_body_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.email_conversations(id) ON DELETE CASCADE,
  direction text NOT NULL,
  content_hash text NOT NULL,
  object_ref text NOT NULL,
  retention_until timestamptz NOT NULL,
  redacted_at timestamptz,
  redacted_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  redaction_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_body_objects_direction_allowed CHECK (direction IN ('inbound', 'outbound'))
);

CREATE INDEX IF NOT EXISTS idx_email_body_objects_conversation
  ON public.email_body_objects (conversation_id);
CREATE INDEX IF NOT EXISTS idx_email_body_objects_retention
  ON public.email_body_objects (tenant_id, retention_until);

CREATE TABLE IF NOT EXISTS public.email_ledger_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.email_conversations(id) ON DELETE SET NULL,
  space_id uuid REFERENCES public.spaces(id) ON DELETE SET NULL,
  thread_id uuid REFERENCES public.threads(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  inbox_item_id uuid REFERENCES public.inbox_items(id) ON DELETE SET NULL,
  provider_install_id uuid REFERENCES public.email_provider_installs(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  provider_message_id text,
  provider_event_id text,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  body_object_id uuid REFERENCES public.email_body_objects(id) ON DELETE SET NULL,
  subject text,
  from_email text,
  to_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_ledger_events_type_allowed CHECK (event_type IN ('draft_created', 'approval_requested', 'approval_approved', 'approval_denied', 'send_blocked', 'send_attempted', 'send_succeeded', 'send_failed', 'inbound_received', 'inbound_authorized', 'inbound_rejected', 'provider_event', 'readiness_check', 'body_retained', 'body_redacted'))
);

CREATE INDEX IF NOT EXISTS idx_email_ledger_tenant_created
  ON public.email_ledger_events (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_email_ledger_conversation
  ON public.email_ledger_events (conversation_id);
CREATE INDEX IF NOT EXISTS idx_email_ledger_space
  ON public.email_ledger_events (tenant_id, space_id);
CREATE INDEX IF NOT EXISTS idx_email_ledger_provider_message
  ON public.email_ledger_events (tenant_id, provider_message_id);

CREATE TABLE IF NOT EXISTS public.email_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_install_id uuid NOT NULL REFERENCES public.email_provider_installs(id) ON DELETE CASCADE,
  ledger_event_id uuid REFERENCES public.email_ledger_events(id) ON DELETE SET NULL,
  provider_event_id text NOT NULL,
  provider_message_id text,
  event_type text NOT NULL,
  occurred_at timestamptz,
  payload_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_provider_events_type_allowed CHECK (event_type IN ('sent', 'delivered', 'delayed', 'failed', 'bounced', 'complained', 'opened', 'clicked', 'received'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_provider_events_provider_event
  ON public.email_provider_events (provider_install_id, provider_event_id);
CREATE INDEX IF NOT EXISTS idx_email_provider_events_message
  ON public.email_provider_events (tenant_id, provider_message_id);
CREATE INDEX IF NOT EXISTS idx_email_provider_events_type_created
  ON public.email_provider_events (provider_install_id, event_type, created_at);

CREATE TABLE IF NOT EXISTS public.email_ses_compatibility_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_install_id uuid NOT NULL REFERENCES public.email_provider_installs(id) ON DELETE CASCADE,
  reply_token_id uuid REFERENCES public.email_reply_tokens(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.email_conversations(id) ON DELETE SET NULL,
  ses_message_id text,
  legacy_thread_id uuid REFERENCES public.threads(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_ses_mapping_token
  ON public.email_ses_compatibility_mappings (reply_token_id);
CREATE INDEX IF NOT EXISTS idx_email_ses_mapping_message
  ON public.email_ses_compatibility_mappings (tenant_id, ses_message_id);
CREATE INDEX IF NOT EXISTS idx_email_ses_mapping_conversation
  ON public.email_ses_compatibility_mappings (conversation_id);

COMMIT;
