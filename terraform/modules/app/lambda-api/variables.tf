variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "account_id" {
  description = "AWS account ID"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "lambda_artifact_bucket" {
  description = "S3 bucket containing Lambda deployment artifacts"
  type        = string
}

variable "lambda_artifact_prefix" {
  description = "S3 key prefix for Lambda artifacts (e.g. v0.1.0/lambdas)"
  type        = string
  default     = "latest/lambdas"
}

# ---------------------------------------------------------------------------
# Dependencies from other tiers
# ---------------------------------------------------------------------------

variable "db_cluster_arn" {
  description = "Aurora cluster ARN"
  type        = string
}

variable "graphql_db_secret_arn" {
  description = "Secrets Manager ARN for DB credentials"
  type        = string
}

variable "db_cluster_endpoint" {
  description = "Aurora cluster endpoint (hostname)"
  type        = string
  default     = ""
}

variable "database_name" {
  description = "Aurora database name"
  type        = string
  default     = "thinkwork"
}

variable "bucket_name" {
  description = "Primary S3 bucket name"
  type        = string
}

variable "bucket_arn" {
  description = "Primary S3 bucket ARN"
  type        = string
}

variable "user_pool_id" {
  description = "Cognito user pool ID"
  type        = string
}

variable "user_pool_arn" {
  description = "Cognito user pool ARN"
  type        = string
}

variable "admin_client_id" {
  description = "Cognito web admin client ID"
  type        = string
}

variable "mobile_client_id" {
  description = "Cognito mobile client ID"
  type        = string
}

variable "appsync_api_url" {
  description = "AppSync subscriptions endpoint URL"
  type        = string
}

variable "appsync_api_key" {
  description = "AppSync API key"
  type        = string
  sensitive   = true
}

variable "kb_service_role_arn" {
  description = "Bedrock Knowledge Base service role ARN"
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN for custom API domain"
  type        = string
  default     = ""
}

variable "custom_domain" {
  description = "Custom domain for the API (e.g. api.thinkwork.ai). Leave empty to skip."
  type        = string
  default     = ""
}

variable "lambda_zips_dir" {
  description = "Local directory containing Lambda zip artifacts (from scripts/build-lambdas.sh). Set to enable real handlers."
  type        = string
  default     = ""
}

variable "db_password" {
  description = "Database password (used to construct DATABASE_URL for Lambda)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "db_username" {
  description = "Database username"
  type        = string
  default     = "thinkwork_admin"
}

variable "api_auth_secret" {
  description = "Shared secret for inter-service API authentication"
  type        = string
  sensitive   = true
  default     = ""
}

variable "hindsight_endpoint" {
  description = "Hindsight API endpoint (empty when enable_hindsight = false)"
  type        = string
  default     = ""
}

variable "agentcore_memory_id" {
  description = "Bedrock AgentCore Memory resource ID — used by the GraphQL memory resolvers to list records across tenant agents."
  type        = string
  default     = ""
}

variable "memory_engine" {
  description = "Active long-term memory engine for this deployment. Exactly one engine is canonical for recall/inspect/export. Defaults to 'hindsight' for hosted ThinkWork; self-hosted/serverless deployments may choose 'agentcore'."
  type        = string
  default     = "hindsight"
  validation {
    condition     = contains(["hindsight", "agentcore"], var.memory_engine)
    error_message = "memory_engine must be 'hindsight' or 'agentcore'."
  }
}

variable "agentcore_function_name" {
  description = "AgentCore Lambda function name (for direct SDK invoke)"
  type        = string
  default     = ""
}

variable "agentcore_function_arn" {
  description = "AgentCore Lambda function ARN (used to grant lambda:InvokeFunction)"
  type        = string
  default     = ""
}

variable "admin_url" {
  description = "Admin app URL (e.g. https://d3li9vbqnhv7w.cloudfront.net)"
  type        = string
  default     = ""
}

variable "docs_url" {
  description = "Docs site URL (e.g. https://d2grg1uavrp7lx.cloudfront.net)"
  type        = string
  default     = ""
}

variable "www_url" {
  description = "Marketing site URL (e.g. https://thinkwork.ai). Used for Stripe Checkout cancel_url and CORS origin."
  type        = string
  default     = ""
}

variable "stripe_price_ids_json" {
  description = "JSON object mapping internal plan names to Stripe price IDs for this stage, e.g. {\"starter\":\"price_...\",\"team\":\"price_...\"}. Non-secret; per-stage. Default is an empty object so Lambdas boot even before pricing is configured."
  type        = string
  default     = "{}"
}

variable "appsync_realtime_url" {
  description = "AppSync realtime/WebSocket endpoint URL"
  type        = string
  default     = ""
}

variable "ecr_repository_url" {
  description = "ECR repository URL for AgentCore container"
  type        = string
  default     = ""
}

variable "cors_allowed_origins" {
  description = "Allowed CORS origins for the API Gateway. Use [\"*\"] for development."
  type        = list(string)
  default     = ["*"]
}

variable "job_scheduler_role_arn" {
  description = "IAM role ARN that EventBridge Scheduler assumes to invoke the job-trigger Lambda. Passed from the job-triggers module."
  type        = string
  default     = ""
}

variable "lastmile_tasks_api_url" {
  description = "Base URL of the LastMile Tasks REST API used by the outbound sync path (POST /tasks, GET /workflows, etc). Leave blank to feature-flag the integration off; mobile-created tasks then land in sync_status='local' until the URL is set."
  type        = string
  default     = ""
}

variable "wiki_compile_model_id" {
  description = "Bedrock model id the wiki-compile Lambda uses for the leaf planner, aggregation planner, and section writer. Any Converse-compatible model works. Override per-env if you want to spike a different model without re-deploying code."
  type        = string
  default     = "openai.gpt-oss-120b-1:0"
}

variable "wiki_aggregation_pass_enabled" {
  description = "Feature flag for the wiki aggregation pass (parent section rollups + section promotion). Pipeline stops after leaf compile when this is off and never populates hub rollups. Stored as a string because the Lambda reads it verbatim from env; must be 'true' / '1' / 'yes' to enable."
  type        = string
  default     = "true"
}

variable "wiki_deterministic_linking_enabled" {
  description = "Feature flag for deterministic compile-time link emission (parent-expander-driven city/journal references + entity↔entity co-mention edges). When off, the compile pipeline never calls the deterministic linkers and `links_written_deterministic` / `links_written_co_mention` stay at 0 in metrics. Stored as a string because the Lambda reads it verbatim from env; must be 'true' / '1' / 'yes' to enable."
  type        = string
  default     = "true"
}

variable "google_places_api_key" {
  description = "Google Places API (New) key used by wiki-compile for POI → city/state/country hierarchy enrichment. Stored as a SecureString SSM parameter at /thinkwork/<stage>/google-places/api-key. Empty default creates the parameter with a placeholder value; operator populates via `aws ssm put-parameter --overwrite`. The parameter's value has lifecycle.ignore_changes set so CLI rotation sticks across terraform applies. Compile gracefully degrades when the key is absent (metadata-only place rows) — never fails compile."
  type        = string
  default     = ""
  sensitive   = true
}

# ---------------------------------------------------------------------------
# Per-user OAuth client credentials
# ---------------------------------------------------------------------------

variable "google_oauth_client_id" {
  description = "Google Workspace OAuth 2.0 client ID (for per-user Gmail/Calendar integration). Stored in Secrets Manager via aws_secretsmanager_secret_version; fetched by Lambdas at cold-start via oauth-client-credentials.ts."
  type        = string
  default     = ""
}

variable "google_oauth_client_secret" {
  description = "Google Workspace OAuth 2.0 client secret (for per-user Gmail/Calendar integration). Stored in Secrets Manager alongside the client_id; Lambdas fetch both values at cold-start."
  type        = string
  default     = ""
  sensitive   = true
}

variable "redirect_success_url" {
  description = "Default OAuth-callback redirect target used when the caller doesn't supply a returnUrl. Mobile callers pass a thinkwork:// custom scheme; web (admin) falls through to this default."
  type        = string
  default     = "https://app.thinkwork.ai/settings/credentials"
}

variable "platform_operator_emails" {
  description = "Comma-separated allowlist of emails permitted to invoke operator-gated GraphQL mutations (updateTenantPolicy, sandbox fixture setup, etc.). Compared against ctx.auth.email — pulled from the Cognito JWT for user callers and from the x-principal-email header for service-auth callers. Empty ⇒ the gate rejects every call."
  type        = string
  default     = ""
}
