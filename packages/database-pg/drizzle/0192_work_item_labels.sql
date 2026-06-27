-- creates: public.work_item_labels
-- creates: public.work_item_label_assignments
-- creates: public.uq_work_item_labels_tenant_slug
-- creates: public.idx_work_item_labels_tenant_active
-- creates: public.uq_work_item_label_assignments_pair
-- creates: public.idx_work_item_label_assignments_label
-- creates: public.idx_work_item_label_assignments_item

CREATE TABLE IF NOT EXISTS "work_item_labels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "color" text,
  "description" text,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_work_item_labels_tenant_slug"
  ON "work_item_labels" ("tenant_id", "slug");

CREATE INDEX IF NOT EXISTS "idx_work_item_labels_tenant_active"
  ON "work_item_labels" ("tenant_id", "archived_at", "name");

CREATE TABLE IF NOT EXISTS "work_item_label_assignments" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "work_item_id" uuid NOT NULL REFERENCES "work_items"("id") ON DELETE cascade,
  "label_id" uuid NOT NULL REFERENCES "work_item_labels"("id") ON DELETE cascade,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_work_item_label_assignments_pair"
  ON "work_item_label_assignments" ("tenant_id", "work_item_id", "label_id");

CREATE INDEX IF NOT EXISTS "idx_work_item_label_assignments_label"
  ON "work_item_label_assignments" ("tenant_id", "label_id", "work_item_id");

CREATE INDEX IF NOT EXISTS "idx_work_item_label_assignments_item"
  ON "work_item_label_assignments" ("tenant_id", "work_item_id");

