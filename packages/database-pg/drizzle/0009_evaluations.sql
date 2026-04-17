CREATE TABLE "eval_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"test_case_id" uuid,
	"status" text NOT NULL,
	"score" numeric(5, 4),
	"duration_ms" integer,
	"agent_session_id" text,
	"input" text,
	"expected" text,
	"actual_output" text,
	"evaluator_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assertions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"model" text,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"total_tests" integer DEFAULT 0 NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"pass_rate" numeric(5, 4),
	"regression" boolean DEFAULT false NOT NULL,
	"cost_usd" numeric(12, 6),
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_test_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"query" text NOT NULL,
	"system_prompt" text,
	"assertions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agentcore_evaluator_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_results" ADD CONSTRAINT "eval_results_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_results" ADD CONSTRAINT "eval_results_test_case_id_eval_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."eval_test_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_test_cases" ADD CONSTRAINT "eval_test_cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_eval_results_run" ON "eval_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_eval_results_test_case_created" ON "eval_results" USING btree ("test_case_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_eval_runs_tenant_created" ON "eval_runs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_eval_runs_tenant_agent_created" ON "eval_runs" USING btree ("tenant_id","agent_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_eval_runs_tenant_status" ON "eval_runs" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_eval_test_cases_tenant_category" ON "eval_test_cases" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "idx_eval_test_cases_tenant_enabled" ON "eval_test_cases" USING btree ("tenant_id","enabled");