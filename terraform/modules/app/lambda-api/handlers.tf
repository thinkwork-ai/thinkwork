################################################################################
# Real Lambda Handlers
#
# Each handler is bundled by scripts/build-lambdas.sh into dist/lambdas/<name>.zip.
# Terraform references them via var.lambda_zips_dir (local path) for source
# checkout deploys, or via S3 (lambda_artifact_bucket) for release deploys.
################################################################################

locals {
  use_local_zips        = var.lambda_zips_dir != ""
  eval_fanout_queue_url = local.deploy_lambda_handlers ? aws_sqs_queue.eval_fanout[0].url : ""
  runtime               = "nodejs20.x"
  cognee_env = var.cognee_enabled ? {
    # graphql-http is close to Lambda's 4 KB environment ceiling. Keep Cognee
    # status in one compact value; stable names are derived in the resolver.
    COGNEE = "${var.cognee_backend_mode}|${var.cognee_endpoint}"
  } : {}
  # Twenty managed-app status is DB-served (managed_applications +
  # deployment jobs — plan 2026-06-12-001 U10); the TWENTY config key is
  # retired. Cognee's env-var status projection above is unchanged.
  optional_integration_handler_names = concat(
    var.deployment_control_plane_enabled ? [] : [
      # Host-only onboarding/deployment API. Customer foundations disable the
      # deployment control plane, so release-based customer installs must not
      # require this Lambda artifact or expose these routes.
      "deployment-sessions",
    ],
    var.enable_stripe_billing ? [] : [
      "stripe-checkout",
      "stripe-webhook",
      "stripe-portal",
      "stripe-subscription",
    ],
    var.enable_slack_workspace_app ? [] : [
      "oauth-authorize",
      "oauth-callback",
      "slack-events",
      "slack-slash-command",
      "slack-interactivity",
      "slack-oauth-install",
    ],
  )

  # Config-class configuration shared by all API handlers. As of plan
  # 2026-06-11-006 U6 these keys live ONLY in the SSM runtime-config
  # document (runtime-config.tf) — they are NOT injected as Lambda env.
  # Code reads them through @thinkwork/runtime-config's getConfig(), whose
  # env-wins merge still honors a hand-set env var as an incident override.
  # The reader-coverage fixture test in apps/cli fails CI if a key in this
  # map still has a direct process.env reader. Identity values (STAGE,
  # AWS_ACCOUNT_ID, NODE_OPTIONS) and secrets (DATABASE_URL,
  # API_AUTH_SECRET, APPSYNC_API_KEY) stay out of this map — identity stays
  # env forever, secrets live in Secrets Manager (R4), never in the String
  # document.
  config_env = merge({
    DATABASE_SECRET_ARN = var.graphql_db_secret_arn
    DATABASE_HOST       = var.db_cluster_endpoint
    DATABASE_NAME       = var.database_name
    # BUCKET_NAME and USER_POOL_ID were duplicate aliases of WORKSPACE_BUCKET
    # and COGNITO_USER_POOL_ID; GRAPHQL_API_KEY duplicated APPSYNC_API_KEY;
    # THINKWORK_API_SECRET and EMAIL_HMAC_SECRET duplicated API_AUTH_SECRET
    # (~310 serialized bytes total). graphql-http sits at Lambda's hard 4KB
    # env ceiling (#2375) — every reader falls back to the canonical name.
    # Same precedent as the APP_URL/WEB_URL dedupe below.
    COGNITO_USER_POOL_ID        = var.user_pool_id
    ADMIN_CLIENT_ID             = var.admin_client_id
    MOBILE_CLIENT_ID            = var.mobile_client_id
    COGNITO_MCP_CLIENT_ID       = aws_cognito_user_pool_client.mcp_oauth.id
    COGNITO_AUTH_BASE_URL       = local.mcp_oauth_cognito_base_url
    MCP_OAUTH_CALLBACK_URL      = "${local.mcp_oauth_api_base_url}/mcp/oauth/callback"
    MCP_OAUTH_REVOCATIONS_TABLE = aws_dynamodb_table.mcp_oauth_revocations.name
    COGNITO_APP_CLIENT_IDS      = "${var.admin_client_id},${var.mobile_client_id}"
    APPSYNC_ENDPOINT            = var.appsync_api_url
    THINKWORK_API_URL           = local.api_base_url
    # Comma-separated allowlist of caller emails permitted to invoke
    # operator-gated mutations (updateTenantPolicy, sandbox fixture
    # setup, etc.). Resolved against ctx.auth.email, which is pulled
    # from the Cognito JWT for user callers and from the
    # `x-principal-email` header for service-auth callers (see
    # packages/api/src/lib/cognito-auth.ts). Empty ⇒ the gate
    # rejects every call, which is the safe default pre-rollout.
    THINKWORK_PLATFORM_OPERATOR_EMAILS = var.platform_operator_emails
    AGENTCORE_PI_FUNCTION_NAME         = var.agentcore_pi_function_name
    # WORKSPACE_RENDERER_FUNCTION_NAME is derived from the per-stage naming
    # convention by deriveFunctionName("workspace-renderer") — stored
    # nowhere (R7).
    WORKSPACE_BUCKET    = var.bucket_name
    HINDSIGHT_ENDPOINT  = var.hindsight_endpoint
    AGENTCORE_MEMORY_ID = var.agentcore_memory_id
    MEMORY_ENGINE       = var.memory_engine
    # CHAT_AGENT_INVOKE_FN_ARN (~112 serialized bytes) was dropped for the
    # 4KB env ceiling (#2375): getChatAgentInvokeFnArn and managed-dispatch
    # now derive the ARN from the deterministic naming pattern
    # (AWS_REGION + AWS_ACCOUNT_ID + STAGE) before the SSM fallback, so the
    # silent-SSM-failure path that originally motivated the env var stays
    # closed without spending env bytes.
    # APP_URL/WEB_URL were duplicate aliases of ADMIN_URL (all = var.admin_url)
    # and pushed this Lambda's env block past AWS's hard 4KB limit, failing
    # every Terraform apply (UpdateFunctionConfiguration 400 InvalidParameter:
    # environment variables exceeded the 4KB limit). Every reader resolves via
    # ADMIN_URL — stripe-webhook/stripe-portal use `APP_URL || WEB_URL ||
    # ADMIN_URL`, mcp-oauth-client's candidate list includes ADMIN_URL, and
    # deploymentStatus reads ADMIN_URL directly — so the single canonical
    # ADMIN_URL is sufficient. Re-add aliases only after env vars move to SSM.
    ADMIN_URL            = var.admin_url
    DOCS_URL             = var.docs_url
    APPSYNC_REALTIME_URL = var.appsync_realtime_url
    ECR_REPOSITORY_URL   = var.ecr_repository_url
    # Per-user OAuth wiring (Google Workspace today; Microsoft 365 follow-up).
    # Secret ARNs are the indirection; the actual client_id/client_secret
    # values live in Secrets Manager and are fetched by
    # packages/api/src/lib/oauth-client-credentials.ts at cold-start.
    # OAUTH_CALLBACK_URL is the URL registered with Google/Azure OAuth apps.
    # REDIRECT_SUCCESS_URL is the fallback post-OAuth redirect when the
    # caller doesn't pass a per-request returnUrl (mobile passes thinkwork://).
    GOOGLE_PRODUCTIVITY_OAUTH_SECRET_ARN          = aws_secretsmanager_secret.oauth_google_productivity.arn
    OAUTH_CALLBACK_URL                            = "https://${aws_apigatewayv2_api.main.id}.execute-api.${var.region}.amazonaws.com/api/oauth/callback"
    REDIRECT_SUCCESS_URL                          = var.redirect_success_url
    COMPANY_BRAIN_SOURCE_AGENT_MODEL_ID           = var.company_brain_source_agent_model_id
    COMPANY_BRAIN_BACKDOOR_INSTALL_KEY_SECRET_ARN = var.company_brain_backdoor_install_key_secret_arn
    COMPANY_BRAIN_BACKDOOR_INSTALL_KEY_STAGES     = var.company_brain_backdoor_install_key_stages
    WWW_URL                                       = var.www_url
    },
    # Stripe billing — see stripe-secrets.tf. The ARN is the indirection;
    # the actual keys live in Secrets Manager and are fetched by
    # packages/api/src/lib/stripe-credentials.ts at cold-start. Price IDs
    # are non-secret per-stage config carried as a plain JSON env var so
    # staging/prod can use different products without a secret rotation.
    # The whole block is omitted when Stripe is disabled (~315 serialized
    # bytes): the stripe-* handlers are excluded from deployment in that
    # case and stripe-plans.ts defaults to "{}" — see #2375 (4KB env cap).
    var.enable_stripe_billing ? {
      STRIPE_CREDENTIALS_SECRET_ARN = aws_secretsmanager_secret.stripe_api_credentials[0].arn
      STRIPE_PRICE_IDS_JSON         = var.stripe_price_ids_json
      STRIPE_CHECKOUT_SUCCESS_URL   = "${var.admin_url}/onboarding/welcome?session_id={CHECKOUT_SESSION_ID}"
      STRIPE_CHECKOUT_CANCEL_URL    = "${var.www_url}/cloud"
      # Override the welcome email's From: address. Defaults to
      # hello@agents.thinkwork.ai (the already-verified SES inbound domain);
      # set to hello@thinkwork.ai once the bare-apex identity is verified in SES.
      STRIPE_WELCOME_FROM_EMAIL = var.stripe_welcome_from_email
    } : {},
    local.cognee_env,
  )

  # graphql-http-only config that also belongs in the runtime-config
  # document. Kept out of config_env so the legacy env copies stay scoped
  # to graphql-http (handler_extra_env below) instead of growing every
  # handler's env during the R8 transition window.
  graphql_http_config_env = {
    ROUTINES_EXECUTION_ROLE_ARN = var.routines_execution_role_arn
    ROUTINES_LOG_GROUP_ARN      = var.routines_log_group_arn
    # Settings > General starts release updates from the GraphQL API.
    DEPLOYMENT_STATE_MACHINE_ARN = var.deployment_state_machine_arn
    DEPLOYMENT_EVIDENCE_BUCKET   = var.deployment_evidence_bucket
    # Cognee user + Space memory captures use explicit add+cognify so accepted
    # documents enter the scoped graph. GraphQL has a 30s Lambda ceiling, so
    # indexing wait is intentionally short/best-effort; callers poll search for
    # eventual retrieval instead of pinning the capture request.
    COGNEE_INGEST_MODE      = "add_cognify"
    COGNEE_INDEX_TIMEOUT_MS = "8000"
    COGNEE_INDEX_POLL_MS    = "2000"
    # THNK-37 — the GraphQL API is the runtime trust boundary for the
    # GitHub-hosted signed plugin catalog. Browsers keep reading through
    # GraphQL; API verifies the release asset with the trusted public key
    # and persists only verified snapshots in the primary workspace bucket.
    THINKWORK_PLUGIN_CATALOG_SOURCE                  = "github"
    THINKWORK_PLUGIN_CATALOG_REPOSITORY              = "thinkwork-ai/thinkwork"
    THINKWORK_PLUGIN_CATALOG_RELEASE_TAG             = "plugin-catalog-main"
    THINKWORK_PLUGIN_CATALOG_ASSET_NAME              = "thinkwork-plugin-catalog-main.json"
    THINKWORK_PLUGIN_CATALOG_CACHE_TTL_SECONDS       = "300"
    THINKWORK_PLUGIN_CATALOG_USER_AGENT              = "thinkwork-api/${var.stage}"
    THINKWORK_PLUGIN_CATALOG_CACHE_BUCKET            = var.bucket_name
    THINKWORK_PLUGIN_CATALOG_CACHE_KEY               = "system/plugin-catalog/github-release-cache.json"
    THINKWORK_PLUGIN_CATALOG_GITHUB_TOKEN_SECRET_ARN = var.plugin_catalog_github_token_secret_arn
    # Phase 3 U10 — compliance read resolvers (complianceEvents,
    # complianceEvent, complianceEventByHash) connect to Aurora as
    # the compliance_reader role. The existing secrets-manager grant in
    # aws_iam_policy.api_data_plane (iam-grouped.tf) grants
    # secretsmanager:GetSecretValue on the thinkwork/* wildcard, so no
    # new IAM resource is needed.
    COMPLIANCE_READER_SECRET_ARN = var.compliance_reader_secret_arn
  }

  # Identity env + the secrets still in their one-release transition
  # window (R8). Config-class keys live ONLY in the SSM runtime-config
  # document now — adding a key here is guarded by the identity-allowlist
  # fixture test in apps/cli (R10). Follow-up release: DATABASE_URL,
  # APPSYNC_API_KEY, and API_AUTH_SECRET drop too (readers already resolve
  # via Secrets Manager prefetch when the env copies are absent), bringing
  # every handler under the ≤1KB R1 target.
  common_env = {
    STAGE           = var.stage
    DATABASE_URL    = "postgresql://${var.db_username}:${urlencode(var.db_password)}@${var.db_cluster_endpoint}:5432/${var.database_name}?sslmode=no-verify"
    APPSYNC_API_KEY = var.appsync_api_key
    API_AUTH_SECRET = var.api_auth_secret
    AWS_ACCOUNT_ID  = var.account_id
    NODE_OPTIONS    = "--enable-source-maps"
  }

  # Per-handler env-var overrides. ARNs are constructed from the naming
  # pattern (same trick as the api-cross-function-invoke statement in
  # iam-grouped.tf) so we don't introduce a self-referential dependency
  # inside the handler for_each.
  slack_handler_env = {
    SLACK_APP_CREDENTIALS_SECRET_ARN = var.enable_slack_workspace_app ? aws_secretsmanager_secret.slack_app_credentials[0].arn : ""
  }

  handler_extra_env = {
    "extension-proxy" = {
      EXTENSION_PROXY_BACKENDS_JSON  = var.extension_proxy_backends_json
      EXTENSION_PROXY_SIGNING_SECRET = var.extension_proxy_signing_secret
    }
    "trace-invocation-reconciler" = {
      BEDROCK_INVOCATION_LOG_GROUP = local.bedrock_invocation_log_group_name
    }
    "job-schedule-manager" = {
      JOB_TRIGGER_ARN      = "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-job-trigger"
      JOB_TRIGGER_ROLE_ARN = var.job_scheduler_role_arn
    }
    "deployment-sessions" = {
      THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN  = var.deployment_state_machine_arn
      THINKWORK_DEPLOYMENT_EVIDENCE_BUCKET    = var.deployment_evidence_bucket
      THINKWORK_RELEASE_VERSION               = var.deployment_release_version
      THINKWORK_RELEASE_MANIFEST_URL          = var.deployment_release_manifest_url
      THINKWORK_RELEASE_MANIFEST_SHA256       = var.deployment_release_manifest_sha256
      THINKWORK_BOOTSTRAP_LEASE_SECRET_PREFIX = "thinkwork/${var.stage}/deployment-bootstrap-leases"
      THINKWORK_BOOTSTRAP_LEASE_KMS_KEY_ID    = var.bootstrap_credential_lease_kms_key_id
    }
    "graphql-http" = {
      THINKWORK_RELEASE_VERSION         = var.deployment_release_version
      THINKWORK_RELEASE_MANIFEST_URL    = var.deployment_release_manifest_url
      THINKWORK_RELEASE_MANIFEST_SHA256 = var.deployment_release_manifest_sha256
    }
    # Compounding Memory compile Lambda. Any Converse-compatible Bedrock
    # model works; the planner + section-writer cap themselves at ~500
    # records / 25 new pages per invocation so a 480 s timeout covers
    # the worst case comfortably. Env vars come from variables so
    # unrelated deploys don't wipe them back to defaults (the aggregation
    # flag got reset on every terraform apply before this was pinned).
    "wiki-compile" = {
      BEDROCK_MODEL_ID                   = var.wiki_compile_model_id
      WIKI_AGGREGATION_PASS_ENABLED      = var.wiki_aggregation_pass_enabled
      WIKI_DETERMINISTIC_LINKING_ENABLED = var.wiki_deterministic_linking_enabled
      # Wiki pipeline source dispatch (plan 2026-06-09-004 U10):
      # 'planner' (default, LLM compile) | 'graph' (deterministic
      # graph→wiki materializer over the knowledge-graph mirror).
      WIKI_SOURCE = var.wiki_source
      # Name (not value) of the SecureString SSM parameter that holds the
      # Google Places API key. wiki-compile fetches + caches on cold start.
      # The parameter may contain a placeholder value at apply time — the
      # Lambda logs and degrades gracefully if decryption returns empty.
      GOOGLE_PLACES_SSM_PARAM_NAME = "/thinkwork/${var.stage}/google-places/api-key"
    }
    "ontology-scan" = {
      BEDROCK_MODEL_ID = var.wiki_compile_model_id
    }
    "wiki-export" = {
      WIKI_EXPORT_BUCKET     = aws_s3_bucket.wiki_exports.bucket
      BRAIN_ARTIFACTS_BUCKET = aws_s3_bucket.brain_artifacts.bucket
    }
    "okf-materialize" = {
      BRAIN_ARTIFACTS_BUCKET = aws_s3_bucket.brain_artifacts.bucket
    }
    "okf-efs-refresh" = {
      BRAIN_ARTIFACTS_BUCKET = aws_s3_bucket.brain_artifacts.bucket
      OKF_EFS_ROOT           = var.okf_efs_mount_path
    }
    "oauth-authorize"     = local.slack_handler_env
    "oauth-callback"      = local.slack_handler_env
    "slack-events"        = local.slack_handler_env
    "slack-slash-command" = local.slack_handler_env
    "slack-interactivity" = local.slack_handler_env
    "slack-oauth-install" = local.slack_handler_env
    "thread-attachments-finalize" = {
      REQUESTER_IDLE_MEMORY_LEARNING_ENABLED = tostring(var.requester_idle_memory_learning_enabled)
    }
    "requester-memory-dreaming" = {
      REQUESTER_MEMORY_DREAMING_ENABLED  = tostring(var.requester_memory_dreaming_enabled)
      REQUESTER_MEMORY_DREAMING_MODEL_ID = var.requester_memory_dreaming_model_id
    }
    "mcp-context-engine" = {
      CONTEXT_ENGINE_MEMORY_QUERY_MODE = "reflect"
      CONTEXT_ENGINE_MEMORY_TIMEOUT_MS = "20000"
    }
    # Agent graph access (plan 2026-06-09-004 U8): stage gate for the Pi
    # knowledge_graph_search tool; the per-agent tool policy gates on top.
    "chat-agent-invoke" = {
      KNOWLEDGE_GRAPH_TOOL_ENABLED = tostring(var.knowledge_graph_tool_enabled)
    }
    "memory-retain" = {
      HINDSIGHT_TIMEOUT_MS = "75000"
    }
    # Bedrock KB provisioning. Per-handler (not common_env) so these don't bloat
    # the already-near-4KB graphql-http env. Bedrock's RDS-backed KB needs the
    # cluster ARN + the KB service role (passed at CreateKnowledgeBase time).
    "knowledge-base-manager" = {
      KB_SERVICE_ROLE_ARN  = var.kb_service_role_arn
      DATABASE_CLUSTER_ARN = var.db_cluster_arn
    }
    "knowledge-graph-thread-ingest" = {
      COGNEE_ENDPOINT        = var.cognee_endpoint
      COGNEE_BACKEND_MODE    = var.cognee_backend_mode
      COGNEE_INGEST_MODE     = "remember"
      BRAIN_ARTIFACTS_BUCKET = aws_s3_bucket.brain_artifacts.bucket
    }
    # Observations → Knowledge Graph worker (plan 2026-06-09-004 U5).
    # add_cognify pins the incremental ingest path into the stable
    # per-tenant dataset; the promotion-gate classifier reads
    # OBSERVATION_CLASSIFIER_MODEL_ID (Bedrock IAM via the shared
    # lambda_bedrock invoke policy).
    "knowledge-graph-observations-ingest" = {
      COGNEE_ENDPOINT                 = var.cognee_endpoint
      COGNEE_BACKEND_MODE             = var.cognee_backend_mode
      COGNEE_INGEST_MODE              = "add_cognify"
      BRAIN_ARTIFACTS_BUCKET          = aws_s3_bucket.brain_artifacts.bucket
      OBSERVATION_CLASSIFIER_MODEL_ID = var.observation_classifier_model_id
      # Per-run candidate cap: bounds classifier cost AND keeps each Cognee
      # cognify small enough to index within budget on the single dogfood
      # task; truncated runs self-invoke (Event) to drain the backlog across
      # successive runs. COGNEE_INDEX_TIMEOUT_MS raised well above the default
      # 240s (dogfood indexing of a fresh dataset is slow) but under the 900s
      # Lambda ceiling, leaving room for graph fetch + normalize + snapshot.
      KG_OBS_MAX_CANDIDATES_PER_RUN = var.kg_obs_max_candidates_per_run
      COGNEE_INDEX_TIMEOUT_MS       = "700000"
      COGNEE_INDEX_POLL_MS          = "7000"
    }
    # routine-task-python (Phase B U6) needs the AgentCore code-interpreter
    # id + the per-stage S3 routine-output bucket. The interpreter id is
    # provisioned by the agentcore-code-interpreter module and exposed via
    # the agentcore_code_interpreter_id input variable; the bucket name
    # follows the per-stage naming convention from the routines-stepfunctions
    # module (Phase A U1).
    "routine-task-python" = {
      SANDBOX_INTERPRETER_ID       = var.agentcore_code_interpreter_id
      ROUTINE_OUTPUT_BUCKET        = "thinkwork-${var.stage}-routine-output"
      ROUTINE_PYTHON_ENV_ALLOWLIST = "TENANT_ID,ROUTINE_ID,EXECUTION_ID"
    }
    # graphql-http hosts the createRoutine / publishRoutineVersion / etc.
    # resolvers (Phase B U7) AND the routine-approval-bridge (Phase B
    # U8) which invokes routine-resume via the AWS SDK.
    # graphql-http's former env extras now ride the SSM runtime-config
    # document (local.graphql_http_config_env feeds the document body in
    # runtime-config.tf). The thinkwork-<stage>-api-* function names the
    # routines bridge/dispatch paths use are derived from STAGE at call
    # time (runtimeFunctionName/deriveFunctionName — R7), and the
    # compliance-export queue URL is derived from STAGE + AWS_REGION +
    # AWS_ACCOUNT_ID, so none of them are stored anywhere.
    # U2 eval fan-out substrate. eval-runner does not dispatch to this
    # queue until U3; eval-worker is a throwing inert stub that redrives
    # accidental traffic to the DLQ.
    "eval-runner" = {
      EVAL_FANOUT_QUEUE_URL                = local.eval_fanout_queue_url
      EVAL_DIRECT_AGENTCORE_MESSAGE_SHARDS = "20"
      # SSM parameter name for the Pi Bedrock AgentCore Runtime ID. deploy.yml's
      # runtime update job writes this in `update-agentcore-runtime-image.sh`;
      # eval-runner reads it via `loadRuntimeId(runtimeType)`.
      AGENTCORE_RUNTIME_SSM_PI = "/thinkwork/${var.stage}/agentcore/runtime-id-pi"
    }
    "eval-worker" = {
      EVAL_FANOUT_QUEUE_URL     = local.eval_fanout_queue_url
      EVAL_AGENTCORE_EVALUATORS = "disabled"
      # Mirrors the fan-out queue's redrive maxReceiveCount (same local in
      # eval-fanout.tf — no drift possible) so the worker can detect the
      # final SQS receive and record error/throttle instead of letting the
      # case vanish into the DLQ without a result row.
      EVAL_FANOUT_MAX_RECEIVE_COUNT = tostring(local.eval_fanout_max_receive_count)
      # Enables the real Bedrock Converse llm-rubric judge (U12). Without
      # this the worker passes no judge and non-refusal quality rubrics
      # fall back to a heuristic that can never honestly score them — the
      # vacuous-pass trust bug. EVAL_JUDGE_MODEL_ID matches the default in
      # in-house.ts; the api-ai IAM policy already grants
      # bedrock:InvokeModel(+WithResponseStream) on inference-profile/*,
      # which authorizes Converse with this profile ID.
      EVAL_LLM_JUDGE      = "1"
      EVAL_JUDGE_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    }
    # THNK-74 U4 — optional AWS billing export importer. Missing bucket/key is
    # a healthy no-op so stages can ship the reconciler before CUR/Data Export
    # delivery is configured out-of-band in the AWS billing account.
    "cost-bill-reconciler" = {
      BILLING_EXPORT_BUCKET                = var.billing_export_bucket_name
      BILLING_EXPORT_MANIFEST_KEY          = var.billing_export_manifest_key
      BILLING_RECONCILIATION_TOLERANCE_USD = tostring(var.billing_reconciliation_tolerance_usd)
    }
    # job-trigger's thinkwork-<stage>-api-* worker function names are
    # derived from STAGE at call time (runtimeFunctionName — R7), and
    # AWS_ACCOUNT_ID already rides common_env, so it needs no extras.
    # Phase 3 U4 Compliance outbox drainer.
    # Connects to Aurora as the compliance_drainer role (provisioned in
    # U2). The DATABASE_SECRET_ARN-style indirection is via
    # COMPLIANCE_DRAINER_SECRET_ARN so the drainer's connection cache is
    # isolated from the master `getDb()` cache used by other handlers.
    "compliance-outbox-drainer" = {
      COMPLIANCE_DRAINER_SECRET_ARN = var.compliance_drainer_secret_arn
    }
  }
}

