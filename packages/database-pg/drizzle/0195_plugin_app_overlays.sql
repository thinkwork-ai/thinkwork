-- Plugin App Overlays: durable ThinkWork-owned state for trusted plugin apps.
-- creates: public.plugin_app_overlays
-- creates: public.uq_plugin_app_overlays_identity
-- creates: public.idx_plugin_app_overlays_record
-- creates: public.idx_plugin_app_overlays_updated

CREATE TABLE IF NOT EXISTS plugin_app_overlays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plugin_install_id uuid NOT NULL REFERENCES plugin_installs(id) ON DELETE CASCADE,
  app_surface_key text NOT NULL,
  app_key text NOT NULL,
  provider text NOT NULL,
  provider_record_type text NOT NULL,
  provider_record_id text NOT NULL,
  section_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plugin_app_overlays_identity
  ON plugin_app_overlays (
    tenant_id,
    plugin_install_id,
    app_surface_key,
    provider,
    provider_record_type,
    provider_record_id,
    section_key
  );

CREATE INDEX IF NOT EXISTS idx_plugin_app_overlays_record
  ON plugin_app_overlays (
    tenant_id,
    app_key,
    provider,
    provider_record_type,
    provider_record_id
  );

CREATE INDEX IF NOT EXISTS idx_plugin_app_overlays_updated
  ON plugin_app_overlays (tenant_id, app_key, updated_at);
