-- THINK-302 U1: capability approval registry — scope-qualified bindings.
--
-- A row authorizes SPECIFIC definition bytes (marker sha + whole-folder
-- content-sha attestation) at ONE scope_ref (agent:<id>, agent:<id>/sub:<slug>,
-- space:<id>, or user:<id>). Identical bytes at any other scope are
-- unauthorized until separately bound (AE10 — copy-to-root escalation stays
-- inert). Append-only history: re-approval inserts a new row; compile trusts
-- the latest binding per (tenant, scope_ref, class, slug).
--
-- Ships inert: no production code path consults the table until compile v6
-- (THINK-302 U3) wires it behind the per-tenant registry-trust flag.
--
-- Hand-rolled (CHECK constraint); not in meta/_journal.json. Apply with:
--   psql "$DATABASE_URL" -f drizzle/0257_capability_approvals.sql
-- creates: public.capability_approvals

BEGIN;

CREATE TABLE IF NOT EXISTS public.capability_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Binding location. Part of the key: approval at one scope authorizes
  -- nothing anywhere else.
  scope_ref text NOT NULL,
  -- Capability class segment: 'skill' | 'tool' | 'connection' | 'mcp'.
  class text NOT NULL,
  slug text NOT NULL,
  -- sha256 hex of the marker file bytes (frontmatter + body).
  marker_sha text NOT NULL,
  -- Deterministic whole-folder manifest hash: sha256 over the sorted
  -- (folder-relative path, per-file content sha256) pairs.
  folder_attestation_sha text NOT NULL,
  -- Zero-read fast-path snapshot: the script-trust-style digest over sorted
  -- (path, S3 ETag) pairs at binding time. Nullable — content shas are the
  -- approval authority; this only lets compile skip re-reading bytes.
  files_etag_signature text,
  definition_id uuid REFERENCES public.capability_definitions(id) ON DELETE SET NULL,
  -- CapabilitySignedBy provenance: operator:<id> | autonomous:<agentId> | backfill | ...
  signed_by text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capability_approvals_scope_ref_check
    CHECK (scope_ref ~ '^(agent:[^/]+(/sub:[^/]+)?|space:[^/]+|user:[^/]+)$'),
  CONSTRAINT capability_approvals_sha_check
    CHECK (marker_sha ~ '^[0-9a-f]{64}$' AND folder_attestation_sha ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_capability_approvals_lookup
  ON public.capability_approvals (tenant_id, scope_ref, class, slug);
CREATE INDEX IF NOT EXISTS idx_capability_approvals_definition
  ON public.capability_approvals (definition_id);

COMMIT;