resource "aws_lambda_function" "skill_trust_runner" {
  # Gated on the static ecr_repository_provisioned flag: the repository URL is
  # an apply-time-unknown attribute in a fresh account, and count cannot
  # depend on it ("Invalid count argument" — THINK-118 harness cycle 4).
  count = local.deploy_lambda_handlers && var.ecr_repository_provisioned ? 1 : 0

  function_name = "thinkwork-${var.stage}-skill-trust-runner"
  role          = aws_iam_role.lambda.arn
  package_type  = "Image"
  image_uri     = "${var.ecr_repository_url}:skill-trust-runner-latest"
  timeout       = 60
  memory_size   = 1024
  architectures = ["x86_64"]

  environment {
    variables = {
      SKILLSPECTOR_LOG_LEVEL       = "WARNING"
      SKILLSPECTOR_TIMEOUT_SECONDS = "45"
    }
  }

  tags = {
    Name    = "thinkwork-${var.stage}-skill-trust-runner"
    Handler = "skill-trust-runner"
  }
}

# ---------------------------------------------------------------------------
# Helper: creates Lambda functions from a local zip directory or release S3 keys
# ---------------------------------------------------------------------------

resource "aws_lambda_function" "handler" {
  for_each = local.deploy_lambda_handlers ? setsubtract(toset([
    "graphql-http",
    "chat-agent-invoke",
    # Mobile agent harness: cloud Bedrock Converse proxy + completed-turn
    # persistence. Routes for these live in local.api_routes; the function
    # names must also be listed here (this set is the for_each source for
    # aws_lambda_function.handler, NOT derived from api_routes).
    "model-converse",
    "record-turn",
    "mobile-turn-session",
    # Mobile local Pi built-in tools. These are ThinkWork platform tools, not
    # MCP connector tools.
    "mobile-tools",
    # Agent-visible task status mutation tool. Service and first-party callers
    # land here so linked_tasks remains database-authoritative.
    "task-status-tool",
    # Mobile agent harness MCP proxy. tools/list + tools/call routes live in
    # local.api_routes; the function name must also be listed here (this set
    # is the for_each source for aws_lambda_function.handler).
    "mcp-proxy",
    # Client Engagement app API. Calls Twenty REST API directly server-side;
    # it is not backed by ThinkWork GraphQL or the agent MCP runtime.
    "twenty-client-engagement",
    # Desktop-local Pi tombstone endpoints. Kept temporarily so old packaged
    # desktop clients receive a stable 410 while all supported Pi execution
    # routes through managed AgentCore.
    "desktop-runtime-session",
    "desktop-workspace-prewarm",
    "managed-delegation",
    "desktop-eval-runs",
    # chat-agent-finalize — POST /api/threads/{threadId}/finalize. The
    # AgentCore runtime POSTs here at end-of-turn so the post-AgentCore
    # bookkeeping (cost recording, message insert, AppSync notify,
    # computer-task completion, memory retain dispatch) can run without
    # chat-agent-invoke holding a Lambda open for the full turn duration.
    # Bearer API_AUTH_SECRET. Idempotent on thread_turns.finalized_at
    # (migration 0123). Plan: 2026-05-22-006.
    "chat-agent-finalize",
    # chat-agent-activity — POST /api/threads/{threadId}/activity. The Pi
    # runtime POSTs here mid-turn so live agent activity (tool/skill/phase
    # steps, coalesced text deltas) streams to the Spaces thread via
    # thread_turn_events + the onThreadTurnStep AppSync subscription.
    # Bearer API_AUTH_SECRET, best-effort (never fails the turn).
    # Plan: 2026-06-03-001.
    "chat-agent-activity",
    "wakeup-processor",
    "workspace-event-dispatcher",
    "workspace-renderer",
    "agents",
    "agent-actions",
    "messages",
    "connections",
    "oauth-authorize",
    "oauth-callback",
    "stripe-checkout",
    "stripe-webhook",
    "stripe-portal",
    "stripe-subscription",
    "deployment-sessions",
    "auth-me",
    "public-auth-options",
    "workos-auth",
    "extension-proxy",
    "tenants",
    "users",
    "invites",
    "skills",
    "mcp-oauth",
    "mcp-user-memory",
    "mcp-context-engine",
    "mcp-open-engine",
    "activity",
    "routines",
    "budgets",
    "guardrails",
    "scheduled-jobs",
    "thread-idle-memory-learning",
    "requester-memory-dreaming",
    "job-schedule-manager",
    "job-trigger",
    "routine-task-weather-email",
    "webhooks",
    "n8n-agent-step-bridge",
    "n8n-agent-step-expirer",
    "webhooks-admin",
    "webhook-deliveries-cleanup",
    "skill-runs-reconciler",
    "cron-stall-monitor",
    "webhook-crm-opportunity",
    "webhook-task-event",
    "workspace-files",
    # Workspace source fetch authorization (dynamic workspace plan
    # 2026-06-12-002 U4). Bearer API_AUTH_SECRET + x-tenant-id; the runtime
    # fetch tool authorizes here, then downloads the returned S3 keys itself.
    "workspace-fetch-source",
    "knowledge-base-manager",
    "knowledge-base-files",
    "email-send",
    "email-inbound",
    "email-provider-webhook",
    "email-readiness-probe",
    "slack-events",
    "slack-slash-command",
    "slack-interactivity",
    "slack-oauth-install",
    "github-app",
    "memory",
    "memory-retain",
    "wiki-compile",
    "knowledge-graph-thread-ingest",
    "knowledge-graph-observations-ingest",
    "ontology-scan",
    "ontology-reprocess",
    "wiki-lint",
    "wiki-export",
    "okf-materialize",
    "okf-efs-refresh",
    "wiki-bootstrap-import",
    "artifact-deliver",
    "recipe-refresh",
    "agent-skills-list",
    "bootstrap-workspaces",
    "eval-runner",
    "eval-worker",
    "eval-runs-reconciler",
    # THNK-74 U4 — imports AWS Data Exports/CUR bill evidence and reconciles
    # aggregate spend against ThinkWork accounting rows.
    "cost-bill-reconciler",
    # THNK-74 U3 — reconciles runtime-reported model usage against Bedrock
    # model invocation logs and appends invocation-scope trace ledger facts.
    "trace-invocation-reconciler",
    # AgentCore Code Sandbox narrow REST endpoints (plan Unit 10 + Unit 11).
    # Both are service-endpoint shape: the runtime POSTs with
    # Bearer API_AUTH_SECRET. No GraphQL resolver involvement, no extra IAM.
    "sandbox-quota-check",
    "sandbox-invocation-log",
    # Routines Step Functions ASL validator (plan
    # docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md §U5).
    # Bearer API_AUTH_SECRET; chat builder + publish flow call this before
    # accepting LLM-emitted ASL. Needs states:ValidateStateMachineDefinition
    # IAM grant — see main.tf.
    "routine-asl-validator",
    # Routines Step Functions Task wrappers (plan
    # docs/plans/2026-05-01-005-feat-routines-phase-b-runtime-plan.md §U6).
    # routine-task-python: SFN-invoked Lambda that runs `python` recipe
    # states in the AgentCore code interpreter, offloading stdout/stderr
    # to the per-stage routine-output bucket. Needs bedrock-agentcore
    # (Start/Invoke/Stop CodeInterpreterSession) + S3 PutObject IAM —
    # see main.tf.
    "routine-task-python",
    # routine-resume: SDK-invoked by routine-approval-bridge (Phase B
    # U8) after a HITL decision. Calls SendTaskSuccess/SendTaskFailure;
    # idempotent on already-consumed tokens. Needs states:SendTaskSuccess
    # + states:SendTaskFailure IAM (already granted in U1's substrate).
    "routine-resume",
    # routine-approval-callback: SFN's inbox_approval Task invokes this
    # via .waitForTaskToken (plan 2026-05-01-005 §U8). Creates the
    # inbox_items row + persists the task token in routine_approval_tokens.
    # No additional IAM beyond the lambda execution role's DB access —
    # the trust boundary is the routines-stepfunctions execution role's
    # lambda:InvokeFunction grant scoped to this Lambda's ARN.
    "routine-approval-callback",
    # routine-step-callback + routine-execution-callback (Phase B U9).
    # Bearer API_AUTH_SECRET ingest endpoints — Task wrappers and the
    # EventBridge SFN-state-change rule POST here. routine-step-callback
    # writes routine_step_events; routine-execution-callback updates
    # routine_executions lifecycle status. Idempotent on the dedup index
    # for steps + on the conditional UPDATE for executions.
    "routine-step-callback",
    "routine-execution-callback",
    # Skill-run dispatcher runtime-config fetch (plan
    # docs/plans/2026-04-24-008-feat-skill-run-dispatcher-plan.md §U1). The
    # runtime skill dispatch calls this with Bearer API_AUTH_SECRET to pull
    # the agent's template + skills + MCP + KBs before building the headless
    # agent turn.
    "agents-runtime-config",
    # Admin-Ops MCP — JSON-RPC endpoint at POST /mcp/admin, exposes the
    # @thinkwork/admin-ops package as MCP tools for managed agents.
    "admin-ops-mcp",
    # MCP admin key management — per-tenant Bearer tokens for admin-ops.
    # Admin-ops-mcp authenticates incoming tokens by sha256-hash lookup
    # against tenant_mcp_admin_keys, populated by this handler's routes.
    "mcp-admin-keys",
    # One-shot tenant provisioning: mints a tkm_ key + stores in Secrets
    # Manager at thinkwork/<stage>/mcp/<tenantId>/admin-ops + upserts
    # tenant_mcp_servers. SM IAM is already granted on thinkwork/* by
    # the secrets-manager grant in aws_iam_policy.api_data_plane
    # (iam-grouped.tf; Create/Update/Get).
    "mcp-admin-provision",
    # Plugin-installed MCP server admin approval (plan §U11, SI-5). Cognito
    # JWT admin caller → approve/reject. Approve computes url_hash =
    # sha256(canonical(url, auth_config)) and pins it; any subsequent
    # mutation to those fields reverts the row to 'pending'.
    "mcp-approval",
    # Daily sweeper: auto-rejects MCP servers pending > 30 days. Triggered
    # by EventBridge schedule (mcp-approval-sweeper-daily).
    "mcp-approval-sweeper",
    # Finance pilot U2 — thread-attachment upload (presign + finalize).
    # presign issues a 5-min PUT URL the end-user client uses to push
    # Excel/CSV bytes directly to S3; finalize sniffs magic bytes, scans
    # OOXML containers (rejects macros + external links), inserts
    # thread_attachments, and emits attachment.received audit event.
    # Cognito JWT (end-user-facing — NOT admin-gated); tenant pinned via
    # threads.tenant_id lookup. Needs WORKSPACE_BUCKET env for S3.
    "thread-attachments-presign",
    "thread-attachments-finalize",
    # U9-remainder of finance pilot — tenant-pinned download endpoint.
    # GET /api/threads/{tid}/attachments/{aid}/download returns a 302
    # to a 5-minute presigned S3 GET URL with ResponseContentDisposition:
    # attachment so browsers download rather than render inline. Same
    # tenant-pin discipline as presign/finalize.
    "thread-attachment-download",
    # Folder bundle import (fat-folder plan Phase D). Admin uploads a zip
    # or GitHub ref and the handler normalizes vendor folder layouts into
    # the agent workspace.
    "folder-bundle-import",
    # Resolved Capability Manifest write endpoint (plan §U15). The runtime
    # POSTs one row per agent-session-start. Shared
    # API_AUTH_SECRET bearer (runtime→API; no tenant OAuth).
    "manifest-log",
    # SI-7 catalog-list read endpoint (plan §U15 pt 3/3). The runtime
    # fetches the allowed builtin-tool slug set once per
    # session-start + feature-flag-gated enforcement filter drops
    # catalog-missing tools before Agent(tools=...). Shared
    # API_AUTH_SECRET bearer.
    "capability-catalog-list",
    # Brain v0 narrow write endpoint. Runtime callers use
    # Bearer API_AUTH_SECRET; GraphQL remains user/admin-facing only.
    "brain-agent-write",
    # Phase 3 U4 of the Compliance audit-event log
    # (docs/plans/2026-05-07-004-feat-compliance-u4-outbox-drainer-plan.md).
    # Single-writer drainer with reserved_concurrent_executions=1 (set
    # below). Connects to Aurora as `compliance_drainer` role via the
    # COMPLIANCE_DRAINER_SECRET_ARN env var (compliance secret created in
    # U2). EventBridge rate(1 minute) schedule + DLQ + MaxRetryAttempts=0
    # (defined in dedicated resources below).
    "compliance-outbox-drainer",
    # Phase 3 U6 of the Compliance audit-event log: runtime REST emit path.
    # Cross-runtime emit endpoint POST /api/compliance/events — Bearer
    # API_AUTH_SECRET, runtime clients post here with a
    # client-supplied UUIDv7 event_id for idempotency. Connects to
    # Aurora via the master DATABASE_SECRET_ARN like every other narrow
    # handler (compliance_writer role is reserved for future hardening).
    "compliance-events",
    # Phase 3 U8b watchdog moved out of for_each into a standalone
    # aws_lambda_function resource (see below). It now uses a sibling
    # IAM role (kms:DescribeKey only on the CMK; s3:ListBucket scoped
    # to anchors/) instead of the shared aws_iam_role.lambda — the
    # widened S3+KMS grant on the shared role would have leaked into
    # 60+ unrelated handlers. Pre-merge step: `terraform state mv`
    # the existing handler["compliance-anchor-watchdog"] address to the
    # new standalone resource (see U8b plan operator-step section).
  ]), toset(local.optional_integration_handler_names)) : toset([])

  function_name = "thinkwork-${var.stage}-api-${each.key}"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = local.runtime
  # Parameters and Secrets extension: container-local cache for the SSM
  # runtime-config document + Secrets Manager reads (runtime-config.tf).
  layers = local.api_handler_layers

  # The runtime-config document must exist before any function loses its
  # env copies, or a mid-apply cold start could cache an empty document
  # for a TTL window. Same reasoning for the platform secrets.
  depends_on = [
    aws_ssm_parameter.runtime_config,
    aws_secretsmanager_secret_version.api_auth,
    aws_secretsmanager_secret_version.appsync_api_key,
  ]
  # eval-runner walks every test case sequentially, invoking an agent +
  # waiting up to 2 min for spans to propagate per test, so a 10-test run
  # can easily exceed the 30 s default. 900 s covers ~5-15 min sweeps.
  # wiki-bootstrap-import runs a full Hindsight ingest for ~3,000 records;
  # the LLM-backed retain path makes it the longest-running Lambda in the
  # set. 900 s is Lambda's per-invocation max and matches eval-runner's ceiling.
  # routine-task-python wraps a 300s sandbox session and needs headroom
  # for the Start/Invoke/Stop/S3-offload round trip; 360s leaves ~60s
  # for AWS-call setup and offload after the sandbox's own ceiling.
  # chat-agent-invoke is now the SETUP phase only (plan 2026-05-22-006 U3):
  # validates the agent, builds the AgentCore invoke payload, dispatches
  # Event-mode, and returns. Setup is ~5s in practice; 60s gives 12×
  # headroom for transient slowness.
  timeout     = each.key == "wakeup-processor" ? 300 : each.key == "chat-agent-invoke" ? 60 : each.key == "chat-agent-finalize" ? 60 : each.key == "workspace-event-dispatcher" ? 60 : each.key == "eval-runner" ? 900 : each.key == "eval-worker" ? 240 : each.key == "wiki-compile" ? 480 : each.key == "knowledge-graph-thread-ingest" ? 300 : each.key == "knowledge-graph-observations-ingest" ? 480 : each.key == "requester-memory-dreaming" ? 300 : each.key == "ontology-scan" ? 300 : each.key == "ontology-reprocess" ? 300 : each.key == "wiki-lint" ? 300 : each.key == "wiki-export" ? 600 : each.key == "okf-materialize" ? 600 : each.key == "okf-efs-refresh" ? 600 : each.key == "wiki-bootstrap-import" ? 900 : each.key == "folder-bundle-import" ? 300 : each.key == "routine-task-python" ? 360 : each.key == "model-converse" ? 60 : each.key == "memory-retain" ? 90 : 30
  memory_size = each.key == "graphql-http" ? 512 : each.key == "wakeup-processor" ? 512 : each.key == "workspace-event-dispatcher" ? 512 : each.key == "eval-runner" ? 512 : each.key == "eval-worker" ? 512 : each.key == "wiki-compile" ? 1024 : each.key == "knowledge-graph-thread-ingest" ? 1024 : each.key == "knowledge-graph-observations-ingest" ? 1024 : each.key == "requester-memory-dreaming" ? 512 : each.key == "ontology-scan" ? 512 : each.key == "wiki-export" ? 1024 : each.key == "okf-materialize" ? 1024 : each.key == "okf-efs-refresh" ? 1024 : each.key == "wiki-bootstrap-import" ? 1024 : each.key == "folder-bundle-import" ? 1024 : 256

  filename         = local.use_local_zips ? "${var.lambda_zips_dir}/${each.key}.zip" : null
  source_code_hash = local.use_local_zips ? filebase64sha256("${var.lambda_zips_dir}/${each.key}.zip") : null
  s3_bucket        = local.use_remote_lambda_artifacts ? var.lambda_artifact_bucket : null
  s3_key           = local.use_remote_lambda_artifacts ? "${local.lambda_artifact_prefix}/${each.key}.zip" : null

  # Per-handler reserved concurrency. compliance-outbox-drainer is a
  # single-writer (per-tenant hash chain integrity depends on it — two
  # concurrent drainers would race the chain head SELECT and produce
  # orphan prev_hash links). All other handlers run with the default
  # account-level concurrency pool.
  reserved_concurrent_executions = each.key == "compliance-outbox-drainer" ? 1 : each.key == "eval-worker" ? 20 : -1

  environment {
    variables = merge(
      local.common_env,
      { FUNCTION_NAME = each.key },
      lookup(local.handler_extra_env, each.key, {}),
    )
  }

  dynamic "vpc_config" {
    for_each = (
      (
        contains(["knowledge-graph-thread-ingest", "knowledge-graph-observations-ingest"], each.key) ||
        (each.key == "graphql-http" && var.memory_engine == "cognee")
      ) && local.cognee_worker_vpc_enabled
    ) ? [1] : each.key == "okf-efs-refresh" && local.okf_efs_vpc_enabled ? [1] : []

    content {
      subnet_ids         = each.key == "okf-efs-refresh" ? var.okf_efs_subnet_ids : var.cognee_worker_subnet_ids
      security_group_ids = each.key == "okf-efs-refresh" ? var.okf_efs_security_group_ids : var.cognee_worker_security_group_ids
    }
  }

  dynamic "file_system_config" {
    for_each = each.key == "okf-efs-refresh" && local.okf_efs_vpc_enabled ? [1] : []

    content {
      arn              = var.okf_efs_refresh_access_point_arn
      local_mount_path = var.okf_efs_mount_path
    }
  }

  lifecycle {
    precondition {
      condition = each.key != "okf-efs-refresh" || var.okf_efs_refresh_access_point_arn == "" || (
        length(var.okf_efs_mount_target_ids) == length(var.okf_efs_subnet_ids) &&
        alltrue([for id in var.okf_efs_mount_target_ids : id != ""])
      )
      error_message = "okf-efs-refresh requires an available EFS mount target dependency for every configured subnet."
    }
  }

  tags = {
    Name    = "thinkwork-${var.stage}-api-${each.key}"
    Handler = each.key
  }
}

