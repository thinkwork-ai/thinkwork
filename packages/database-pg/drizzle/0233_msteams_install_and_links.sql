-- Purpose: add Microsoft Teams application persistence for tenant installs, user links, and Teams conversation mapping.
-- Plan: THINK-84 (U6 install path; msteams_threads is created now so one migration covers the domain for U7)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0233_msteams_install_and_links.sql
-- creates: public.msteams_tenant_installs
-- creates: public.msteams_user_links
-- creates: public.msteams_threads
-- creates: public.uq_msteams_tenant_installs_entra_tenant
-- creates: public.uq_msteams_tenant_installs_tenant_entra_tenant
-- creates: public.idx_msteams_tenant_installs_tenant_status
-- creates: public.uq_msteams_user_links_entra_tenant_aad_object
-- creates: public.idx_msteams_user_links_tenant_user
-- creates: public.idx_msteams_user_links_user
-- creates: public.uq_msteams_threads_entra_tenant_conversation
-- creates: public.idx_msteams_threads_thread
-- creates: public.idx_msteams_threads_tenant_entra_tenant
-- creates-constraint: public.msteams_tenant_installs.msteams_tenant_installs_tenant_id_tenants_id_fk
-- creates-constraint: public.msteams_tenant_installs.msteams_tenant_installs_installed_by_user_id_users_id_fk
-- creates-constraint: public.msteams_tenant_installs.msteams_tenant_installs_status_allowed
-- creates-constraint: public.msteams_tenant_installs.msteams_tenant_installs_consent_status_allowed
-- creates-constraint: public.msteams_user_links.msteams_user_links_tenant_id_tenants_id_fk
-- creates-constraint: public.msteams_user_links.msteams_user_links_entra_tenant_id_installs_entra_tenant_id_fk
-- creates-constraint: public.msteams_user_links.msteams_user_links_user_id_users_id_fk
-- creates-constraint: public.msteams_user_links.msteams_user_links_status_allowed
-- creates-constraint: public.msteams_threads.msteams_threads_tenant_id_tenants_id_fk
-- creates-constraint: public.msteams_threads.msteams_threads_entra_tenant_id_installs_entra_tenant_id_fk
-- creates-constraint: public.msteams_threads.msteams_threads_thread_id_threads_id_fk

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.msteams_tenant_installs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entra_tenant_id text NOT NULL,
  bot_app_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  consent_status text NOT NULL DEFAULT 'pending',
  installed_by_user_id uuid,
  installed_at timestamptz,
  uninstalled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT msteams_tenant_installs_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT msteams_tenant_installs_installed_by_user_id_users_id_fk
    FOREIGN KEY (installed_by_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT msteams_tenant_installs_status_allowed
    CHECK (status IN ('pending','active','uninstalled','revoked')),
  CONSTRAINT msteams_tenant_installs_consent_status_allowed
    CHECK (consent_status IN ('pending','granted','admin_required','revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_msteams_tenant_installs_entra_tenant
  ON public.msteams_tenant_installs (entra_tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_msteams_tenant_installs_tenant_entra_tenant
  ON public.msteams_tenant_installs (tenant_id, entra_tenant_id);

CREATE INDEX IF NOT EXISTS idx_msteams_tenant_installs_tenant_status
  ON public.msteams_tenant_installs (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.msteams_user_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entra_tenant_id text NOT NULL,
  aad_object_id text NOT NULL,
  user_id uuid NOT NULL,
  display_name text,
  status text NOT NULL DEFAULT 'active',
  linked_at timestamptz NOT NULL DEFAULT now(),
  unlinked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT msteams_user_links_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT msteams_user_links_entra_tenant_id_installs_entra_tenant_id_fk
    FOREIGN KEY (entra_tenant_id)
    REFERENCES public.msteams_tenant_installs(entra_tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT msteams_user_links_user_id_users_id_fk
    FOREIGN KEY (user_id)
    REFERENCES public.users(id)
    ON DELETE RESTRICT,
  CONSTRAINT msteams_user_links_status_allowed
    CHECK (status IN ('active','unlinked','orphaned','suspended'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_msteams_user_links_entra_tenant_aad_object
  ON public.msteams_user_links (entra_tenant_id, aad_object_id);

CREATE INDEX IF NOT EXISTS idx_msteams_user_links_tenant_user
  ON public.msteams_user_links (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_msteams_user_links_user
  ON public.msteams_user_links (user_id);

CREATE TABLE IF NOT EXISTS public.msteams_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entra_tenant_id text NOT NULL,
  conversation_id text NOT NULL,
  service_url text NOT NULL,
  thread_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT msteams_threads_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT msteams_threads_entra_tenant_id_installs_entra_tenant_id_fk
    FOREIGN KEY (entra_tenant_id)
    REFERENCES public.msteams_tenant_installs(entra_tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT msteams_threads_thread_id_threads_id_fk
    FOREIGN KEY (thread_id)
    REFERENCES public.threads(id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_msteams_threads_entra_tenant_conversation
  ON public.msteams_threads (entra_tenant_id, conversation_id);

CREATE INDEX IF NOT EXISTS idx_msteams_threads_thread
  ON public.msteams_threads (thread_id);

CREATE INDEX IF NOT EXISTS idx_msteams_threads_tenant_entra_tenant
  ON public.msteams_threads (tenant_id, entra_tenant_id);

COMMIT;
