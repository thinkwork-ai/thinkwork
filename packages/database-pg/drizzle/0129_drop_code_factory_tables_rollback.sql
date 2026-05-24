-- Rollback for 0129_drop_code_factory_tables.sql.
--
-- Recreates the three code_factory_* table shapes that existed before the drop.
-- Shapes captured by `pg_dump --schema-only -t 'public.code_factory_*'` against
-- thinkwork-dev as of 2026-05-24 pre-drop. Schema-only restore; no data.
--
-- creates: public.code_factory_repos
-- creates: public.code_factory_jobs
-- creates: public.code_factory_runs
-- creates: public.uq_code_factory_repos_owner_repo

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS public.code_factory_repos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    github_owner text NOT NULL,
    github_repo text NOT NULL,
    github_installation_id integer,
    default_branch text,
    status text DEFAULT 'active'::text NOT NULL,
    config jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT code_factory_repos_pkey PRIMARY KEY (id),
    CONSTRAINT code_factory_repos_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

CREATE TABLE IF NOT EXISTS public.code_factory_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    repo_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    agent_id uuid,
    name text NOT NULL,
    type text NOT NULL,
    config jsonb,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT code_factory_jobs_pkey PRIMARY KEY (id),
    CONSTRAINT code_factory_jobs_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id),
    CONSTRAINT code_factory_jobs_repo_id_code_factory_repos_id_fk FOREIGN KEY (repo_id) REFERENCES public.code_factory_repos(id),
    CONSTRAINT code_factory_jobs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

CREATE TABLE IF NOT EXISTS public.code_factory_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    commit_sha text,
    branch text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT code_factory_runs_pkey PRIMARY KEY (id),
    CONSTRAINT code_factory_runs_job_id_code_factory_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.code_factory_jobs(id),
    CONSTRAINT code_factory_runs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_code_factory_repos_owner_repo ON public.code_factory_repos USING btree (github_owner, github_repo);

COMMIT;