# ---------------------------------------------------------------------------
# wiki-compile async retry config + DLQ
# ---------------------------------------------------------------------------
#
# AWS Lambda's default async invoke retries the function 2 times with a
# 1-minute delay before sending failures to a DLQ (or dropping). For
# wiki-compile, retries duplicate Bedrock cost AND can produce duplicate
# user-visible threads + workspace_runs (the brain-enrichment draft path
# in particular — see plan 2026-05-01-002 U5/U6 and
# docs/solutions/architecture-patterns/async-retry-idempotency-lessons).
#
# Pin retries to 0 and route failures to a dedicated DLQ. The runner's
# job-status short-circuit (running/succeeded/failed/skipped) is the
# in-process protection against duplicate writebacks; this is the
# infrastructure-level belt-and-suspenders.

resource "aws_sqs_queue" "wiki_compile_dlq" {
  count                     = local.deploy_lambda_handlers ? 1 : 0
  name                      = "thinkwork-${var.stage}-wiki-compile-dlq"
  message_retention_seconds = 1209600 # 14 days

  tags = {
    Name = "thinkwork-${var.stage}-wiki-compile-dlq"
  }
}

# chat-agent-invoke retry-0 (plan 2026-05-22-006 U3). After the
# direct-callback finalize refactor, chat-agent-invoke is Event-mode-
# dispatched by the GraphQL resolver and itself dispatches AgentCore
# Event-mode. There is no synchronous wait anymore — the Lambda returns
# in ~5s. Retries pinned to 0 so the 2-default-retry storm that produced
# 5-min stall cascades cannot recur. Setup failures (agent lookup,
# runtime config resolve, throttling) surface exactly once via the
# inline error-message-insert path. No DLQ destination: the shared
# Lambda execution role's inline policy budget is already at the
# 10240-byte AWS hard cap, and operator replay of a setup failure is
# rarely useful (the user has already retried by re-sending the message).
resource "aws_lambda_function_event_invoke_config" "chat_agent_invoke" {
  count                        = local.deploy_lambda_handlers ? 1 : 0
  function_name                = aws_lambda_function.handler["chat-agent-invoke"].function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 3600
}

