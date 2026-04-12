CREATE TABLE "workflow_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"team_id" uuid,
	"dispatch" jsonb,
	"concurrency" jsonb,
	"retry" jsonb,
	"turn_loop" jsonb,
	"workspace" jsonb,
	"stall_detection" jsonb,
	"orchestration" jsonb,
	"session_compaction" jsonb,
	"prompt_template" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mcp_server_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_template_mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mcp_server_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"url" text NOT NULL,
	"transport" text DEFAULT 'streamable-http' NOT NULL,
	"auth_type" text DEFAULT 'none' NOT NULL,
	"auth_config" jsonb,
	"oauth_provider" text,
	"tools" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_mcp_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mcp_server_id" uuid NOT NULL,
	"secret_ref" text NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_builtin_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tool_slug" text NOT NULL,
	"provider" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb,
	"secret_ref" text,
	"last_tested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_configs" ADD CONSTRAINT "workflow_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_configs" ADD CONSTRAINT "workflow_configs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mcp_servers" ADD CONSTRAINT "agent_mcp_servers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mcp_servers" ADD CONSTRAINT "agent_mcp_servers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mcp_servers" ADD CONSTRAINT "agent_mcp_servers_mcp_server_id_tenant_mcp_servers_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."tenant_mcp_servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_template_mcp_servers" ADD CONSTRAINT "agent_template_mcp_servers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_template_mcp_servers" ADD CONSTRAINT "agent_template_mcp_servers_mcp_server_id_tenant_mcp_servers_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."tenant_mcp_servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_mcp_servers" ADD CONSTRAINT "tenant_mcp_servers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mcp_tokens" ADD CONSTRAINT "user_mcp_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mcp_tokens" ADD CONSTRAINT "user_mcp_tokens_mcp_server_id_tenant_mcp_servers_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."tenant_mcp_servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_builtin_tools" ADD CONSTRAINT "tenant_builtin_tools_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_configs_tenant_idx" ON "workflow_configs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workflow_configs_tenant_team_idx" ON "workflow_configs" USING btree ("tenant_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_mcp_servers" ON "agent_mcp_servers" USING btree ("agent_id","mcp_server_id");--> statement-breakpoint
CREATE INDEX "idx_agent_mcp_servers_agent" ON "agent_mcp_servers" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_template_mcp_servers" ON "agent_template_mcp_servers" USING btree ("template_id","mcp_server_id");--> statement-breakpoint
CREATE INDEX "idx_agent_template_mcp_servers_template" ON "agent_template_mcp_servers" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tenant_mcp_servers_slug" ON "tenant_mcp_servers" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "idx_tenant_mcp_servers_tenant" ON "tenant_mcp_servers" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_mcp_tokens" ON "user_mcp_tokens" USING btree ("user_id","mcp_server_id");--> statement-breakpoint
CREATE INDEX "idx_user_mcp_tokens_user" ON "user_mcp_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tenant_builtin_tools" ON "tenant_builtin_tools" USING btree ("tenant_id","tool_slug");--> statement-breakpoint
CREATE INDEX "idx_tenant_builtin_tools_tenant" ON "tenant_builtin_tools" USING btree ("tenant_id");