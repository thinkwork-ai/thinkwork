-- Work Item Comments: first-class timeline comments for human and agent discussion.
-- creates: public.work_item_comments
-- creates: public.idx_work_item_comments_item_created
-- creates: public.idx_work_item_comments_thread
-- creates-constraint: public.work_item_comments.work_item_comments_author_required

CREATE TABLE IF NOT EXISTS work_item_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  thread_id uuid REFERENCES threads(id) ON DELETE SET NULL,
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  body text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT work_item_comments_author_required
    CHECK (author_user_id IS NOT NULL OR author_agent_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_work_item_comments_item_created
  ON work_item_comments (tenant_id, work_item_id, created_at);

CREATE INDEX IF NOT EXISTS idx_work_item_comments_thread
  ON work_item_comments (tenant_id, thread_id);

ALTER TABLE work_item_events
  DROP CONSTRAINT IF EXISTS work_item_events_type_allowed;

ALTER TABLE work_item_events
  ADD CONSTRAINT work_item_events_type_allowed
  CHECK (event_type IN ('created','updated','status_changed','completed','blocked','unblocked','assigned','due_date_changed','applicability_changed','linked_thread','agent_action','comment_added'));