resource "aws_lambda_function_event_invoke_config" "wiki_compile" {
  count                        = local.deploy_lambda_handlers ? 1 : 0
  function_name                = aws_lambda_function.handler["wiki-compile"].function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 3600

  destination_config {
    on_failure {
      destination = aws_sqs_queue.wiki_compile_dlq[0].arn
    }
  }
}

# Ontology suggestion scans are durable-job driven. Disable AWS async
# retries so duplicate scan invocations do not create duplicate review
# proposals; the scan job row is the retry/observability surface.
resource "aws_sqs_queue" "ontology_scan_dlq" {
  count                     = local.deploy_lambda_handlers ? 1 : 0
  name                      = "thinkwork-${var.stage}-ontology-scan-dlq"
  message_retention_seconds = 1209600 # 14 days

  tags = {
    Name = "thinkwork-${var.stage}-ontology-scan-dlq"
  }
}

resource "aws_lambda_function_event_invoke_config" "ontology_scan" {
  count                        = local.deploy_lambda_handlers ? 1 : 0
  function_name                = aws_lambda_function.handler["ontology-scan"].function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 3600

  destination_config {
    on_failure {
      destination = aws_sqs_queue.ontology_scan_dlq[0].arn
    }
  }
}

# Ontology reprocess jobs are row-ledger driven and explicitly claim work.
# Disable AWS async retries to keep failure/retry state in ontology.reprocess_jobs.
resource "aws_sqs_queue" "ontology_reprocess_dlq" {
  count                     = local.deploy_lambda_handlers ? 1 : 0
  name                      = "thinkwork-${var.stage}-ontology-reprocess-dlq"
  message_retention_seconds = 1209600 # 14 days

  tags = {
    Name = "thinkwork-${var.stage}-ontology-reprocess-dlq"
  }
}

resource "aws_lambda_function_event_invoke_config" "ontology_reprocess" {
  count                        = local.deploy_lambda_handlers ? 1 : 0
  function_name                = aws_lambda_function.handler["ontology-reprocess"].function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 3600

  destination_config {
    on_failure {
      destination = aws_sqs_queue.ontology_reprocess_dlq[0].arn
    }
  }
}

# Phase B U8: SFN's inbox_approval Task invokes routine-approval-callback
# directly via .waitForTaskToken. Lambda's default async-retry policy
# (2 attempts) is incompatible with the callback's two-insert flow —
# even though the inserts are now wrapped in db.transaction(), AWS
# Lambda's own retry-after-error semantics multiply with SFN's task
# Retry policy and create thundering-herd attempts on transient
# failures. SFN is the canonical retry path; Lambda async retries are
# off. Per project_async_retry_idempotency_lessons.
resource "aws_lambda_function_event_invoke_config" "routine_approval_callback" {
  count                        = local.deploy_lambda_handlers ? 1 : 0
  function_name                = aws_lambda_function.handler["routine-approval-callback"].function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 3600
}

# Per-turn auto-retain: the runtime Event-invokes
# memory-retain after every chat turn. AWS Lambda's default async-retry
# policy is 2 attempts; without overriding it, a transient failure on the
# canonical-transcript fetch or adapter write retries the entire writeback
# and can multi-write the same per-turn document into Hindsight. The
# longest-suffix-prefix merge in memory-retain.ts dedupes content but the
# retain-cost path (Bedrock tokens charged in adapter.retainConversation)
# is NOT idempotent — retries multiply LLM cost. Per
# project_async_retry_idempotency_lessons.
resource "aws_lambda_function_event_invoke_config" "memory_retain" {
  count                        = local.deploy_lambda_handlers ? 1 : 0
  function_name                = aws_lambda_function.handler["memory-retain"].function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 3600
}

# Product-owned retry path for memory-retain. Lambda async retries remain
# disabled above; this scheduled drain claims due rows from
# memory_retain_attempts and replays bounded retry payloads idempotently.
resource "aws_scheduler_schedule" "memory_retain_retry_drainer" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-memory-retain-retry-drainer"
  group_name          = "default"
  schedule_expression = "rate(1 minutes)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["memory-retain"].arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ kind = "drain_due", limit = 25 })

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

# ---------------------------------------------------------------------------
# Phase 3 U4: compliance-outbox-drainer DLQ + async retry config
#
# AWS Lambda's default async-retry policy is 2 attempts. The drainer's
# INSERT ... ON CONFLICT (outbox_id) DO NOTHING makes per-row replay
# safe, but reserved-concurrency=1 + retry-0 is the architectural
# guarantee that we never have two drainers racing the chain head.
# Per project_async_retry_idempotency_lessons.
# ---------------------------------------------------------------------------

resource "aws_sqs_queue" "compliance_drainer_dlq" {
  count                     = local.deploy_lambda_handlers ? 1 : 0
  name                      = "thinkwork-${var.stage}-compliance-drainer-dlq"
  message_retention_seconds = 1209600 # 14 days

  tags = {
    Name = "thinkwork-${var.stage}-compliance-drainer-dlq"
  }
}

resource "aws_lambda_function_event_invoke_config" "compliance_outbox_drainer" {
  count                        = local.deploy_lambda_handlers ? 1 : 0
  function_name                = aws_lambda_function.handler["compliance-outbox-drainer"].function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 3600

  destination_config {
    on_failure {
      destination = aws_sqs_queue.compliance_drainer_dlq[0].arn
    }
  }
}

# ---------------------------------------------------------------------------
# Phase 3 U4: compliance-outbox-drainer EventBridge schedule (every 1 min)
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "compliance_outbox_drainer" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-compliance-outbox-drainer"
  group_name          = "default"
  schedule_expression = "rate(1 minutes)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["compliance-outbox-drainer"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# ---------------------------------------------------------------------------
# API Gateway routes → Lambda integrations
# ---------------------------------------------------------------------------

