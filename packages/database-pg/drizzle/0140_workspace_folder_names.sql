-- creates-column: public.agents.workspace_folder_name
-- creates-column: public.spaces.workspace_folder_name
-- creates-column: public.users.workspace_folder_name
-- creates-column: public.threads.workspace_folder_name
-- creates-column: public.goals.workspace_folder_name
-- creates: public.uq_agents_tenant_workspace_folder_name
-- creates: public.uq_spaces_tenant_workspace_folder_name
-- creates: public.uq_users_tenant_workspace_folder_name
-- creates: public.uq_threads_tenant_workspace_folder_name
-- creates: public.uq_goals_tenant_workspace_folder_name

ALTER TABLE agents ADD COLUMN IF NOT EXISTS workspace_folder_name text;
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS workspace_folder_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS workspace_folder_name text;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS workspace_folder_name text;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS workspace_folder_name text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_tenant_workspace_folder_name
  ON agents (tenant_id, workspace_folder_name)
  WHERE workspace_folder_name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_spaces_tenant_workspace_folder_name
  ON spaces (tenant_id, workspace_folder_name)
  WHERE workspace_folder_name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_workspace_folder_name
  ON users (tenant_id, workspace_folder_name)
  WHERE workspace_folder_name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_threads_tenant_workspace_folder_name
  ON threads (tenant_id, workspace_folder_name)
  WHERE workspace_folder_name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_goals_tenant_workspace_folder_name
  ON goals (tenant_id, workspace_folder_name)
  WHERE workspace_folder_name IS NOT NULL;
