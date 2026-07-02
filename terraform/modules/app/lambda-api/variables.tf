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
  default     = ""
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

variable "billing_export_bucket_name" {
  description = "Optional S3 bucket containing AWS Data Exports/CUR 2.0 manifests for bill reconciliation. Empty leaves the scheduled reconciler in no-op mode; targeted invokes can still pass a manifest bucket."
  type        = string
  default     = ""
}

variable "billing_export_manifest_key" {
  description = "Optional S3 key for the latest AWS billing export manifest to import on the scheduled bill reconciler run."
  type        = string
  default     = ""
}

variable "billing_reconciliation_tolerance_usd" {
  description = "Absolute USD tolerance used when comparing ThinkWork projected aggregate spend to AWS billing export spend."
  type        = number
  default     = 0.01
}

variable "plugin_catalog_github_token_secret_arn" {
  description = "Optional Secrets Manager ARN/name containing a GitHub token for plugin catalog release-asset fetches. Empty uses unauthenticated GitHub requests."
  type        = string
  default     = ""
}

variable "brain_artifacts_kms_key_arn" {
  description = "Optional KMS key ARN used to encrypt canonical Company Brain artifacts. AES256 encryption is used when unset."
  type        = string
  default     = ""
}

variable "enable_workspace_orchestration" {
  description = "Enable S3 EventBridge/SQS routing for workspace file orchestration."
  type        = bool
  default     = false
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

variable "cognito_auth_domain" {
  description = "Cognito hosted UI domain prefix, e.g. thinkwork-dev. Empty disables MCP OAuth login."
  type        = string
  default     = ""
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

variable "require_lambda_artifacts" {
  description = "Fail planning unless either lambda_zips_dir or lambda_artifact_bucket/lambda_artifact_prefix is configured. Enterprise deployment repos should set this to true."
  type        = bool
  default     = false
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

variable "bootstrap_credential_lease_kms_key_id" {
  description = "Optional KMS key ID or ARN used by Secrets Manager for temporary bootstrap credential leases. Empty uses the AWS-managed Secrets Manager key."
  type        = string
  default     = ""
}

variable "extension_proxy_backends_json" {
  description = "JSON map of enabled Admin extension ids to allowlisted backend base URLs. Example: {\"customer-module\":{\"baseUrl\":\"https://extension.example.com\"}}"
  type        = string
  default     = "{}"
}

variable "requester_idle_memory_learning_enabled" {
  description = "Enable requester-scoped 15-minute idle memory learning."
  type        = bool
  default     = false
}

variable "requester_memory_dreaming_enabled" {
  description = "Enable recurring requester memory dreaming sweeps."
  type        = bool
  default     = false
}

variable "requester_memory_dreaming_schedule_expression" {
  description = "EventBridge Scheduler expression for requester memory dreaming sweeps."
  type        = string
  default     = "cron(30 4 * * ? *)"
}

variable "requester_memory_dreaming_model_id" {
  description = "Bedrock Converse model id for requester memory REM reflection."
  type        = string
  default     = "openai.gpt-oss-120b-1:0"
}

variable "extension_proxy_signing_secret" {
  description = "Shared HMAC secret used by the generic Admin extension proxy to sign actor context for extension backends."
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
  description = "Active long-term memory engine for this deployment. Exactly one engine is canonical for recall/inspect/export. Hosted ThinkWork may choose 'cognee' when the Company Brain substrate is enabled."
  type        = string
  default     = "hindsight"
  validation {
    condition     = contains(["hindsight", "agentcore", "cognee"], var.memory_engine)
    error_message = "memory_engine must be 'hindsight', 'agentcore', or 'cognee'."
  }
}

variable "cognee_enabled" {
  description = "Whether the Cognee knowledge graph add-on is enabled for this deployment."
  type        = bool
  default     = false
}

variable "cognee_endpoint" {
  description = "Internal Cognee API endpoint (empty when disabled)."
  type        = string
  default     = ""
}

variable "cognee_log_group_name" {
  description = "CloudWatch log group for Cognee (empty when disabled)."
  type        = string
  default     = ""
}

variable "cognee_backend_mode" {
  description = "Selected Cognee backend mode (empty when disabled)."
  type        = string
  default     = ""
}

variable "cognee_cluster_arn" {
  description = "ECS cluster ARN for Cognee (empty when disabled)."
  type        = string
  default     = ""
}

variable "cognee_service_name" {
  description = "ECS service name for Cognee (empty when disabled)."
  type        = string
  default     = ""
}

variable "cognee_worker_subnet_ids" {
  description = "Subnet IDs for the Knowledge Graph ingest worker Lambda VPC attachment. Leave empty to deploy the worker without VPC access."
  type        = list(string)
  default     = []
}

variable "cognee_worker_security_group_ids" {
  description = "Security group IDs for the Knowledge Graph ingest worker Lambda VPC attachment. Leave empty to deploy the worker without VPC access."
  type        = list(string)
  default     = []
}

variable "okf_efs_subnet_ids" {
  description = "Subnet IDs for the OKF EFS hydrator Lambda VPC attachment. Leave empty to deploy the hydrator without an EFS mount."
  type        = list(string)
  default     = []
}

variable "okf_efs_security_group_ids" {
  description = "Security group IDs for the OKF EFS hydrator Lambda VPC attachment. Leave empty to deploy the hydrator without an EFS mount."
  type        = list(string)
  default     = []
}

variable "okf_efs_mount_target_ids" {
  description = "EFS mount target IDs that must exist before creating the OKF EFS hydrator Lambda."
  type        = list(string)
  default     = []
}

variable "okf_efs_file_system_arn" {
  description = "EFS file system ARN for the OKF wiki current view. Empty disables EFS IAM grants."
  type        = string
  default     = ""
}

variable "okf_efs_refresh_access_point_arn" {
  description = "EFS access point ARN mounted by the okf-efs-refresh Lambda. Empty disables the mount."
  type        = string
  default     = ""
}

variable "okf_efs_mount_path" {
  description = "Local Lambda mount path for the OKF wiki EFS view. Must be under /mnt."
  type        = string
  default     = "/mnt/thinkwork-okf"
}

variable "observation_classifier_model_id" {
  description = "Bedrock model id for the observations promotion-gate classifier. Empty uses the API default (pinned Haiku)."
  type        = string
  default     = ""
}

variable "twenty_provisioned" {
  description = "Whether the Twenty CRM retained managed-app substrate is provisioned."
  type        = bool
  default     = false
}

variable "twenty_runtime_enabled" {
  description = "Whether the Twenty CRM server/worker runtime is enabled."
  type        = bool
  default     = false
}

variable "twenty_url" {
  description = "Public Twenty CRM URL (empty when not provisioned)."
  type        = string
  default     = ""
}

variable "twenty_alb_arn" {
  description = "Public Twenty ALB ARN (empty when not provisioned)."
  type        = string
  default     = ""
}

variable "twenty_target_group_arn" {
  description = "Twenty server target group ARN (empty when not provisioned)."
  type        = string
  default     = ""
}

variable "twenty_cluster_arn" {
  description = "ECS cluster ARN for Twenty (empty when not provisioned)."
  type        = string
  default     = ""
}

variable "twenty_server_service_name" {
  description = "ECS service name for the Twenty server (empty when not provisioned)."
  type        = string
  default     = ""
}

variable "twenty_worker_service_name" {
  description = "ECS service name for the Twenty worker (empty when not provisioned)."
  type        = string
  default     = ""
}

variable "twenty_server_log_group_name" {
  description = "CloudWatch log group for the Twenty server (empty when not provisioned)."
  type        = string
  default     = ""
}

variable "twenty_worker_log_group_name" {
  description = "CloudWatch log group for the Twenty worker (empty when not provisioned)."
  type        = string
  default     = ""
}

variable "agentcore_pi_function_name" {
  description = "Pi AgentCore Lambda function name (for direct SDK invoke); empty until the Pi runtime is provisioned for the stage."
  type        = string
  default     = ""
}

variable "agentcore_pi_function_arn" {
  description = "Pi AgentCore Lambda function ARN (used to grant lambda:InvokeFunction)"
  type        = string
  default     = ""
}

variable "enable_agentcore_pi_invoke_policy" {
  description = "Create the API Lambda IAM policy that permits invoking the Pi AgentCore Lambda."
  type        = bool
  default     = false
}

variable "admin_url" {
  description = "Deprecated compatibility input for the unified web app URL (e.g. https://app.thinkwork.ai)."
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

variable "enable_stripe_billing" {
  description = "Provision Stripe billing Lambdas, API routes, and credentials placeholder secret."
  type        = bool
  default     = true
}

variable "stripe_welcome_from_email" {
  description = "Override From: address on the Stripe post-checkout welcome email. Must be an SES-verified identity. Empty string falls back to the in-code default (hello@agents.thinkwork.ai, which uses the already-verified SES inbound domain). Set to hello@thinkwork.ai once the bare-apex sender identity is verified."
  type        = string
  default     = ""
}

variable "enable_slack_workspace_app" {
  description = "Provision Slack workspace app Lambdas, API routes, and credentials placeholder secret."
  type        = bool
  default     = true
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

variable "ecr_repository_provisioned" {
  description = "Static flag: an ECR repository exists for image-based handlers AND their image tags are seeded (CI pushes skill-trust-runner-latest for repo-managed stages). count cannot depend on the repository URL attribute (unknown until apply in fresh accounts)."
  type        = bool
  default     = false
}

variable "manage_bedrock_invocation_logging" {
  description = "Own the account/region-scoped Bedrock model-invocation logging resources (log group, IAM role, account logging configuration). Only one stage per account+region may set this — the log group name is deliberately stage-neutral."
  type        = bool
  default     = true
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

variable "wiki_compile_model_id" {
  description = "Bedrock model id the wiki-compile Lambda uses for the leaf planner, aggregation planner, and section writer. Any Converse-compatible model works. Override per-env if you want to spike a different model without re-deploying code."
  type        = string
  default     = "openai.gpt-oss-120b-1:0"
}

variable "company_brain_source_agent_model_id" {
  description = "Bedrock model id the GraphQL context-engine Company Brain source-agent runtime uses for JSON tool/action turns. Kept separate from the high-throughput wiki compiler model so source agents can use a model tuned for reliable action JSON."
  type        = string
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "company_brain_backdoor_install_key_secret_arn" {
  description = "Optional Secrets Manager ARN containing the temporary Company Brain backdoor install key. Empty disables the backdoor. The raw key is never stored in tfvars or the runtime-config document."
  type        = string
  default     = ""
}

variable "company_brain_backdoor_install_key_stages" {
  description = "Comma-separated stage allowlist for the temporary Company Brain backdoor install key. Both this value and company_brain_backdoor_install_key_secret_arn must be set for deployed backdoor redemption."
  type        = string
  default     = ""
}

variable "kg_obs_max_candidates_per_run" {
  description = "Per-run candidate cap for the observations → Knowledge Graph ingest worker (KG_OBS_MAX_CANDIDATES_PER_RUN). Bounds the layered-gate classifier cost AND keeps each Cognee cognify small enough to index within budget on the single dogfood task; truncated runs self-invoke to drain the remaining backlog. Stored as a string because the Lambda reads it verbatim from env."
  type        = string
  default     = "10"
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

variable "wiki_source" {
  description = "Wiki pipeline source dispatch (plan 2026-06-09-004 U10). 'planner' (default) runs the original LLM compile path; 'graph' runs the deterministic graph→wiki materializer over the knowledge-graph mirror and makes successful observation-ingest runs the compile trigger. Variable-ized (not hardcoded) per the wiki-compile env precedent so unrelated deploys don't reset the flag; the Lambda reads it verbatim from env and treats any value other than 'graph' as 'planner'."
  type        = string
  default     = "planner"

  validation {
    condition     = contains(["planner", "graph"], var.wiki_source)
    error_message = "wiki_source must be 'planner' or 'graph'."
  }
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

# ---------------------------------------------------------------------------
# MCP custom domain (optional) — e.g., mcp.thinkwork.ai
# ---------------------------------------------------------------------------

variable "mcp_custom_domain" {
  description = "Custom domain for the MCP endpoint (e.g., 'mcp.thinkwork.ai'). Empty disables the custom-domain setup entirely. When set, an ACM cert is created; flip mcp_custom_domain_ready=true on the second apply to attach the domain + API mapping after DNS validation completes. See docs/solutions/patterns/mcp-custom-domain-setup-2026-04-23.md for the workflow."
  type        = string
  default     = ""
}

variable "mcp_custom_domain_ready" {
  description = "Two-apply gate for the MCP custom domain. Leave false on the first apply (cert-only). After running `pnpm cf:sync-mcp` + waiting for ACM validation, flip to true and re-apply to create the API Gateway domain + mapping."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Routines runtime (Phase B U6) — code-interpreter id for routine-task-python
# ---------------------------------------------------------------------------

variable "agentcore_code_interpreter_id" {
  description = "AgentCore Code Interpreter id used by routine-task-python (Phase B U6) for SFN `python` recipe states. Default empty — the Lambda fails closed with sandbox_misconfigured when unset, which is the correct behavior until Phase B U7 provisions a routines-dedicated interpreter. Operations sets this via tfvars once the interpreter is created."
  type        = string
  default     = ""
}

variable "routines_execution_role_arn" {
  description = "ARN of the Step Functions execution role newly-created routine state machines run under (Phase B U7). Wired from the routines-stepfunctions module's execution_role_arn output. createRoutine passes this as RoleArn on CreateStateMachine; the lambda-api role's RoutinePassExecutionRole grant is scoped to exactly this ARN."
  type        = string
  default     = ""
}

variable "routines_log_group_arn" {
  description = "ARN of the routines-stepfunctions CloudWatch log group (Phase B U7). Surfaced to the publish flow for future LoggingConfiguration on CreateStateMachine."
  type        = string
  default     = ""
}

variable "deployment_state_machine_arn" {
  description = "ARN of the GitHub-free deployment orchestration state machine. Passed to deployment-sessions and graphql-http so Settings can start release updates."
  type        = string
  default     = ""
}

variable "deployment_control_plane_enabled" {
  description = "Whether deployment control-plane routes and handlers should be provisioned. Kept separate from deployment_state_machine_arn because the ARN may be apply-time unknown."
  type        = bool
  default     = false
}

variable "deployment_evidence_bucket" {
  description = "S3 bucket name that stores deployment runner evidence. Passed to deployment-sessions and graphql-http so Settings can report release update evidence."
  type        = string
  default     = ""
}

variable "deployment_release_version" {
  description = "Selected ThinkWork release version used for managed application deployment jobs."
  type        = string
  default     = "unresolved"
}

variable "deployment_release_manifest_url" {
  description = "Selected ThinkWork release manifest URL used for managed application deployment jobs."
  type        = string
  default     = ""
}

variable "deployment_release_manifest_sha256" {
  description = "Selected ThinkWork release manifest SHA-256 used for managed application deployment jobs."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Phase 3 U4 — compliance-outbox-drainer Aurora credentials
# ---------------------------------------------------------------------------

variable "compliance_drainer_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the `compliance_drainer` Aurora role credentials (Phase 3 U2 / PR #887). Wired from `module.database.compliance_drainer_secret_arn`. The compliance-outbox-drainer Lambda resolves this at module load to connect with INSERT-only access on `compliance.audit_events`."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Phase 3 U7 — compliance audit-anchor bucket (S3 Object Lock)
# Default empty until U8a wires the anchor Lambda. The variables exist so
# U8a can reference them without forcing this PR to also wire a Lambda body.
# ---------------------------------------------------------------------------

variable "compliance_anchor_bucket_arn" {
  description = "ARN of the WORM-protected compliance audit-anchor S3 bucket. Default empty until U8a wires the anchor Lambda."
  type        = string
  default     = ""
}

variable "compliance_anchor_bucket_name" {
  description = "Name of the WORM-protected compliance audit-anchor S3 bucket. Default empty until U8a wires the anchor Lambda."
  type        = string
  default     = ""
}

variable "compliance_anchor_lambda_role_arn" {
  description = "ARN of the IAM role the anchor Lambda will assume. Default empty until U8a wires the anchor Lambda."
  type        = string
  default     = ""
}

variable "compliance_anchor_lambda_role_name" {
  description = "Name of the IAM role the anchor Lambda assumes (extracted from the role resource for inline-policy attachments like the U8a DLQ SendMessage grant)."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Phase 3 U8a — compliance anchor Lambda runtime config
# ---------------------------------------------------------------------------

variable "compliance_reader_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the `compliance_reader` Aurora role credentials. Wired from `module.database.compliance_reader_secret_arn`. The U8a anchor Lambda uses this for least-privilege SELECT on `compliance.audit_events`."
  type        = string
  default     = ""
}

variable "compliance_anchor_object_lock_retention_days" {
  description = "Default Object Lock retention for the compliance anchor bucket, in days. Forwarded to the anchor Lambda as COMPLIANCE_ANCHOR_RETENTION_DAYS (consumed by U8b's live function; pre-plumbed in U8a). Master plan baseline: 365."
  type        = number
  default     = 365
}

# ---------------------------------------------------------------------------
# Phase 3 U8b — anchor Lambda live config
# ---------------------------------------------------------------------------

variable "compliance_anchor_kms_key_arn" {
  description = "ARN of the customer-managed CMK used for SSE-KMS encryption of anchor objects. Forwarded to the anchor Lambda as COMPLIANCE_ANCHOR_KMS_KEY_ARN (required by `_anchor_fn_live` for the SSE-KMS PutObject)."
  type        = string
  default     = ""
}

variable "compliance_anchor_object_lock_mode" {
  description = "Object Lock retention mode applied per-object to anchor PutObjects. GOVERNANCE in dev/staging; COMPLIANCE in prod (irreversible). Forwarded to the anchor Lambda as COMPLIANCE_ANCHOR_OBJECT_LOCK_MODE."
  type        = string
  default     = "GOVERNANCE"
}

variable "compliance_anchor_watchdog_role_arn" {
  description = "ARN of the sibling IAM role the watchdog Lambda assumes (Phase 3 U8b). Decrypt-less: kms:DescribeKey only on the bucket CMK; s3:ListBucket prefix-scoped to anchors/."
  type        = string
  default     = ""
}

variable "compliance_anchor_watchdog_role_name" {
  description = "Name of the sibling watchdog IAM role. Used for any future inline-policy attachments (e.g., DLQ SendMessage) without re-deriving the name from the ARN."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Phase 3 U11.U2 — compliance export runner Lambda
# ---------------------------------------------------------------------------

variable "compliance_exports_bucket_name" {
  description = "Name of the compliance-exports S3 bucket. Forwarded to the runner Lambda as COMPLIANCE_EXPORTS_BUCKET so the U11.U3 live body knows where to write CSV/NDJSON artifacts. Default empty — the runner function still deploys but the live body throws on boot."
  type        = string
  default     = ""
}

variable "compliance_exports_runner_role_arn" {
  description = "ARN of the IAM role the U11 export runner Lambda assumes. Wired from `module.compliance_exports.runner_role_arn`. Default empty until U11.U2 ships."
  type        = string
  default     = ""
}

variable "compliance_exports_runner_role_name" {
  description = "Name of the IAM role the U11 export runner Lambda assumes (extracted from the role resource for inline-policy attachments — DLQ SendMessage, SQS receive)."
  type        = string
  default     = ""
}

variable "knowledge_graph_tool_enabled" {
  description = "Stage gate for the Pi knowledge_graph_search tool (plan 2026-06-09-004 U8). Per-agent tool policy gates on top."
  type        = bool
  default     = true
}

variable "parameters_secrets_extension_layer_arn" {
  description = "Override for the AWS Parameters and Secrets Lambda Extension layer ARN. Empty uses the per-region map in runtime-config.tf; regions absent from the map run without the layer (the runtime-config loader falls back to SDK reads)."
  type        = string
  default     = ""
}