locals {
  # Map of route_key → handler name for API Gateway
  api_routes = local.deploy_lambda_handlers ? {
    for route_key, handler_name in {
      # GraphQL — the main API entry point
      "POST /graphql" = "graphql-http"
      "GET /graphql"  = "graphql-http"

      # Health check (keep placeholder alive too)
      # "GET /health" is handled by placeholder

      # Public login capabilities. Unauthenticated by design; the handler
      # resolves tenant-scoped OAuth options only from trusted API Gateway
      # domain metadata and fails closed for unknown/shared hosts.
      "GET /api/auth/options"              = "public-auth-options"
      "OPTIONS /api/auth/options"          = "public-auth-options"
      "GET /api/auth/workos/authorize"     = "workos-auth"
      "OPTIONS /api/auth/workos/authorize" = "workos-auth"
      "GET /api/auth/workos/callback"      = "workos-auth"
      "OPTIONS /api/auth/workos/callback"  = "workos-auth"
      "POST /api/auth/workos/bridge"       = "workos-auth"
      "OPTIONS /api/auth/workos/bridge"    = "workos-auth"
      "POST /api/auth/workos/logout"       = "workos-auth"
      "OPTIONS /api/auth/workos/logout"    = "workos-auth"

      # Agents
      "ANY /api/agents/{proxy+}" = "agents"
      "ANY /api/agents"          = "agents"

      # Agent actions (start/stop/heartbeat/budget)
      "ANY /api/agent-actions/{proxy+}" = "agent-actions"

      # Desktop-local Pi tombstones. Specific routes before broad REST handlers;
      # OPTIONS is handled inside the Lambda before auth.
      "POST /api/desktop/runtime-session"               = "desktop-runtime-session"
      "OPTIONS /api/desktop/runtime-session"            = "desktop-runtime-session"
      "POST /api/desktop/workspace-prewarm"             = "desktop-workspace-prewarm"
      "OPTIONS /api/desktop/workspace-prewarm"          = "desktop-workspace-prewarm"
      "POST /api/desktop/managed-delegation"            = "managed-delegation"
      "OPTIONS /api/desktop/managed-delegation"         = "managed-delegation"
      "POST /api/desktop/eval-runs"                     = "desktop-eval-runs"
      "OPTIONS /api/desktop/eval-runs"                  = "desktop-eval-runs"
      "POST /api/desktop/eval-runs/{runId}/sessions"    = "desktop-eval-runs"
      "OPTIONS /api/desktop/eval-runs/{runId}/sessions" = "desktop-eval-runs"
      "POST /api/desktop/eval-runs/{runId}/results"     = "desktop-eval-runs"
      "OPTIONS /api/desktop/eval-runs/{runId}/results"  = "desktop-eval-runs"

      # Mobile agent harness model proxy (cloud Bedrock Converse). OPTIONS is
      # handled inside the Lambda before auth.
      "POST /api/model/converse"    = "model-converse"
      "OPTIONS /api/model/converse" = "model-converse"

      # Mobile agent harness turn persistence (append a completed turn). OPTIONS
      # handled inside the Lambda before auth.
      "POST /api/threads/record-turn"    = "record-turn"
      "OPTIONS /api/threads/record-turn" = "record-turn"
      "POST /api/mobile/turn-session"    = "mobile-turn-session"
      "OPTIONS /api/mobile/turn-session" = "mobile-turn-session"

      # Mobile local Pi built-in tool proxy. This is intentionally separate from
      # /api/mcp because web_search is a ThinkWork platform capability, not an
      # MCP connector.
      "POST /api/mobile/tools/web-search"    = "mobile-tools"
      "OPTIONS /api/mobile/tools/web-search" = "mobile-tools"
      "POST /api/tasks/status"               = "task-status-tool"
      "OPTIONS /api/tasks/status"            = "task-status-tool"
      "POST /api/work-items/status"          = "task-status-tool"
      "OPTIONS /api/work-items/status"       = "task-status-tool"

      # Mobile agent harness MCP proxy — tenant-scoped tools/list + tools/call
      # over the signed-in user's Cognito idToken. One Lambda, two routes;
      # OPTIONS handled inside the Lambda before auth.
      "POST /api/mcp/tools/list"    = "mcp-proxy"
      "OPTIONS /api/mcp/tools/list" = "mcp-proxy"
      "POST /api/mcp/tools/call"    = "mcp-proxy"
      "OPTIONS /api/mcp/tools/call" = "mcp-proxy"

      # Twenty Client Engagement app: browser -> ThinkWork REST Lambda ->
      # Twenty REST API with the caller's plugin activation.
      "ANY /api/plugin-apps/twenty/client-engagement"          = "twenty-client-engagement"
      "ANY /api/plugin-apps/twenty/client-engagement/{proxy+}" = "twenty-client-engagement"

      # Messages
      "ANY /api/messages/{proxy+}" = "messages"
      "ANY /api/messages"          = "messages"

      # Tenants
      "ANY /api/tenants/{proxy+}" = "tenants"
      "ANY /api/tenants"          = "tenants"

      # Users
      "ANY /api/users/{proxy+}" = "users"
      "ANY /api/users"          = "users"

      # Invites
      "ANY /api/invites/{proxy+}" = "invites"
      "ANY /api/invites"          = "invites"

      # Compliance audit-event emit (Phase 3 U6) — narrow Bearer
      # API_AUTH_SECRET endpoint, runtime clients post here.
      "POST /api/compliance/events" = "compliance-events"

      # Skills
      "ANY /api/skills/{proxy+}" = "skills"
      "ANY /api/skills"          = "skills"

      # User Memory MCP OAuth/resource-server unblocker. These endpoints are
      # enough for `codex mcp login thinkwork-user-memory-dev` to discover OAuth,
      # register as a public PKCE client, sign the user in through Cognito, and
      # receive a bearer token for the User Memory MCP resource.
      "GET /.well-known/oauth-protected-resource"          = "mcp-oauth"
      "GET /.well-known/oauth-protected-resource/{proxy+}" = "mcp-oauth"
      "GET /.well-known/oauth-authorization-server"        = "mcp-oauth"
      "GET /.well-known/openid-configuration"              = "mcp-oauth"
      "GET /mcp/oauth/jwks"                                = "mcp-oauth"
      "POST /mcp/oauth/register"                           = "mcp-oauth"
      "GET /mcp/oauth/authorize"                           = "mcp-oauth"
      "GET /mcp/oauth/callback"                            = "mcp-oauth"
      "POST /mcp/oauth/token"                              = "mcp-oauth"
      "POST /mcp/oauth/revoke"                             = "mcp-oauth"
      "ANY /mcp/user-memory"                               = "mcp-user-memory"
      "ANY /mcp/context-engine"                            = "mcp-context-engine"
      "ANY /mcp/open-engine"                               = "mcp-open-engine"

      # Brain v0 service-auth writeback.
      "POST /api/brain/agent-write"    = "brain-agent-write"
      "OPTIONS /api/brain/agent-write" = "brain-agent-write"

      # Activity
      "ANY /api/activity/{proxy+}" = "activity"
      "ANY /api/activity"          = "activity"

      # Connections + OAuth
      "ANY /api/connections/{proxy+}" = "connections"
      "ANY /api/connections"          = "connections"
      "GET /api/oauth/authorize"      = "oauth-authorize"
      "GET /api/oauth/callback"       = "oauth-callback"

      # Stripe billing (unauthenticated — checkout is pre-signup; webhook is
      # server-to-server with Stripe signature verification).
      "POST /api/stripe/checkout-session"                                       = "stripe-checkout"
      "OPTIONS /api/stripe/checkout-session"                                    = "stripe-checkout"
      "POST /api/stripe/webhook"                                                = "stripe-webhook"
      "POST /api/stripe/portal-session"                                         = "stripe-portal"
      "OPTIONS /api/stripe/portal-session"                                      = "stripe-portal"
      "GET /api/stripe/subscription"                                            = "stripe-subscription"
      "OPTIONS /api/stripe/subscription"                                        = "stripe-subscription"
      "POST /api/deployment-sessions"                                           = "deployment-sessions"
      "OPTIONS /api/deployment-sessions"                                        = "deployment-sessions"
      "GET /api/deployment-sessions/{sessionId}"                                = "deployment-sessions"
      "OPTIONS /api/deployment-sessions/{sessionId}"                            = "deployment-sessions"
      "POST /api/deployment-sessions/{sessionId}/bootstrap-credential-lease"    = "deployment-sessions"
      "DELETE /api/deployment-sessions/{sessionId}/bootstrap-credential-lease"  = "deployment-sessions"
      "OPTIONS /api/deployment-sessions/{sessionId}/bootstrap-credential-lease" = "deployment-sessions"
      "POST /api/deployment-sessions/{sessionId}/authority-transfer"            = "deployment-sessions"
      "OPTIONS /api/deployment-sessions/{sessionId}/authority-transfer"         = "deployment-sessions"
      "POST /api/deployment-sessions/{sessionId}/start"                         = "deployment-sessions"
      "OPTIONS /api/deployment-sessions/{sessionId}/start"                      = "deployment-sessions"
      "POST /api/deployment-sessions/{sessionId}/teardown"                      = "deployment-sessions"
      "OPTIONS /api/deployment-sessions/{sessionId}/teardown"                   = "deployment-sessions"
      "GET /api/auth/me"                                                        = "auth-me"
      "OPTIONS /api/auth/me"                                                    = "auth-me"
      "ANY /api/extensions/{extensionId}"                                       = "extension-proxy"
      "ANY /api/extensions/{extensionId}/{proxy+}"                              = "extension-proxy"

      # Routines
      "ANY /api/routines/{proxy+}" = "routines"
      "ANY /api/routines"          = "routines"

      # Budgets
      "ANY /api/budgets/{proxy+}" = "budgets"
      "ANY /api/budgets"          = "budgets"

      # Guardrails
      "ANY /api/guardrails/{proxy+}" = "guardrails"
      "ANY /api/guardrails"          = "guardrails"

      # Scheduled Jobs
      "ANY /api/scheduled-jobs/{proxy+}" = "scheduled-jobs"
      "ANY /api/scheduled-jobs"          = "scheduled-jobs"
      "ANY /api/thread-turns/{proxy+}"   = "scheduled-jobs"
      "ANY /api/thread-turns"            = "scheduled-jobs"
      "ANY /api/trigger-runs/{proxy+}"   = "scheduled-jobs"
      "ANY /api/trigger-runs"            = "scheduled-jobs"

      # Job Schedule Manager (EventBridge CRUD)
      "ANY /api/job-schedules/{proxy+}" = "job-schedule-manager"
      "ANY /api/job-schedules"          = "job-schedule-manager"

      # Integration webhooks (Unit 8 — composable-skills). Each integration
      # has its own Lambda + a specific route under /webhooks/{integration}/
      # {tenantId}. Specific routes take precedence over the {proxy+}
      # catch-all below, which still owns the legacy PRD-19 webhook-token
      # surface.
      "POST /webhooks/crm-opportunity/{tenantId}" = "webhook-crm-opportunity"
      "POST /webhooks/task-event/{tenantId}"      = "webhook-task-event"

      # Webhooks (public trigger) — legacy PRD-19 tokenized webhooks.
      "POST /webhooks/{proxy+}" = "webhooks"

      # n8n agent-step bridge — public tenant-scoped credential endpoint for
      # stock n8n HTTP Request nodes.
      "POST /api/integrations/n8n/agent-steps"    = "n8n-agent-step-bridge"
      "OPTIONS /api/integrations/n8n/agent-steps" = "n8n-agent-step-bridge"

      # Webhooks admin
      "ANY /api/webhooks/{proxy+}" = "webhooks-admin"
      "ANY /api/webhooks"          = "webhooks-admin"

      # Workspace source fetch authorization (dynamic workspace U4).
      # Registered before the /api/workspaces/{proxy+} catch-all — API
      # Gateway HTTP APIs route to the most specific match, so these two
      # take precedence over the workspace-files proxy route.
      "POST /api/workspaces/fetch-source"    = "workspace-fetch-source"
      "OPTIONS /api/workspaces/fetch-source" = "workspace-fetch-source"

      # Workspace files
      "ANY /api/workspaces/{proxy+}" = "workspace-files"

      # Knowledge bases
      "ANY /api/knowledge-bases/{proxy+}" = "knowledge-base-files"

      # Email
      "POST /api/email/send"                                 = "email-send"
      "POST /api/email/provider-webhook/{providerInstallId}" = "email-provider-webhook"
      "POST /api/email/readiness/probe"                      = "email-readiness-probe"

      # Slack workspace app ingress. These unauthenticated public endpoints
      # verify Slack signatures in handler code before any tenant work happens.
      "POST /slack/events"        = "slack-events"
      "POST /slack/slash-command" = "slack-slash-command"
      "POST /slack/interactivity" = "slack-interactivity"
      "GET /slack/oauth/install"  = "slack-oauth-install"
      "POST /slack/oauth/install" = "slack-oauth-install"

      # Memory
      "ANY /api/memory/{proxy+}" = "memory"

      # Artifacts
      "POST /api/artifacts/{proxy+}" = "artifact-deliver"

      # Recipes
      "POST /api/recipe-refresh" = "recipe-refresh"

      # GitHub App
      "ANY /api/github-app/{proxy+}" = "github-app"
      "POST /api/github/webhook"     = "github-app"

      # AgentCore Code Sandbox (plan Unit 10 + Unit 11). The runtime calls
      # both with Bearer API_AUTH_SECRET before + after every
      # executeCode. 429 on quota denial, 201 on audit-row insert.
      "POST /api/sandbox/quota/check-and-increment" = "sandbox-quota-check"
      "POST /api/sandbox/invocations"               = "sandbox-invocation-log"

      # Routines ASL validator (plan 2026-05-01-004 §U5). Bearer
      # API_AUTH_SECRET. Chat builder + publish flow POST the candidate
      # ASL document; returns { valid, errors, warnings }.
      "POST /api/routines/validate"    = "routine-asl-validator"
      "OPTIONS /api/routines/validate" = "routine-asl-validator"

      # Routines step-event ingest (plan 2026-05-01-005 §U9). Task wrappers
      # (routine-task-python, routine-resume) POST per-step status
      # transitions; the EventBridge rule in routines-stepfunctions/main.tf
      # POSTs SFN execution-state-change events here for the agent_invoke
      # recipe path (no wrapper Lambda). Bearer API_AUTH_SECRET. Idempotent
      # via partial unique index on (execution_id, node_id, status,
      # started_at) — see migration 0056.
      "POST /api/routines/step"         = "routine-step-callback"
      "OPTIONS /api/routines/step"      = "routine-step-callback"
      "POST /api/routines/execution"    = "routine-execution-callback"
      "OPTIONS /api/routines/execution" = "routine-execution-callback"

      # chat-agent-finalize — AgentCore runtime POSTs here at end-of-turn so
      # the post-AgentCore bookkeeping runs out-of-band from chat-agent-invoke.
      # Bearer API_AUTH_SECRET. Plan 2026-05-22-006.
      "POST /api/threads/{threadId}/finalize"    = "chat-agent-finalize"
      "OPTIONS /api/threads/{threadId}/finalize" = "chat-agent-finalize"

      # chat-agent-activity — Pi runtime POSTs here mid-turn to stream live
      # agent activity to the Spaces thread. Bearer API_AUTH_SECRET, best-effort.
      # Plan 2026-06-03-001.
      "POST /api/threads/{threadId}/activity"    = "chat-agent-activity"
      "OPTIONS /api/threads/{threadId}/activity" = "chat-agent-activity"

      # ask_user_question intake — the Pi runtime POSTs a question batch
      # here (awaited) before returning its sentinel tool result. Served by
      # the SAME chat-agent-activity Lambda (route discrimination in the
      # handler — no new Lambda). Bearer API_AUTH_SECRET + thread-turn
      # ownership join; 409 on the one-pending-per-thread partial unique
      # index. Plan 2026-06-09-005 U2.
      "POST /api/threads/{threadId}/questions"    = "chat-agent-activity"
      "OPTIONS /api/threads/{threadId}/questions" = "chat-agent-activity"

      # Skill-run dispatcher runtime-config fetch. Service-auth GET.
      "GET /api/agents/runtime-config" = "agents-runtime-config"

      # Admin-Ops MCP server — single JSON-RPC endpoint. Managed agents
      # (and anyone else) POST with Bearer <tenant-scoped token> issued by
      # the mcp-admin-keys handler below. The shared API_AUTH_SECRET is
      # retained as a break-glass superuser path for bootstrap/debug.
      "POST /mcp/admin" = "admin-ops-mcp"

      # MCP admin key management — per-tenant Bearer token CRUD. Tokens
      # are shown ONCE at creation (POST returns raw value); server stores
      # sha256 hash only. These specific routes take precedence over the
      # existing `ANY /api/tenants/{proxy+}` route (tenants handler) per
      # API Gateway v2's most-specific-match rule.
      "POST /api/tenants/{tenantId}/mcp-admin-keys"           = "mcp-admin-keys"
      "GET /api/tenants/{tenantId}/mcp-admin-keys"            = "mcp-admin-keys"
      "DELETE /api/tenants/{tenantId}/mcp-admin-keys/{keyId}" = "mcp-admin-keys"

      # One-shot tenant provisioning for the admin-ops MCP. Mints a fresh
      # tkm_ key + stores it in Secrets Manager at
      # thinkwork/<stage>/mcp/<tenantId>/admin-ops + upserts the
      # tenant_mcp_servers row so the runtime picks the server up for
      # any agent that gets it assigned via agent_mcp_servers.
      "POST /api/tenants/{tenantId}/mcp-admin-provision" = "mcp-admin-provision"

      # MCP server admin approval (plan §U11, SI-5). Externally-sourced MCP
      # servers land with status='pending'; these routes flip them to
      # approved/rejected. Cognito JWT only (mcp-approval handler rejects
      # apikey callers) — the admin SPA is the sole UI surface.
      "POST /api/tenants/{tenantId}/mcp-servers/{serverId}/approve"    = "mcp-approval"
      "OPTIONS /api/tenants/{tenantId}/mcp-servers/{serverId}/approve" = "mcp-approval"
      "POST /api/tenants/{tenantId}/mcp-servers/{serverId}/reject"     = "mcp-approval"
      "OPTIONS /api/tenants/{tenantId}/mcp-servers/{serverId}/reject"  = "mcp-approval"

      # Finance pilot U2 — thread-attachment upload (presign + finalize).
      # Cognito JWT; tenant pinned via threads.tenant_id lookup. OPTIONS
      # is handled inside the Lambda before auth.
      "POST /api/threads/{threadId}/attachments/presign"     = "thread-attachments-presign"
      "OPTIONS /api/threads/{threadId}/attachments/presign"  = "thread-attachments-presign"
      "POST /api/threads/{threadId}/attachments/finalize"    = "thread-attachments-finalize"
      "OPTIONS /api/threads/{threadId}/attachments/finalize" = "thread-attachments-finalize"

      # U9-remainder of finance pilot — tenant-pinned download endpoint.
      "GET /api/threads/{threadId}/attachments/{attachmentId}/download"     = "thread-attachment-download"
      "OPTIONS /api/threads/{threadId}/attachments/{attachmentId}/download" = "thread-attachment-download"

      # Fat-folder bundle import. OPTIONS is handled inside the Lambda before auth.
      "POST /api/agents/{agentId}/import-bundle"    = "folder-bundle-import"
      "OPTIONS /api/agents/{agentId}/import-bundle" = "folder-bundle-import"

      # Resolved Capability Manifest write endpoint (plan §U15). The runtime
      # posts one row per agent-session-start. Shared
      # API_AUTH_SECRET; no tenant OAuth.
      "POST /api/runtime/manifests"    = "manifest-log"
      "OPTIONS /api/runtime/manifests" = "manifest-log"

      # SI-7 catalog-list read (plan §U15 pt 3/3). The runtime fetches
      # the allowed slug set once per session-start. Shared API_AUTH_SECRET.
      "GET /api/runtime/capability-catalog"     = "capability-catalog-list"
      "OPTIONS /api/runtime/capability-catalog" = "capability-catalog-list"
    } : route_key => handler_name
    if !contains(local.optional_integration_handler_names, handler_name)
  } : {}
}

