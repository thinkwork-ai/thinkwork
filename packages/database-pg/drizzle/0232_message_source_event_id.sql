-- creates-column: public.messages.source_event_id
-- creates: public.uq_messages_tenant_source_event_id

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS source_event_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_tenant_source_event_id
  ON public.messages (tenant_id, source_event_id)
  WHERE source_event_id IS NOT NULL;