resource "aws_apigatewayv2_integration" "handler" {
  for_each = local.api_routes

  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.handler[each.value].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "handler" {
  for_each = local.api_routes

  api_id    = aws_apigatewayv2_api.main.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.handler[each.key].id}"
}

resource "aws_lambda_permission" "handler_apigw" {
  for_each = local.deploy_lambda_handlers ? toset(distinct(values(local.api_routes))) : toset([])

  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.handler[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

################################################################################
# EventBridge → routine-execution-callback
################################################################################

resource "aws_cloudwatch_event_rule" "routine_sfn_state_change" {
  count       = local.deploy_lambda_handlers ? 1 : 0
  name        = "thinkwork-${var.stage}-routines-sfn-state-change"
  description = "Forward routine Step Functions execution state changes to the callback Lambda."

  event_pattern = jsonencode({
    source        = ["aws.states"]
    "detail-type" = ["Step Functions Execution Status Change"]
    detail = {
      stateMachineArn = [
        {
          prefix = "arn:aws:states:${var.region}:${var.account_id}:stateMachine:thinkwork-${var.stage}-routine-"
        },
      ]
    }
  })

  tags = {
    Name  = "thinkwork-${var.stage}-routines-sfn-state-change"
    Stage = var.stage
  }
}

resource "aws_cloudwatch_event_target" "routine_sfn_state_change" {
  count     = local.deploy_lambda_handlers ? 1 : 0
  rule      = aws_cloudwatch_event_rule.routine_sfn_state_change[0].name
  target_id = "routine-execution-callback"
  arn       = aws_lambda_function.handler["routine-execution-callback"].arn
}

resource "aws_lambda_permission" "routine_sfn_state_change" {
  count         = local.deploy_lambda_handlers ? 1 : 0
  statement_id  = "AllowEventBridgeInvokeRoutineExecutionCallback"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.handler["routine-execution-callback"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.routine_sfn_state_change[0].arn
}

# ---------------------------------------------------------------------------
# Wakeup Processor — EventBridge schedule (every 1 min)
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "wakeup_processor" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-wakeup-processor"
  group_name          = "default"
  schedule_expression = "rate(1 minutes)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["wakeup-processor"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# ---------------------------------------------------------------------------
# n8n agent-step expirer — resumes waiting n8n executions on timeout/retry
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "n8n_agent_step_expirer" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-n8n-agent-step-expirer"
  group_name          = "default"
  schedule_expression = "rate(1 minutes)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["n8n-agent-step-expirer"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# ---------------------------------------------------------------------------
# webhook_deliveries retention cron — daily delete of rows older than 90 days
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "webhook_deliveries_cleanup" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-webhook-deliveries-cleanup"
  group_name          = "default"
  schedule_expression = "cron(0 4 * * ? *)" # daily at 04:00 UTC
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["webhook-deliveries-cleanup"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# ---------------------------------------------------------------------------
# Requester memory dreaming — broad per-user memory compaction/reflection sweep
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "requester_memory_dreaming" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-requester-memory-dreaming"
  group_name          = "default"
  schedule_expression = var.requester_memory_dreaming_schedule_expression
  state               = var.requester_memory_dreaming_enabled ? "ENABLED" : "DISABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["requester-memory-dreaming"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# ---------------------------------------------------------------------------
# MCP approval TTL sweeper — daily auto-reject of pending rows > 30 days old
# (plan §U11). A plugin whose MCP sat uncurated for a month is stale: clear
# pending to keep the admin queue honest and surface the reject action in
# the audit log.
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "mcp_approval_sweeper" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-mcp-approval-sweeper"
  group_name          = "default"
  schedule_expression = "cron(15 4 * * ? *)" # daily at 04:15 UTC (offset from webhook cleanup)
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["mcp-approval-sweeper"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# ---------------------------------------------------------------------------
# skill_runs reconciler — transitions stuck-running rows to failed every 5 min.
# Guards against agentcore Lambda crashes / OOMs that drop the
# /api/skills/complete writeback and leave the row at 'running' forever,
# which in turn blocks the dedup partial unique index from letting retries
# through.
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "skill_runs_reconciler" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-skill-runs-reconciler"
  group_name          = "default"
  schedule_expression = "rate(5 minutes)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["skill-runs-reconciler"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# ---------------------------------------------------------------------------
# eval_runs reconciler — finalizes stuck-running eval runs every 5 min.
# Guards against worker crashes/timeouts that occur before a per-case result
# row is written. Missing category-selected cases are recorded as error rows,
# then the run is finalized so the Admin UI cannot remain "running" forever.
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "eval_runs_reconciler" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-eval-runs-reconciler"
  group_name          = "default"
  schedule_expression = "rate(5 minutes)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["eval-runs-reconciler"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# ---------------------------------------------------------------------------
# trace_invocation_reconciler — reconciles runtime LLM usage against Bedrock
# invocation logs every 5 min. Idempotent at the source-evidence/fact level.
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "trace_invocation_reconciler" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-trace-invocation-reconciler"
  group_name          = "default"
  schedule_expression = "rate(5 minutes)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["trace-invocation-reconciler"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# Bedrock model invocation logs are the provider-observed evidence source for
# trace invocation reconciliation. The Bedrock setting is account/region scoped,
# so keep the destination stage-neutral and let each stage's reconciler match
# only rows present in its own database. Because both the log group name and
# the account logging configuration are singletons per account+region, only
# ONE stage may manage them (var.manage_bedrock_invocation_logging) — a second
# stack collides on the log group and would clobber, then destroy, the
# account-level config out from under the managing stage (harness cycle-5).
locals {
  bedrock_invocation_log_group_name = "/thinkwork/bedrock/model-invocations"
  bedrock_invocation_log_group_arn  = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/thinkwork/bedrock/model-invocations"
}

# Adding count re-addressed these resources (`x` → `x[0]`); without moved
# blocks, existing states (dev) plan destroy+create — losing invocation-log
# history and racing the same-name recreate (the private_nat
# RouteAlreadyExists failure class from the cycle-4 fix).
moved {
  from = aws_cloudwatch_log_group.bedrock_model_invocations
  to   = aws_cloudwatch_log_group.bedrock_model_invocations[0]
}

moved {
  from = aws_iam_role.bedrock_model_invocation_logging
  to   = aws_iam_role.bedrock_model_invocation_logging[0]
}

moved {
  from = aws_iam_role_policy.bedrock_model_invocation_logging
  to   = aws_iam_role_policy.bedrock_model_invocation_logging[0]
}

moved {
  from = aws_bedrock_model_invocation_logging_configuration.this
  to   = aws_bedrock_model_invocation_logging_configuration.this[0]
}

resource "aws_cloudwatch_log_group" "bedrock_model_invocations" {
  count             = var.manage_bedrock_invocation_logging ? 1 : 0
  name              = local.bedrock_invocation_log_group_name
  retention_in_days = 30

  tags = {
    Name      = "thinkwork-bedrock-model-invocations"
    Stage     = var.stage
    Component = "bedrock-model-invocation-logging"
  }
}

resource "aws_iam_role" "bedrock_model_invocation_logging" {
  count = var.manage_bedrock_invocation_logging ? 1 : 0
  name  = "thinkwork-${var.stage}-bedrock-model-invocation-logging"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "bedrock.amazonaws.com"
        }
        Action = "sts:AssumeRole"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = var.account_id
          }
        }
      },
    ]
  })

  tags = {
    Name      = "thinkwork-${var.stage}-bedrock-model-invocation-logging"
    Stage     = var.stage
    Component = "bedrock-model-invocation-logging"
  }
}

resource "aws_iam_role_policy" "bedrock_model_invocation_logging" {
  count = var.manage_bedrock_invocation_logging ? 1 : 0
  name  = "write-bedrock-model-invocation-logs"
  role  = aws_iam_role.bedrock_model_invocation_logging[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "WriteCloudWatchInvocationLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:DescribeLogStreams",
          "logs:PutLogEvents",
        ]
        Resource = [
          local.bedrock_invocation_log_group_arn,
          "${local.bedrock_invocation_log_group_arn}:log-stream:aws/bedrock/modelinvocations",
          "${local.bedrock_invocation_log_group_arn}:log-stream:aws/bedrock/modelinvocations*",
        ]
      },
      {
        Sid    = "WriteLargeInvocationPayloads"
        Effect = "Allow"
        Action = [
          "s3:GetBucketLocation",
          "s3:ListBucket",
        ]
        Resource = var.bucket_arn
      },
      {
        Sid      = "PutLargeInvocationPayloads"
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${var.bucket_arn}/bedrock/model-invocation-logs/*"
      },
    ]
  })
}

resource "aws_bedrock_model_invocation_logging_configuration" "this" {
  count = var.manage_bedrock_invocation_logging ? 1 : 0

  logging_config {
    text_data_delivery_enabled      = true
    image_data_delivery_enabled     = false
    embedding_data_delivery_enabled = false
    video_data_delivery_enabled     = false

    cloudwatch_config {
      log_group_name = aws_cloudwatch_log_group.bedrock_model_invocations[0].name
      role_arn       = aws_iam_role.bedrock_model_invocation_logging[0].arn

      large_data_delivery_s3_config {
        bucket_name = var.bucket_name
        key_prefix  = "bedrock/model-invocation-logs/large/"
      }
    }

    s3_config {
      bucket_name = var.bucket_name
      key_prefix  = "bedrock/model-invocation-logs/"
    }
  }

  depends_on = [aws_iam_role_policy.bedrock_model_invocation_logging]
}

# ---------------------------------------------------------------------------
# cost_bill_reconciler — imports AWS billing export evidence daily. Targeted
# operator invokes can reconcile a specific manifest/import immediately.
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "cost_bill_reconciler" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-cost-bill-reconciler"
  group_name          = "default"
  schedule_expression = "cron(30 5 * * ? *)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["cost-bill-reconciler"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# ---------------------------------------------------------------------------
# Stall monitor — marks stalled thread turns and runbook steps failed every
# minute. This is the global backstop for agent/runtime crashes; the Computer
# heartbeat also reconciles its own stale runbook tasks while it is alive.
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "stall_monitor" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-stall-monitor"
  group_name          = "default"
  schedule_expression = "rate(1 minutes)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["cron-stall-monitor"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}


# ---------------------------------------------------------------------------
# Compounding Memory — nightly hygiene + export
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "wiki_compile_drainer" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-wiki-compile-drainer"
  group_name          = "default"
  schedule_expression = "rate(1 minutes)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["wiki-compile"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# Observations → Knowledge Graph sweep (plan 2026-06-09-004 U5). Enumerates
# tenants and runs an incremental observations ingest per tenant; the stable
# source_ref's active-run dedupe drops overlap with operator-started runs and
# the in-handler stale-run reaper clears stranded rows past the run ceiling.
resource "aws_scheduler_schedule" "knowledge_graph_observations_ingest" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-knowledge-graph-observations-ingest"
  group_name          = "default"
  schedule_expression = "rate(30 minutes)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["knowledge-graph-observations-ingest"].arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ sweep = true, trigger = "scheduled" })
  }
}

resource "aws_scheduler_schedule" "wiki_lint" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-wiki-lint"
  group_name          = "default"
  schedule_expression = "cron(0 2 * * ? *)" # daily at 02:00 UTC
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["wiki-lint"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

resource "aws_scheduler_schedule" "wiki_export" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-wiki-export"
  group_name          = "default"
  schedule_expression = "cron(0 3 * * ? *)" # daily at 03:00 UTC (after lint)
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.handler["wiki-export"].arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

# S3 bucket for markdown vault exports. One bundle per (tenant, owner, date).
# Retention is handled by the lifecycle rule below (30 days).
resource "aws_s3_bucket" "wiki_exports" {
  bucket        = "thinkwork-${var.stage}-wiki-exports"
  force_destroy = var.stage == "dev"

  tags = {
    Name = "thinkwork-${var.stage}-wiki-exports"
  }
}

resource "aws_s3_bucket_public_access_block" "wiki_exports" {
  bucket                  = aws_s3_bucket.wiki_exports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "wiki_exports" {
  bucket = aws_s3_bucket.wiki_exports.id

  rule {
    id     = "expire-old-bundles"
    status = "Enabled"

    filter {}

    expiration {
      days = 30
    }
  }
}

# Canonical Company Brain artifact store. Unlike wiki_exports, this bucket
# is the durable replay/projection substrate for Brain source artifacts,
# ingestion manifests, migration snapshots, vault projections, and exports.
resource "aws_s3_bucket" "brain_artifacts" {
  bucket        = "thinkwork-${var.stage}-brain-artifacts"
  force_destroy = var.stage == "dev"

  tags = {
    Name    = "thinkwork-${var.stage}-brain-artifacts"
    Purpose = "company-brain-artifacts"
  }
}

resource "aws_s3_bucket_public_access_block" "brain_artifacts" {
  bucket                  = aws_s3_bucket.brain_artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "brain_artifacts" {
  bucket = aws_s3_bucket.brain_artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "brain_artifacts" {
  bucket = aws_s3_bucket.brain_artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.brain_artifacts_kms_key_arn != "" ? "aws:kms" : "AES256"
      kms_master_key_id = var.brain_artifacts_kms_key_arn != "" ? var.brain_artifacts_kms_key_arn : null
    }

    bucket_key_enabled = var.brain_artifacts_kms_key_arn != ""
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "brain_artifacts" {
  bucket = aws_s3_bucket.brain_artifacts.id

  rule {
    id     = "source-artifacts-transition"
    status = "Enabled"

    filter {
      prefix = "source-artifacts/"
    }

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    noncurrent_version_transition {
      noncurrent_days = 90
      storage_class   = "STANDARD_IA"
    }
  }

  rule {
    id     = "ingestion-manifests-transition"
    status = "Enabled"

    filter {
      prefix = "ingestion-manifests/"
    }

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    noncurrent_version_transition {
      noncurrent_days = 90
      storage_class   = "STANDARD_IA"
    }
  }

  rule {
    id     = "migration-snapshots-transition"
    status = "Enabled"

    filter {
      prefix = "migration-snapshots/"
    }

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    noncurrent_version_transition {
      noncurrent_days = 90
      storage_class   = "STANDARD_IA"
    }
  }

  rule {
    id     = "vault-projections-transition"
    status = "Enabled"

    filter {
      prefix = "vault-projections/"
    }

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    noncurrent_version_transition {
      noncurrent_days = 90
      storage_class   = "STANDARD_IA"
    }
  }

  rule {
    id     = "exports-expiration"
    status = "Enabled"

    filter {
      prefix = "exports/"
    }

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    expiration {
      days = 365
    }

    noncurrent_version_expiration {
      noncurrent_days = 365
    }
  }
}

data "aws_iam_policy_document" "brain_artifacts_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.brain_artifacts.arn,
      "${aws_s3_bucket.brain_artifacts.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "brain_artifacts" {
  bucket = aws_s3_bucket.brain_artifacts.id
  policy = data.aws_iam_policy_document.brain_artifacts_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.brain_artifacts]
}

resource "aws_iam_role" "scheduler" {
  name = "thinkwork-${var.stage}-scheduler-role"

  # Phase 3 U8a — `aws:SourceAccount` confused-deputy guard. Without
  # this condition, a foreign-account principal who learns the role ARN
  # could potentially construct cross-account Scheduler events. The
  # guard applies to ALL handlers the scheduler invokes; defense-in-depth
  # alongside per-Lambda `aws:SourceArn` pins like the U7 anchor role.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = var.account_id
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name = "invoke-lambda"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["lambda:InvokeFunction"]
      # One name-pattern wildcard instead of enumerating every handler ARN:
      # the enumerated form scaled with handler count × stage-name length and
      # blew IAM's 10,240-byte inline-policy cap for stages ≥ ~11 characters
      # (harness cycle-7 ledger entry; dev's 3-char stage never saw it). The
      # api- prefix covers every for_each handler plus the standalone
      # compliance-anchor and watchdog Lambdas (all named
      # thinkwork-<stage>-api-*).
      Resource = local.deploy_lambda_handlers ? [
        "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-*",
      ] : []
    }]
  })
}

# ---------------------------------------------------------------------------
# SSM Parameters — Lambda ARNs for cross-function invocation
# ---------------------------------------------------------------------------

########################################################################
# SecureString parameter for the Google Places API key. wiki-compile reads
# this on cold start via loadGooglePlacesClientFromSsm() and caches the
# client at module scope. When google_places_api_key is empty (the
# default), we seed the parameter with a placeholder so the Lambda init
# path can distinguish "unconfigured" (skip Google entirely, degrade
# gracefully) from "configured but wrong" (log + skip). lifecycle.ignore_
# changes on `value` lets ops rotate via
#   aws ssm put-parameter --overwrite \
#     --name /thinkwork/<stage>/google-places/api-key \
#     --type SecureString --value <KEY>
# without terraform fighting it on the next apply.
########################################################################

resource "aws_ssm_parameter" "google_places_api_key" {
  name        = "/thinkwork/${var.stage}/google-places/api-key"
  type        = "SecureString"
  value       = var.google_places_api_key != "" ? var.google_places_api_key : "PLACEHOLDER_SET_VIA_CLI"
  description = "Google Places API (New) key consumed by wiki-compile. See docs/plans/2026-04-21-005-feat-wiki-place-capability-v2-plan.md Unit 4."

  lifecycle {
    # Allow `aws ssm put-parameter --overwrite` to stick across applies.
    # New-key rotation or initial population by ops should happen via CLI,
    # not via terraform var.
    ignore_changes = [value]
  }
}

########################################################################
# SecureString parameter for the graphql-http Lambda's OWN Cloudflare
# namespace token (plan 2026-06-12-002 U5, KTD7). Tenant slug validation
# lists records under <slug>.thinkwork.ai so signup cannot take a name
# delegated to a customer deployment. The token is zone-scoped DNS:Edit
# on thinkwork.ai, minted SEPARATELY from the CI CLOUDFLARE_API_TOKEN
# (independent rotation; a signup-path compromise doesn't burn CI), and
# is deliberately NOT a Lambda env var — graphql-http's env sits at the
# 4KB ceiling (#2375) — nor a runtime-config document key (secrets stay
# out of the plain String document).
#
# Seeded with a placeholder: @thinkwork/api treats the placeholder (or a
# missing parameter) as "namespace check unconfigured" and SKIPS the
# Cloudflare leg with a loud log (ship-inert posture, so pre-token dev
# stages keep creating tenants). The customer-domain runbook makes the
# real token mandatory for stages whose deployments share the namespace.
# Populate/rotate via:
#   aws ssm put-parameter --overwrite \
#     --name /thinkwork/<stage>/cloudflare-namespace-token \
#     --type SecureString --value <TOKEN>
#
# IAM: read access rides the existing ssm:GetParameter grant on
# parameter/thinkwork/<stage>/* in aws_iam_policy.api_data_plane
# (iam-grouped.tf), plus its kms:Decrypt-via-SSM statement.
########################################################################

resource "aws_ssm_parameter" "cloudflare_namespace_token" {
  name        = "/thinkwork/${var.stage}/cloudflare-namespace-token"
  type        = "SecureString"
  value       = "PLACEHOLDER_SET_VIA_CLI"
  description = "Zone-scoped Cloudflare DNS:Edit token for the thinkwork.ai namespace signup check (plan 2026-06-12-002 U5/KTD7). Placeholder = check skipped; set the real token via CLI."

  lifecycle {
    # Initial population and rotation happen via `aws ssm put-parameter
    # --overwrite`, never via terraform var (the value must not transit
    # tfvars / state more than necessary).
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "lambda_arns" {
  for_each = local.deploy_lambda_handlers ? {
    "chat-agent-invoke-fn-arn"    = aws_lambda_function.handler["chat-agent-invoke"].arn
    "kb-manager-fn-arn"           = aws_lambda_function.handler["knowledge-base-manager"].arn
    "job-schedule-manager-fn-arn" = aws_lambda_function.handler["job-schedule-manager"].arn
    "memory-retain-fn-arn"        = aws_lambda_function.handler["memory-retain"].arn
    "eval-runner-fn-arn"          = aws_lambda_function.handler["eval-runner"].arn
    "eval-worker-fn-arn"          = aws_lambda_function.handler["eval-worker"].arn
  } : {}

  name  = "/thinkwork/${var.stage}/${each.key}"
  type  = "String"
  value = each.value
}

# ===========================================================================
# Phase 3 U8a — Compliance Anchor Lambda (STANDALONE) + Watchdog wiring
# ===========================================================================
# Plan: docs/plans/2026-05-07-010-feat-compliance-u8a-anchor-lambda-inert-plan.md
#
# The anchor Lambda is INTENTIONALLY OUTSIDE the for_each handler set
# because its execution role is the U7 IAM role (`compliance-anchor-
# lambda-role`), not the shared `aws_iam_role.lambda`. Adding a per-key
# `role` ternary on the for_each set is the highest-blast-radius single
# expression in this PR (any expression error silently downgrades 60+
# unrelated handlers); a standalone resource isolates blast radius.
#
# The watchdog DOES live in the for_each set — it uses the shared
# execution role (only needs AWSLambdaBasicExecutionRole + a small inline
# policy below for ComplianceAnchorWatchdogHeartbeat metric emit).
# ===========================================================================

resource "aws_lambda_function" "compliance_anchor" {
  count = local.deploy_lambda_handlers ? 1 : 0

  function_name                  = "thinkwork-${var.stage}-api-compliance-anchor"
  role                           = var.compliance_anchor_lambda_role_arn
  handler                        = "index.handler"
  runtime                        = local.runtime
  timeout                        = 60
  memory_size                    = 1024
  filename                       = local.use_local_zips ? "${var.lambda_zips_dir}/compliance-anchor.zip" : null
  source_code_hash               = local.use_local_zips ? filebase64sha256("${var.lambda_zips_dir}/compliance-anchor.zip") : null
  s3_bucket                      = local.use_remote_lambda_artifacts ? var.lambda_artifact_bucket : null
  s3_key                         = local.use_remote_lambda_artifacts ? "${local.lambda_artifact_prefix}/compliance-anchor.zip" : null
  reserved_concurrent_executions = 1

  environment {
    variables = {
      STAGE                               = var.stage
      AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
      COMPLIANCE_READER_SECRET_ARN        = var.compliance_reader_secret_arn
      COMPLIANCE_DRAINER_SECRET_ARN       = var.compliance_drainer_secret_arn
      COMPLIANCE_ANCHOR_BUCKET_NAME       = var.compliance_anchor_bucket_name
      COMPLIANCE_ANCHOR_RETENTION_DAYS    = tostring(var.compliance_anchor_object_lock_retention_days)
      # Phase 3 U8b — required by `_anchor_fn_live`. The Lambda throws on
      # boot if either of these is empty; the U8b composite root wires
      # both from `module.compliance_anchors` outputs.
      COMPLIANCE_ANCHOR_KMS_KEY_ARN      = var.compliance_anchor_kms_key_arn
      COMPLIANCE_ANCHOR_OBJECT_LOCK_MODE = var.compliance_anchor_object_lock_mode
    }
  }
}

resource "aws_sqs_queue" "compliance_anchor_dlq" {
  count                     = local.deploy_lambda_handlers ? 1 : 0
  name                      = "thinkwork-${var.stage}-compliance-anchor-dlq"
  message_retention_seconds = 1209600 # 14 days, matches the drainer DLQ
  sqs_managed_sse_enabled   = true
}

resource "aws_iam_role_policy" "compliance_anchor_dlq_send" {
  count = local.deploy_lambda_handlers ? 1 : 0
  name  = "compliance-anchor-dlq-send"
  # Attached to the U7 anchor role (which the standalone anchor Lambda assumes).
  role = var.compliance_anchor_lambda_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:SendMessage"]
      Resource = aws_sqs_queue.compliance_anchor_dlq[0].arn
    }]
  })
}

resource "aws_lambda_function_event_invoke_config" "compliance_anchor" {
  count                        = local.deploy_lambda_handlers ? 1 : 0
  function_name                = aws_lambda_function.compliance_anchor[0].function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 3600

  destination_config {
    on_failure {
      destination = aws_sqs_queue.compliance_anchor_dlq[0].arn
    }
  }
}

# ---------------------------------------------------------------------------
# Phase 3 U8b — Watchdog Lambda (STANDALONE).
#
# Moves OFF the shared aws_iam_role.lambda onto a dedicated sibling role
# (kms:DescribeKey only on the CMK, s3:ListBucket prefix-conditioned on
# anchors/, no kms:Decrypt — the watchdog never reads object bodies).
# The shared role's prior compliance_watchdog_metrics inline policy is
# removed (its function is now on the sibling role).
#
# Operator pre-merge: `terraform state mv` the existing
# `aws_lambda_function.handler["compliance-anchor-watchdog"]` address to
# `aws_lambda_function.compliance_anchor_watchdog[0]`. Without it, apply
# fails with ResourceConflictException on the function name.
# ---------------------------------------------------------------------------

resource "aws_lambda_function" "compliance_anchor_watchdog" {
  count = local.deploy_lambda_handlers ? 1 : 0

  function_name    = "thinkwork-${var.stage}-api-compliance-anchor-watchdog"
  role             = var.compliance_anchor_watchdog_role_arn
  handler          = "index.handler"
  runtime          = local.runtime
  timeout          = 30
  memory_size      = 512
  filename         = local.use_local_zips ? "${var.lambda_zips_dir}/compliance-anchor-watchdog.zip" : null
  source_code_hash = local.use_local_zips ? filebase64sha256("${var.lambda_zips_dir}/compliance-anchor-watchdog.zip") : null
  s3_bucket        = local.use_remote_lambda_artifacts ? var.lambda_artifact_bucket : null
  s3_key           = local.use_remote_lambda_artifacts ? "${local.lambda_artifact_prefix}/compliance-anchor-watchdog.zip" : null

  environment {
    variables = {
      STAGE                               = var.stage
      AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
      COMPLIANCE_ANCHOR_BUCKET_NAME       = var.compliance_anchor_bucket_name
    }
  }

  tags = {
    Name    = "thinkwork-${var.stage}-api-compliance-anchor-watchdog"
    Handler = "compliance-anchor-watchdog"
  }
}

# ---------------------------------------------------------------------------
# Schedules — retry_policy is nested inside target { ... }, NOT at the
# schedule top level. Verified against AWS provider schema.
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule" "compliance_anchor" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-compliance-anchor"
  group_name          = "default"
  schedule_expression = "rate(15 minutes)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.compliance_anchor[0].arn
    role_arn = aws_iam_role.scheduler.arn

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

resource "aws_scheduler_schedule" "compliance_anchor_watchdog" {
  count = local.deploy_lambda_handlers ? 1 : 0

  name                = "thinkwork-${var.stage}-compliance-anchor-watchdog"
  group_name          = "default"
  schedule_expression = "rate(5 minutes)"
  state               = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    # Phase 3 U8b — points at the standalone watchdog resource (was
    # aws_lambda_function.handler["compliance-anchor-watchdog"] before
    # the for_each split-out).
    arn      = aws_lambda_function.compliance_anchor_watchdog[0].arn
    role_arn = aws_iam_role.scheduler.arn

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

# ---------------------------------------------------------------------------
# CloudWatch alarms — Phase 3 U8b
#
# Two alarms split the failure space:
#
#   1. compliance-anchor-gap (treat_missing_data = "breaching"). Fires
#      when ComplianceAnchorGap >= 1 for two consecutive 5-min periods
#      OR when the watchdog stops emitting the metric entirely (IAM
#      regression, code crash, S3 ListObjectsV2 perma-fail).
#
#   2. compliance-anchor-watchdog-heartbeat-missing
#      (treat_missing_data = "notBreaching" born-state). Distinguishes
#      "real anchor gap" from "watchdog metric path broken". Born-state
#      is notBreaching to give Greenfield deploys a window before the
#      first heartbeat lands; flip to breaching in a follow-up after
#      first soak (Decision #7 / ADV-004).
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "compliance_anchor_gap" {
  count = local.deploy_lambda_handlers ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-compliance-anchor-gap"
  alarm_description   = "Anchor cadence gap exceeded threshold. LIVE in U8b — fires on >=1 ComplianceAnchorGap=1 OR missing metric (means watchdog broken)."
  namespace           = "Thinkwork/Compliance"
  metric_name         = "ComplianceAnchorGap"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = []

  dimensions = {
    Stage = var.stage
  }
}

resource "aws_cloudwatch_metric_alarm" "compliance_anchor_watchdog_heartbeat_missing" {
  count = local.deploy_lambda_handlers ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-compliance-anchor-watchdog-heartbeat-missing"
  alarm_description   = "Watchdog heartbeat metric is missing. LIVE in U8b — born with treat_missing_data = notBreaching to absorb deploy-time gaps; promote to breaching in a follow-up after first soak."
  namespace           = "Thinkwork/Compliance"
  metric_name         = "ComplianceAnchorWatchdogHeartbeat"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    Stage = var.stage
  }
}

# ---------------------------------------------------------------------------
# Phase 3 U11.U2 — Compliance export runner (STANDALONE, INERT)
#
# The U11.U1 createComplianceExport mutation (PR #944) inserts a queued
# row into compliance.export_jobs and dispatches `{jobId}` to this SQS
# queue. The runner Lambda below has a STUB body in U11.U2 (throws
# "not implemented") — U11.U3 swaps in the live body that streams
# CSV/NDJSON to the exports S3 bucket and publishes a 15-minute
# presigned URL.
#
# Inert-substrate posture (per `feedback_ship_inert_pattern`):
#   - SQS messages from the U11.U1 mutation accumulate.
#   - After maxReceiveCount=3 attempts the stub throw routes them to
#     the DLQ.
#   - The DLQ depth alarm signals operators that the runner needs U11.U3.
#   - This is the visible inert state — silent no-op stubs are an
#     anti-pattern (queued jobs would stay QUEUED forever with no signal).
#
# Standalone Lambda (NOT in the for_each pool) — isolates the runner's
# bucket-scoped IAM role from the 60+ unrelated handlers. Mirrors the
# U8a anchor Lambda's standalone-resource pattern.
# ---------------------------------------------------------------------------

resource "aws_sqs_queue" "compliance_exports_dlq" {
  count                     = local.deploy_lambda_handlers ? 1 : 0
  name                      = "thinkwork-${var.stage}-compliance-exports-dlq"
  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true

  tags = {
    Name = "thinkwork-${var.stage}-compliance-exports-dlq"
  }
}

resource "aws_sqs_queue" "compliance_exports" {
  count                      = local.deploy_lambda_handlers ? 1 : 0
  name                       = "thinkwork-${var.stage}-compliance-exports"
  visibility_timeout_seconds = 900   # matches Lambda 15-min timeout
  message_retention_seconds  = 86400 # 1 day; DLQ holds longer-stuck messages
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.compliance_exports_dlq[0].arn
    maxReceiveCount     = 3
  })

  tags = {
    Name = "thinkwork-${var.stage}-compliance-exports"
  }
}

# Runner role's SQS receive grants — only the runner consumes the queue.
resource "aws_iam_role_policy" "compliance_exports_runner_sqs" {
  count = local.deploy_lambda_handlers ? 1 : 0
  name  = "compliance-exports-runner-sqs"
  role  = var.compliance_exports_runner_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "RunnerSqsReceive"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility",
        ]
        Resource = aws_sqs_queue.compliance_exports[0].arn
      },
      {
        Sid      = "RunnerDlqSend"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.compliance_exports_dlq[0].arn
      },
    ]
  })
}

resource "aws_lambda_function" "compliance_export_runner" {
  count = local.deploy_lambda_handlers ? 1 : 0

  function_name                  = "thinkwork-${var.stage}-api-compliance-export-runner"
  role                           = var.compliance_exports_runner_role_arn
  handler                        = "index.handler"
  runtime                        = local.runtime
  timeout                        = 900
  memory_size                    = 1024
  filename                       = local.use_local_zips ? "${var.lambda_zips_dir}/compliance-export-runner.zip" : null
  source_code_hash               = local.use_local_zips ? filebase64sha256("${var.lambda_zips_dir}/compliance-export-runner.zip") : null
  s3_bucket                      = local.use_remote_lambda_artifacts ? var.lambda_artifact_bucket : null
  s3_key                         = local.use_remote_lambda_artifacts ? "${local.lambda_artifact_prefix}/compliance-export-runner.zip" : null
  reserved_concurrent_executions = 2

  environment {
    variables = {
      STAGE                               = var.stage
      AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
      COMPLIANCE_EXPORTS_BUCKET           = var.compliance_exports_bucket_name
      COMPLIANCE_EXPORTS_QUEUE_URL        = aws_sqs_queue.compliance_exports[0].url
      # Phase 3 U11.U3 — the live runner connects to Aurora as the
      # writer pool (existing app role) for INSERT/UPDATE on
      # compliance.export_jobs and SELECT on compliance.audit_events.
      DATABASE_URL_SECRET_ARN = var.graphql_db_secret_arn
      # The writer-pool secret stores only {username, password}; the
      # runner constructs the URL from these env vars + the secret.
      # Mirrors the fallback in packages/database-pg/src/db.ts's
      # `resolveDatabaseUrlFromSecrets` (deploy run 25563132057
      # surfaced this as "Invalid URL" when only the ARN was wired).
      DATABASE_HOST = var.db_cluster_endpoint
      DATABASE_NAME = var.database_name
    }
  }
}

# SQS → Lambda event source mapping. batch_size=1 so each export is a
# discrete invocation; ReportBatchItemFailures lets the runner mark
# individual messages failed without re-enqueuing the whole batch.
# Concurrency is bounded by the Lambda function's
# reserved_concurrent_executions=2 (set above) — the
# `maximum_concurrency` argument on the event-source mapping requires a
# newer aws provider version than this codebase currently pins, and the
# function-level reservation gives the equivalent ceiling at v1 scale.
resource "aws_lambda_event_source_mapping" "compliance_exports" {
  count = local.deploy_lambda_handlers ? 1 : 0

  event_source_arn        = aws_sqs_queue.compliance_exports[0].arn
  function_name           = aws_lambda_function.compliance_export_runner[0].function_name
  batch_size              = 1
  enabled                 = true
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_cloudwatch_metric_alarm" "compliance_exports_dlq_depth" {
  count = local.deploy_lambda_handlers ? 1 : 0

  alarm_name          = "thinkwork-${var.stage}-compliance-exports-dlq-depth"
  alarm_description   = "Compliance exports DLQ has messages — runner Lambda crashed (or is inert pre-U11.U3); operator must inspect."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = []

  dimensions = {
    QueueName = aws_sqs_queue.compliance_exports_dlq[0].name
  }
}
