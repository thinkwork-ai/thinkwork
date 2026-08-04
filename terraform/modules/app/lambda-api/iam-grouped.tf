################################################################################
# R9 (plan 2026-06-11-006 U6) — Grouped customer-managed policies for the
# shared api Lambda role (aws_iam_role.lambda).
#
# On 2026-06-11 the role's ~25 inline aws_iam_role_policy resources hit IAM's
# 10,240-byte aggregate hard cap for inline policies (#2378 failed the dev
# apply with LimitExceeded; #2379 is this consolidation). Every grant that was
# inline on this role — plus the one-off standalone managed policies that had
# accreted as cap workarounds — now lives in five grouped
# customer-managed policies:
#
#   thinkwork-<stage>-api-data-plane     — RDS Data API, Secrets Manager, S3,
#                                          DynamoDB, Cognito, SSM reads, KMS,
#                                          SQS (here for size balance, see
#                                          the locals note)
#   thinkwork-<stage>-api-orchestration  — Scheduler, Step Functions, SES
#   thinkwork-<stage>-api-invocation     — internal lambda:InvokeFunction
#   thinkwork-<stage>-api-ai             — Bedrock invoke,
#                                          AgentCore memory/eval/code-interp
#   thinkwork-<stage>-api-observability  — CloudWatch Logs reads, ECS/ALB
#                                          health reads
#
# STANDING RULE: new grants for aws_iam_role.lambda go into one of these five
# grouped policies — never a new inline aws_iam_role_policy and never a new
# standalone managed-policy attachment. (Managed-policy attachments have a
# default quota of 10 per role; the steady state here is
# AWSLambdaBasicExecutionRole + these five, plus the conditional AWS-managed
# VPC-access policy when OKF EFS wiring is enabled.)
#
# Each managed policy document caps at 6,144 characters (JSON minus
# whitespace) — check rendered size before adding large statements, and
# rebalance between groups if one approaches the cap.
#
# Statements below are byte-equivalent relocations of the originals; the
# WHY comments moved with them. Do not widen/narrow/dedupe when editing.
################################################################################

locals {
  # ---------------------------------------------------------------------------
  # Group 1: data plane — databases, secrets, object/parameter storage.
  # ---------------------------------------------------------------------------
  api_data_plane_statements = concat(
    [
      # (was inline policy "rds-data-api")
      {
        Effect = "Allow"
        Action = [
          "rds-data:ExecuteStatement",
          "rds-data:BatchExecuteStatement",
          "rds-data:BeginTransaction",
          "rds-data:CommitTransaction",
          "rds-data:RollbackTransaction",
        ]
        Resource = var.db_cluster_arn
      },
      # (was inline policy "secrets-manager")
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.graphql_db_secret_arn
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:CreateSecret",
          "secretsmanager:UpdateSecret",
          "secretsmanager:DeleteSecret",
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue"
        ]
        Resource = "arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:thinkwork/*"
      },
      # Plugin app-level OAuth activation tokens (plan 2026-06-12-001 U6):
      # thinkwork/{stage}/plugin-tokens/{userId}/{pluginInstallId}/{resourceKey}.
      # Already covered by the thinkwork/* wildcard above — named here
      # explicitly (additive, no behavior change) so the plugin-tokens
      # path survives any future narrowing of that wildcard. Create/Update
      # mint+refresh, Get resolves at dispatch, Delete is the real
      # deactivation/uninstall teardown (ForceDeleteWithoutRecovery).
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:CreateSecret",
          "secretsmanager:UpdateSecret",
          "secretsmanager:DeleteSecret",
          "secretsmanager:GetSecretValue"
        ]
        Resource = "arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:thinkwork/*/plugin-tokens/*"
      },
      # (was inline policy "s3-access" — the workspace bucket)
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ]
        Resource = [
          var.bucket_arn,
          "${var.bucket_arn}/*",
        ]
      },
      # Canonical ThinkWork Brain artifacts: durable source artifacts,
      # ingestion manifests, migration snapshots, vault projections, and
      # exports, and OKF Wiki Navigator bundles/current manifests.
      # Tenant-visible APIs redact object keys; Lambdas need object read/write
      # for replay and list access for migration enumeration.
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:PutObject",
          "s3:AbortMultipartUpload",
        ]
        Resource = "${aws_s3_bucket.brain_artifacts.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.brain_artifacts.arn
      },
      # THINK-193 U2 (Codex S2 + round-6 P1): bulk/prefix destruction of
      # evidence snapshots lives EXCLUSIVELY on the memory-retraction-drainer's
      # dedicated role (handlers.tf). The SHARED role gets only the narrow
      # erase-fence COMPENSATION capability: a stage worker that loses the
      # fence mid-PutObject must delete the EXACT object version it just
      # wrote (VersionId from its own PutObject response) and verify the key
      # is gone. Without ListBucketVersions-driven enumeration + bulk delete
      # this cannot destroy anything the caller did not itself write —
      # version ids are unguessable. ListBucketVersions is granted read-only
      # for the verification step, prefix-conditioned.
      {
        Effect   = "Allow"
        Action   = ["s3:DeleteObjectVersion"]
        Resource = "${aws_s3_bucket.brain_artifacts.arn}/evidence-snapshots/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucketVersions"]
        Resource = aws_s3_bucket.brain_artifacts.arn
        Condition = {
          StringLike = {
            "s3:prefix" = "evidence-snapshots/*"
          }
        }
      },
      # (was inline policy "cognito-access")
      {
        Effect = "Allow"
        Action = [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminInitiateAuth",
          "cognito-idp:AdminRespondToAuthChallenge",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:AdminUpdateUserAttributes",
          "cognito-idp:DescribeIdentityProvider",
          "cognito-idp:DescribeUserPoolClient",
          "cognito-idp:ListUsers",
        ]
        Resource = var.user_pool_arn
      },
      # (was inline policy "mcp-oauth-revocations" in mcp-oauth.tf)
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem"
        ]
        Resource = aws_dynamodb_table.mcp_oauth_revocations.arn
      },
      # (was inline policy "ssm-param-read")
      # graphql-http's sendMessage mutation reads SSM parameters like
      # /thinkwork/${stage}/chat-agent-invoke-fn-arn to discover the direct
      # Lambda targets for cross-function invocation. Without this, the SSM
      # GetParameter call fails with AccessDenied, the caller silently
      # catches the error, and sendMessage falls back to the wakeup-processor
      # path — which doesn't load messages_history from Aurora. That's why
      # multi-turn chat was losing prior context: history was only loaded on
      # the direct path, which never ran.
      #
      # This stage-wide grant also covers the customer-domain namespace
      # token at /thinkwork/${stage}/cloudflare-namespace-token (plan
      # 2026-06-12-002 U5/KTD7, declared in handlers.tf): tenant slug
      # validation reads it to run the read-only Cloudflare availability
      # check. A read failure there fails CLOSED (signup rejects with
      # SLUG_VALIDATION_UNAVAILABLE), so narrowing this wildcard later must
      # keep that path or tenant creation breaks.
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
        ]
        Resource = "arn:aws:ssm:${var.region}:${var.account_id}:parameter/thinkwork/${var.stage}/*"
      },
      # SecureString parameters (e.g. /thinkwork/<stage>/google-places/api-key)
      # are encrypted with the default AWS-managed SSM key. The default key's
      # resource policy auto-grants Decrypt to any IAM principal with
      # ssm:GetParameter on the parameter via `kms:ViaService = ssm.*`, so
      # this explicit grant is a belt-and-suspenders clarification. If we
      # later move to a customer-managed KMS key, this is the scope that
      # needs updating.
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.${var.region}.amazonaws.com"
          }
        }
      },
      # (was the SsmReadEvalRunnerCfg statement of inline policy
      # "eval-runner-bedrock-agentcore" — the rest lives in the ai and
      # observability groups)
      {
        Sid      = "SsmReadEvalRunnerCfg"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = "arn:aws:ssm:${var.region}:${var.account_id}:parameter/thinkwork/${var.stage}/agentcore/runtime-id-*"
      },
      # (was the RoutineTaskPythonS3Offload statement of inline policy
      # "routines-step-functions" — the SFN statements live in the
      # orchestration group)
      # routine-task-python S3 offload — full stdout/stderr land in
      # the per-stage routine-output bucket under
      # <tenantId>/<sfn-execution-id>/<nodeId>/{stdout,stderr}.log.
      # PutObject only — the read path is GraphQL-fronted and runs
      # under the graphql-http handler's role, not this one.
      {
        Sid    = "RoutineTaskPythonS3Offload"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
        ]
        Resource = "arn:aws:s3:::thinkwork-${var.stage}-routine-output/*"
      },
      # routine-exec-git SHA code cache (plan 2026-07-03-004 U3, KTD-7):
      # read-through cache under routine-code-cache/<tenant>/<routine>/<sha>/.
      # GetObject for cache reads; ListBucket so a cache miss surfaces as
      # NoSuchKey (404) instead of AccessDenied — without it the executor
      # cannot distinguish "not cached yet" from a real permission error
      # and the fixture gate fails closed (caught live in the U9 sweep).
      {
        Sid    = "RoutineExecGitCodeCacheRead"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
        ]
        Resource = "arn:aws:s3:::thinkwork-${var.stage}-routine-output/routine-code-cache/*"
      },
      {
        Sid      = "RoutineExecGitCodeCacheList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = "arn:aws:s3:::thinkwork-${var.stage}-routine-output"
        Condition = {
          StringLike = {
            "s3:prefix" = "routine-code-cache/*"
          }
        }
      },
      # (was standalone managed policy "lambda_model_catalog_import_read")
      # Settings -> Model Catalog imports call Bedrock's foundation-model
      # catalog and AWS Price List APIs from graphql-http. These read/list
      # APIs do not support useful resource scoping.
      {
        Effect = "Allow"
        Action = [
          "bedrock:ListFoundationModels",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "pricing:DescribeServices",
          "pricing:GetAttributeValues",
          "pricing:GetProducts",
        ]
        Resource = "*"
      },
      # THINK-245 U10 — cost-drift-check compares recorded per-model spend
      # against Cost Explorer. ce:GetCostAndUsage supports no resource-level
      # scoping (must be "*").
      {
        Effect   = "Allow"
        Action   = ["ce:GetCostAndUsage"]
        Resource = "*"
      },
    ],
    var.plugin_catalog_github_token_secret_arn != "" ? [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.plugin_catalog_github_token_secret_arn
      },
    ] : [],
    # (was standalone managed policy "lambda_deployment_evidence_read")
    # Access to the deployment evidence bucket: graphql-http's deployments
    # resolvers read deployment/status/current.json (deployed-release pointer
    # behind Settings > General and the sidebar release label) and session
    # evidence artifacts. Settings release-update remediation also writes a
    # backed-up runner, refreshed runner, and evidence JSON into this same
    # bucket after verifying the selected release metadata. Without the reads
    # the UI shows "unknown"; without PutObject the safe Settings runner
    # refresh path cannot replace the old manual AWS CLI step.
    var.deployment_evidence_bucket != "" ? [
      {
        Sid    = "DeploymentEvidenceBucket"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket",
          "s3:PutObject",
        ]
        Resource = [
          "arn:aws:s3:::${var.deployment_evidence_bucket}",
          "arn:aws:s3:::${var.deployment_evidence_bucket}/*",
        ]
      },
      {
        Sid      = "AgentCoreHarnessGatewayOauthSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = ["arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:bedrock-agentcore-identity!default/oauth2/thinkwork-${var.stage}-proof-oauth-*"]
      },
    ] : [],
    var.billing_export_bucket_name != "" ? [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket",
        ]
        Resource = [
          "arn:aws:s3:::${var.billing_export_bucket_name}",
          "arn:aws:s3:::${var.billing_export_bucket_name}/*",
        ]
      },
    ] : [],
    # (was inline policy "thinkwork-${stage}-lambda-workspace-events-sqs",
    # count-gated on the same flag)
    local.workspace_event_enabled ? [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility",
        ]
        Resource = concat(
          [for q in aws_sqs_queue.workspace_event : q.arn],
          [for q in aws_sqs_queue.workspace_event_dlq : q.arn],
        )
      },
    ] : [],
    # THINK-585 U6: the dispatcher's on-failure destination (Lambda sends
    # with the function's execution role) + the redrive consumer's ESM
    # polling, both on the agentcore-dispatch DLQ.
    local.deploy_lambda_handlers ? [
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility",
        ]
        Resource = [for q in aws_sqs_queue.agentcore_dispatch_dlq : q.arn]
      },
    ] : [],
    var.brain_artifacts_kms_key_arn != "" ? [
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey",
        ]
        Resource = var.brain_artifacts_kms_key_arn
        Condition = {
          StringEquals = {
            "kms:ViaService" = "s3.${var.region}.amazonaws.com"
          }
        }
      },
    ] : [],
    # THINK-280 — the headless capability executor (routine-exec-git) mints and
    # advances the broker PoP session by conditional reads/writes on the broker's
    # DynamoDB session table. Empty (→ no grant) when the broker is disabled.
    var.capability_broker_session_table_arn != "" ? [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
        ]
        Resource = var.capability_broker_session_table_arn
      },
    ] : [],
  )

  # ---------------------------------------------------------------------------
  # Group 2: orchestration — cross-function invokes, Scheduler, Step
  # Functions, SQS, SES.
  # ---------------------------------------------------------------------------
  api_orchestration_candidate_statements = concat(
    [
      # (was inline policy "ses-send")
      # SES send permissions for the email-send handler. Scoped to any
      # verified identity in this account+region so the email-send Lambda
      # can SendRawEmail from agents.thinkwork.ai (and any other domain
      # identity a future deployment might add).
      {
        Effect = "Allow"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail",
        ]
        Resource = [
          "arn:aws:ses:${var.region}:${var.account_id}:identity/*",
          "arn:aws:ses:${var.region}:${var.account_id}:configuration-set/*",
        ]
      },
      # (was inline policy "eventbridge-scheduler-rw")
      # job-schedule-manager creates/updates/deletes EventBridge Scheduler
      # schedules (and the thinkwork-jobs schedule group on first use). Without
      # these permissions the manager Lambda threw silently and every scheduled
      # automation was orphaned with eb_schedule_name = null.
      {
        Effect = "Allow"
        Action = [
          "scheduler:CreateSchedule",
          "scheduler:UpdateSchedule",
          "scheduler:DeleteSchedule",
          "scheduler:GetSchedule",
          "scheduler:ListSchedules",
          "scheduler:CreateScheduleGroup",
          "scheduler:GetScheduleGroup",
          "scheduler:DeleteScheduleGroup",
          "scheduler:TagResource",
        ]
        Resource = "*"
      },
      # Scheduler.CreateSchedule takes a RoleArn for the target; AWS requires
      # the caller to have iam:PassRole on that role. Without this the
      # CreateSchedule call fails with AccessDenied even if the scheduler
      # permissions above are set.
      {
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = var.job_scheduler_role_arn != "" ? var.job_scheduler_role_arn : "*"
      },
      # (was inline policy "api-cross-function-invoke")
      # Allow API handler Lambdas to invoke each other directly. sendMessage
      # dispatches to chat-agent-invoke for instant chat response; the memory
      # resolvers reach job-schedule-manager for
      # admin-driven operations. The agentcore-invoke statement below covers
      # the Pi runtime Lambda only — this one covers internal api-to-api
      # calls. ARNs are constructed deterministically from the handler naming
      # pattern so we don't create a dependency cycle with the handler
      # resource.
      {
        Sid    = "ApiCrossFunctionInvoke"
        Effect = "Allow"
        Action = ["lambda:InvokeFunction"]
        Resource = [
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-chat-agent-invoke",
          # THINK-583 U3: invokers address the `live` alias (provisioned
          # concurrency only serves alias-qualified invokes); the alias ARN
          # is a distinct IAM resource from the unqualified function ARN.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-chat-agent-invoke:live",
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-job-schedule-manager",
          # eval-runner: graphql-http's startEvalRun mutation Event-invokes
          # this asynchronously after inserting the eval_runs row.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-eval-runner",
          # identity-graph-projector (Company Brain U5): identity mutations
          # Event-invoke this as a post-commit nudge; the rebuild command is
          # a RequestResponse invoke. Cursor makes missed nudges harmless.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-identity-graph-projector",
          # harness-runner: chat-agent-invoke Event-invokes this for chat
          # turns routed to the AWS AgentCore runtime (THINK-311 trial).
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-harness-runner",
          # harness-runner queues the same canonical post-turn memory pipeline
          # as Pi after a completed AgentCore turn. The retain ledger makes the
          # Event invoke idempotent on the thread-turn source key.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-memory-retain",
          # harness-runner RequestResponse-invokes this dedicated signer. The
          # signer re-derives the actor/tenant/thread tuple from the running
          # turn and alone holds KMS Sign; the shared runner role never does.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-turn-assertion-mint",
          # identity-match (THINK-321 U7): startIdentityMatchJob Event-invokes
          # this after inserting a durable match job row; identity-match also
          # self-invokes for the continuation chain (same shared role).
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-identity-match",
          # routine-resume: routine-approval-bridge (Phase B U8) invokes
          # this with RequestResponse after a HITL decideInboxItem
          # decision. Calls SendTaskSuccess/SendTaskFailure on the SFN
          # task token; idempotent on already-consumed tokens.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-routine-resume",
          # workspace-files-efs: workspace-files invokes this (RequestResponse)
          # for Computer-target list/get to bypass the computer_tasks queue
          # and read EFS directly. Standalone resource below.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-workspace-files-efs",
          # workspace-renderer: chat-agent-invoke invokes this synchronously
          # before AgentCore so Pi can opt into the rendered
          # per-(agent, Space, user) workspace prefix. THINK-583 U3: the
          # `:live` alias ARN is covered by the dedicated workspace-renderer
          # statement below (`...workspace-renderer:*`).
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-workspace-renderer",
          # skill-trust-runner: graphql-http's publishSkillDraft mutation
          # invokes this with RequestResponse so SkillSpector completion is a
          # server-side publish gate, not just an operator UI affordance.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-skill-trust-runner",
          # routine-exec-git (plan 2026-07-03-004 U5/U6): job-trigger
          # RequestResponse-invokes it for Automation routine actions, and
          # admin-ops-mcp invokes it for agent fixture runs + the
          # synchronous repair gate. Caught live in the U9 sweep.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-routine-exec-git",
          # artifact-deliver (THINK-227 U5): workflow-step-dispatch's deliver
          # step RequestResponse-invokes its workflow-delivery mode to email
          # the maintained report to the operator-configured recipient list.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-artifact-deliver",
          # memory-stage-worker (external-memory-compounding U1):
          # workflow-step-dispatch's memory_stage step Event-invokes it after
          # parking on the task token; the worker resumes the token via
          # SendTaskSuccess when the pipeline stage ends.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-memory-stage-worker",
          # job-trigger self-target (plan 2026-07-03-004 U5, KTD-3): the
          # manual GraphQL trigger Event-invokes job-trigger with the
          # agent_loop_continue_dispatch event so routine actions never run
          # inline in graphql-http.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-job-trigger",
          # canvas-refresh (Living Artifacts THINK-145 U6/U7): graphql-http's
          # refreshCanvasData mutation RequestResponse-invokes it (user + agent
          # triggers), and job-trigger's canvas_refresh branch RequestResponse-
          # invokes it (scheduled trigger). Both run on this shared role.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-canvas-refresh",
          # agentcore-admin (THINK-280): graphql-http's createTenant
          # RequestResponse-invokes it to provision per-tenant sandbox
          # resources; routine-exec-git (same shared role) reaches it for the
          # capability-private provisioning path. Deployed by the dedicated
          # agentcore-admin module with its own least-privilege role.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-agentcore-admin",
        ]
      },
      # (was standalone managed policy "workspace_renderer_invoke")
      # Allow API Lambdas to invoke the workspace renderer.
      {
        Effect = "Allow"
        Action = ["lambda:InvokeFunction"]
        Resource = [
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-workspace-renderer",
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-workspace-renderer:*",
          # THINK-585 U6: chat-agent-invoke Event-invokes the runtime
          # dispatcher at the flag-on dispatch seam.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-agentcore-runtime-dispatch",
        ]
      },
      # (was standalone managed policy "thread_idle_memory_learning_invoke")
      # Allow API job-trigger Lambda to invoke requester idle memory learning
      # worker (thinkwork-${var.stage}-thread-idle-memory-learning-invoke).
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-thread-idle-memory-learning"
      },
      # (was inline policy "routines-step-functions"; its code-interpreter
      # statement lives in the ai group and its S3-offload statement in the
      # data-plane group)
      # Step Functions admin operations — for createRoutine /
      # publishRoutineVersion / triggerRoutineRun / updateRoutine resolvers
      # (Phase B U7) and the routine-asl-validator Lambda (Phase A U5).
      # State-machine ARNs follow the naming convention
      # `thinkwork-${stage}-routine-*`; aliases follow the state-machine ARN
      # with a colon-separated alias name.
      {
        Sid    = "RoutineStateMachineLifecycle"
        Effect = "Allow"
        Action = [
          "states:CreateStateMachine",
          "states:UpdateStateMachine",
          "states:DeleteStateMachine",
          "states:DescribeStateMachine",
          "states:ListStateMachines",
          "states:TagResource",
          "states:UntagResource",
          "states:PublishStateMachineVersion",
          "states:DeleteStateMachineVersion",
          "states:ListStateMachineVersions",
          "states:CreateStateMachineAlias",
          "states:UpdateStateMachineAlias",
          "states:DeleteStateMachineAlias",
          "states:DescribeStateMachineAlias",
          "states:ListStateMachineAliases",
          "states:DescribeStateMachineForExecution",
        ]
        Resource = "arn:aws:states:${var.region}:${var.account_id}:stateMachine:thinkwork-${var.stage}-routine-*"
      },
      {
        Sid    = "RoutineExecution"
        Effect = "Allow"
        Action = [
          "states:StartExecution",
          "states:StartSyncExecution",
          "states:StopExecution",
          "states:DescribeExecution",
          "states:ListExecutions",
          "states:GetExecutionHistory",
        ]
        Resource = [
          "arn:aws:states:${var.region}:${var.account_id}:stateMachine:thinkwork-${var.stage}-routine-*",
          "arn:aws:states:${var.region}:${var.account_id}:execution:thinkwork-${var.stage}-routine-*:*",
        ]
      },
      {
        Sid    = "RoutineTaskTokens"
        Effect = "Allow"
        Action = [
          "states:SendTaskSuccess",
          "states:SendTaskFailure",
          "states:SendTaskHeartbeat",
        ]
        Resource = "*"
      },
      {
        Sid      = "RoutineValidate"
        Effect   = "Allow"
        Action   = ["states:ValidateStateMachineDefinition"]
        Resource = "*"
      },
      {
        # PassRole so the createRoutine resolver can hand the routines
        # execution role to a newly-created state machine. Scoped to the
        # specific role created by the routines-stepfunctions module.
        Sid      = "RoutinePassExecutionRole"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = "arn:aws:iam::${var.account_id}:role/thinkwork-${var.stage}-routines-execution-role"
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "states.amazonaws.com"
          }
        }
      },
      # Workflow Interpreter (THINK-219): job-trigger (workflow_schedule
      # branch) and graphql-http (manual triggerWorkflowRun / resolveWorkflow
      # Approval) both run under this shared role and StartExecution the ONE
      # static interpreter machine per stage. Name is fixed
      # (`thinkwork-${stage}-workflow-interpreter`); the machine ARN itself is
      # resolved from SSM at runtime (already readable via the stage-wide
      # ssm:GetParameter grant in api_data_plane). SendTaskSuccess/Failure for
      # workflow-resume rides the wildcard RoutineTaskTokens statement above.
      {
        Sid    = "WorkflowInterpreterExecution"
        Effect = "Allow"
        Action = [
          "states:StartExecution",
          "states:StopExecution",
          "states:DescribeExecution",
          "states:ListExecutions",
          "states:GetExecutionHistory",
        ]
        Resource = [
          "arn:aws:states:${var.region}:${var.account_id}:stateMachine:thinkwork-${var.stage}-workflow-interpreter",
          "arn:aws:states:${var.region}:${var.account_id}:execution:thinkwork-${var.stage}-workflow-interpreter:*",
        ]
      },
      # (was standalone managed policy "lambda_deployment_stepfunctions")
      # Allow API Lambdas to start and inspect the deployment orchestrator.
      {
        Sid    = "DeploymentExecution"
        Effect = "Allow"
        Action = [
          "states:StartExecution",
          "states:StopExecution",
          "states:DescribeExecution",
          "states:GetExecutionHistory",
        ]
        Resource = [
          "arn:aws:states:${var.region}:${var.account_id}:stateMachine:thinkwork-${var.stage}-deployment-*",
          "arn:aws:states:${var.region}:${var.account_id}:execution:thinkwork-${var.stage}-deployment-*:*",
        ]
      },
      # Settings release-update preflight inspects the frozen customer
      # control-plane runner and detects known live IAM drift before dispatch.
      # This is read-only by design: v1 blocks on IAM gaps and requires a
      # reviewed infrastructure change rather than mutating the runner role
      # from GraphQL.
      {
        Sid    = "DeploymentPreflightRead"
        Effect = "Allow"
        Action = [
          "codebuild:BatchGetProjects",
          "iam:GetPolicy",
          "iam:GetPolicyVersion",
          "iam:GetRolePolicy",
          "iam:ListAttachedRolePolicies",
          "iam:ListRolePolicies",
        ]
        Resource = [
          "arn:aws:codebuild:${var.region}:${var.account_id}:project/thinkwork-${var.stage}-deployment-*",
          "arn:aws:iam::${var.account_id}:role/thinkwork-${var.stage}-deployment-*",
          "arn:aws:iam::${var.account_id}:policy/thinkwork-${var.stage}-deployment-*",
        ]
      },
    ],
    # (was inline policy "agentcore-invoke", count-gated on the same flag)
    # Allow API Lambdas to directly invoke the Pi AgentCore Lambda. Used by
    # chat-agent-invoke, wake-up, retry, and skill-run paths via InvokeCommand.
    var.enable_agentcore_pi_invoke_policy ? [
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction",
        ]
        Resource = compact([
          var.agentcore_pi_function_arn,
          var.agentcore_pi_function_arn != "" ? "${var.agentcore_pi_function_arn}:*" : "",
        ])
      },
    ] : [],
  )

  # Internal Lambda invocation is intentionally partitioned from the remaining
  # orchestration grants. The generated resource list grows with API features
  # and can otherwise push the shared orchestration managed policy beyond
  # IAM's hard 6,144-character document limit. Both partitions remain attached
  # to the same shared Lambda role and are covered by the size assertion below.
  api_orchestration_statements = [
    for statement in local.api_orchestration_candidate_statements : statement
    if !contains(try(statement.Action, []), "lambda:InvokeFunction")
  ]
  api_invocation_statements = [
    for statement in local.api_orchestration_candidate_statements : statement
    if contains(try(statement.Action, []), "lambda:InvokeFunction")
  ]

  # ---------------------------------------------------------------------------
  # Group 3: AI — Bedrock model invocation, AgentCore
  # memory / evaluations / code interpreter.
  # ---------------------------------------------------------------------------
  api_ai_statements = concat([
    # Signed-turn identity (THINK-324 C18): dispatch Lambdas mint with
    # kms:Sign; verifiers fetch the public key once per container with
    # kms:GetPublicKey. Scoped to the turn-assertion keys only; the role is
    # shared, so which handler may mint is code-enforced.
    {
      Sid      = "TurnAssertionSigning"
      Effect   = "Allow"
      Action   = ["kms:Sign", "kms:GetPublicKey"]
      Resource = local.turn_assertion_key_arns
    },
    # (was inline policy "bedrock-invoke")
    # Cross-region inference profiles (us.anthropic.claude-*) require
    # `bedrock:InvokeModel` on the *inference-profile* ARN AND on the
    # underlying foundation-model ARN in *every* region the profile can
    # route to (e.g. us-east-2 for us.anthropic.claude-haiku-4-5). The
    # region wildcard below covers all of them. Needed by the eval-runner
    # llm-rubric judge and any handler that calls Converse with a profile ID.
    {
      Effect = "Allow"
      Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
      Resource = [
        "arn:aws:bedrock:*::foundation-model/*",
        "arn:aws:bedrock:*:${var.account_id}:inference-profile/*",
      ]
    },
    # (was inline policy "agentcore-memory-rw")
    # AgentCore Memory access for the GraphQL memory resolvers and the
    # memory-retain handler. memoryRecords / memorySearch call
    # ListMemoryRecordsCommand to fetch records across the tenant's agents;
    # memory-retain calls CreateEventCommand to land the turn in the managed
    # memory (before the agentcore engine flip that write went to Hindsight
    # over HTTP, so no IAM action existed for it).
    {
      Effect = "Allow"
      Action = [
        "bedrock-agentcore:CreateEvent",
        "bedrock-agentcore:ListMemoryRecords",
        "bedrock-agentcore:RetrieveMemoryRecords",
        "bedrock-agentcore:GetMemoryRecord",
        "bedrock-agentcore:BatchCreateMemoryRecords",
        "bedrock-agentcore:BatchUpdateMemoryRecords",
        "bedrock-agentcore:BatchDeleteMemoryRecords",
        "bedrock-agentcore:DeleteMemoryRecord",
      ]
      Resource = "*"
    },
    # (were the AgentCore statements of inline policy
    # "eval-runner-bedrock-agentcore"; the spans-read statement lives in
    # the observability group and the SSM read in the data-plane group)
    # Eval-runner: invoke the AgentCore Runtime data plane to run an agent
    # under test, and call AgentCore Evaluations.Evaluate to score the
    # resulting spans. Both APIs are on the bedrock-agentcore service.
    {
      Sid      = "AgentCoreInvokeRuntime"
      Effect   = "Allow"
      Action   = ["bedrock-agentcore:InvokeAgentRuntime"]
      Resource = "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:runtime/*"
    },
    {
      Sid    = "AgentCoreEvaluate"
      Effect = "Allow"
      Action = [
        "bedrock-agentcore:Evaluate",
        "bedrock-agentcore:GetEvaluator",
        "bedrock-agentcore:ListEvaluators",
      ]
      Resource = "*"
    },
    # (was the RoutineTaskPythonCodeInterpreter statement of inline policy
    # "routines-step-functions")
    # routine-task-python (Phase B U6) wraps the AgentCore code
    # interpreter so SFN can run `python` recipe states. Three calls
    # per Task: Start session, Invoke, Stop. Resource is `*` because
    # interpreter sessions are runtime-scoped, not provisioned.
    {
      Sid    = "RoutineTaskPythonCodeInterpreter"
      Effect = "Allow"
      Action = [
        "bedrock-agentcore:StartCodeInterpreterSession",
        "bedrock-agentcore:InvokeCodeInterpreter",
        "bedrock-agentcore:StopCodeInterpreterSession",
        "bedrock-agentcore:GetCodeInterpreterSession",
      ]
      Resource = "*"
    },
    ],
    # THINK-324 — the managed-harness invoke grant is retired. The AgentCore
    # Identity chain below survives UNCONDITIONALLY: the live Twenty
    # connector's per-user 3LO (handlers/skills.ts via
    # lib/agentcore-identity/agentcore-user-oauth.ts) mints workload tokens
    # against the shared workload identity and reads the twenty-crm
    # credential provider from the token vault.
    [
      {
        Sid    = "AgentCoreTwentyIdentity"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
          "bedrock-agentcore:GetWorkloadAccessTokenForUserId",
          "bedrock-agentcore:GetResourceOauth2Token",
          "bedrock-agentcore:CompleteResourceTokenAuth",
        ]
        Resource = [
          "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:workload-identity-directory/default",
          "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:workload-identity-directory/default/workload-identity/thinkwork-${var.stage}-multiplayer-proof",
          "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:token-vault/default",
          "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:token-vault/default/oauth2credentialprovider/thinkwork-${var.stage}-twenty-crm",
        ]
      },
    ],
  )

  # ---------------------------------------------------------------------------
  # Group 4: observability — CloudWatch Logs reads, ECS/ALB health reads.
  # ---------------------------------------------------------------------------
  # Handler-gated SQS grants live HERE rather than in the data-plane group:
  # data-plane sits near IAM's 6,144-char rendered cap. Queue plumbing is
  # operational surface; observability has ~5k headroom.
  api_observability_sqs_statements = concat(
    # SQS grants live here rather than in the orchestration group purely for
    # size balance: with every conditional on, orchestration's rendered JSON
    # would exceed IAM's 6,144-char per-managed-policy cap (R9 rebalance).
    # Handler-gated SQS grants. Each statement was a count-gated inline
    # policy whose queue exists only when local.deploy_lambda_handlers.
    local.deploy_lambda_handlers ? [
      # THINK-321 U7 identity-match async-failure DLQ.
      {
        Sid      = "IdentityMatchDlqSend"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.identity_match_dlq[0].arn
      },
      # (was inline policy "compliance-drainer-dlq-send")
      {
        Sid      = "ComplianceDrainerDlqSend"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.compliance_drainer_dlq[0].arn
      },
      # (was inline policy "compliance-exports-send")
      # graphql-http needs sqs:SendMessage on the exports queue to dispatch
      # jobIds from the createComplianceExport mutation. Attached to the
      # shared lambda role (which graphql-http assumes); scope is
      # queue-specific. (The runner's receive grants stay on the dedicated
      # runner role — see compliance_exports_runner_sqs in handlers.tf.)
      {
        Sid      = "ComplianceExportsSend"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.compliance_exports[0].arn
      },
      # (was inline policy "eval-fanout-send")
      {
        Sid    = "EvalRunnerSendFanoutMessages"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:SendMessageBatch",
        ]
        Resource = aws_sqs_queue.eval_fanout[0].arn
      },
      # (was inline policy "eval-worker-sqs")
      {
        Sid    = "EvalWorkerReceiveFanoutMessages"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility",
        ]
        Resource = aws_sqs_queue.eval_fanout[0].arn
      },
      {
        Sid      = "EvalWorkerSendDlqMessages"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.eval_fanout_dlq[0].arn
      },
    ] : [],
    # Company Brain twin (plan 2026-07-21-001 U5): Neptune data access for
    # the identity-graph-projector (and the wiki-compile soft-layer writer)
    # on the SHARED role. The twin-query read Lambda and its dedicated
    # read-only role retired to the platform service (THINK-339 U15) — no
    # caller-supplied query path remains product-side.
    # Lives in the ai envelope for size balance (data-plane sits ~430 chars
    # under IAM's 6,144 cap). Grouped — not inline — so the no-terraform
    # targeted deploy path (which applies exactly these grouped policies)
    # self-heals the grant; the original inline resource never survived a
    # superseded full apply. Data actions are condition-pinned to openCypher,
    # mirroring the etl-side policies.
    # (Two segments, not one: the data statement carries a Condition the
    # status statement can't — mixed shapes in one conditional tuple fail
    # Terraform's type unification.)
    var.neptune_cluster_resource_id == "" ? [] : [
      {
        Sid    = "TwinNeptuneData"
        Effect = "Allow"
        Action = [
          "neptune-db:ReadDataViaQuery",
          "neptune-db:WriteDataViaQuery",
          "neptune-db:DeleteDataViaQuery",
        ]
        Resource = "arn:aws:neptune-db:${var.region}:${var.account_id}:${var.neptune_cluster_resource_id}/*"
        Condition = {
          StringEquals = { "neptune-db:QueryLanguage" = "OpenCypher" }
        }
      },
    ],
    var.neptune_cluster_resource_id == "" ? [] : [
      {
        Sid      = "TwinEngineStatus"
        Effect   = "Allow"
        Action   = ["neptune-db:GetEngineStatus", "neptune-db:GetGraphSummary"]
        Resource = "arn:aws:neptune-db:${var.region}:${var.account_id}:${var.neptune_cluster_resource_id}/*"
      },
    ],
    # Bulk-rebuild lane (THINK-331 U4): the projector stages openCypher CSVs
    # under the tenant-scoped thinkwork-identity/ prefix of the etl-platform
    # load bucket (Put for upload, Delete for the terminal-state cleanup)
    # and drives the loader job API. The CSVs are streamed as S3 multipart
    # uploads for large tenants (THINK-409): CreateMultipartUpload /
    # UploadPart / CompleteMultipartUpload all authorize as s3:PutObject, and
    # the failure path's AbortMultipartUpload is the action below — no
    # s3:ListMultipartUploadParts needed, the stager tracks its own parts
    # (this policy is near IAM's 6,144-char cap; see below). A NEW statement
    # group — the existing
    # TwinNeptuneData statement is condition-pinned to QueryLanguage=
    # OpenCypher, which the loader actions don't satisfy. Gated on the
    # bulk-loader variables so stages without the twin stack ship inert
    # (KTD-9). No iam:PassRole needed: the loader role is assumed by the
    # Neptune service via its cluster association, not passed by this role.
    var.neptune_load_bucket == "" || var.neptune_loader_role_arn == "" || var.neptune_cluster_resource_id == "" ? [] : [
      {
        Sid      = "TwinBulkLoaderStage"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:AbortMultipartUpload", "s3:DeleteObject"]
        Resource = "arn:aws:s3:::${var.neptune_load_bucket}/thinkwork-identity/*"
      },
      {
        Sid      = "TwinBulkLoaderJobs"
        Effect   = "Allow"
        Action   = ["neptune-db:StartLoaderJob", "neptune-db:GetLoaderJobStatus", "neptune-db:CancelLoaderJob"]
        Resource = "arn:aws:neptune-db:${var.region}:${var.account_id}:${var.neptune_cluster_resource_id}/*"
      },
    ],
  )

  api_observability_statements = concat(local.api_observability_sqs_statements, [
    # Backend notification publishing is IAM-only. Scope the shared API
    # execution role to the NONE-resolver mutation fields; end-user identity-
    # pool credentials have no AppSync grant. This statement lives in the
    # observability envelope for size balance: adding subscription invalidation
    # pushed the data-plane policy over IAM's 6,144-character hard cap.
    {
      Sid    = "PublishAppSyncNotifications"
      Effect = "Allow"
      Action = ["appsync:GraphQL"]
      Resource = [
        for field in [
          "notifyAgentStatus",
          "notifyNewMessage",
          "notifyHeartbeatActivity",
          "notifyThreadActivity",
          "notifyThreadUpdate",
          "notifyInboxItemUpdate",
          "notifyThreadTurnUpdate",
          "notifyThreadTurnStep",
          "notifyOrgUpdate",
          "notifyCostRecorded",
          "notifyEvalRunUpdate",
          "notifyWorkspaceAccessRevoked",
          "invalidateSubscription",
        ] : "arn:aws:appsync:${var.region}:${var.account_id}:apis/${var.appsync_api_id}/types/Mutation/fields/${field}"
      ]
    },
    # (was inline policy "cloudwatch-logs-read")
    {
      Effect = "Allow"
      Action = ["logs:FilterLogEvents", "logs:GetLogEvents", "logs:DescribeLogGroups"]
      Resource = [
        local.bedrock_invocation_log_group_arn,
        "${local.bedrock_invocation_log_group_arn}:*",
      ]
    },
    # (was the EvalSpansRead statement of inline policy
    # "eval-runner-bedrock-agentcore")
    # Eval-runner reads spans + log events from CloudWatch Logs (aws/spans is
    # the Transaction Search destination; runtime log groups carry the OTel
    # records that EvaluateCommand requires alongside the spans).
    {
      Sid    = "EvalSpansRead"
      Effect = "Allow"
      Action = [
        "logs:FilterLogEvents",
        "logs:GetLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
      ]
      Resource = [
        "arn:aws:logs:${var.region}:${var.account_id}:log-group:aws/spans",
        "arn:aws:logs:${var.region}:${var.account_id}:log-group:aws/spans:*",
        "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*",
        "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*:*",
      ]
    },
    # Managed-application and runtime health checks read ECS service
    # steadiness and ALB target health. ELBv2 Describe* actions do not
    # support useful resource scoping.
    {
      Effect = "Allow"
      Action = [
        "ecs:DescribeServices",
        "elasticloadbalancing:DescribeTargetGroups",
        "elasticloadbalancing:DescribeTargetHealth",
      ]
      Resource = "*"
    },
  ])

  api_grouped_policy_documents = {
    data_plane = jsonencode({
      Version   = "2012-10-17"
      Statement = local.api_data_plane_statements
    })
    orchestration = jsonencode({
      Version   = "2012-10-17"
      Statement = local.api_orchestration_statements
    })
    invocation = jsonencode({
      Version   = "2012-10-17"
      Statement = local.api_invocation_statements
    })
    ai = jsonencode({
      Version   = "2012-10-17"
      Statement = local.api_ai_statements
    })
    observability = jsonencode({
      Version   = "2012-10-17"
      Statement = local.api_observability_statements
    })
  }
}

check "api_grouped_managed_policy_sizes" {
  assert {
    condition = alltrue([
      for document in values(local.api_grouped_policy_documents) : length(document) <= 6144
    ])
    error_message = "Each grouped API managed-policy document must remain within AWS IAM's 6,144-character limit."
  }
}

resource "aws_iam_policy" "api_data_plane" {
  name        = "thinkwork-${var.stage}-api-data-plane"
  description = "Grouped data-plane grants (RDS Data API, Secrets Manager, S3, DynamoDB, Cognito, SSM, KMS-via-SSM, SQS) for the shared api Lambda role"

  policy = local.api_grouped_policy_documents.data_plane

  lifecycle {
    precondition {
      condition     = length(local.api_grouped_policy_documents.data_plane) <= 6144
      error_message = "The grouped API data-plane managed-policy document exceeds AWS IAM's 6,144-character limit."
    }
  }
}

resource "aws_iam_role_policy_attachment" "api_data_plane" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.api_data_plane.arn
}

resource "aws_iam_policy" "api_orchestration" {
  name        = "thinkwork-${var.stage}-api-orchestration"
  description = "Grouped orchestration grants (EventBridge Scheduler, Step Functions, SES) for the shared api Lambda role"

  policy = local.api_grouped_policy_documents.orchestration

  # Attach the replacement invoke grant before removing it from this policy.
  # This preserves Lambda-to-Lambda access if an apply stops between updates.
  depends_on = [aws_iam_role_policy_attachment.api_invocation]

  lifecycle {
    # Existing environments may retain the historical description that also
    # mentioned Lambda invocation. Description changes replace IAM managed
    # policies, which would destroy the old orchestration grant before the new
    # invocation attachment is ready. Keep the policy identity stable so the
    # depends_on edge above orders an in-place document update after attach.
    ignore_changes = [description]

    precondition {
      condition     = length(local.api_grouped_policy_documents.orchestration) <= 6144
      error_message = "The grouped API orchestration managed-policy document exceeds AWS IAM's 6,144-character limit."
    }
  }
}

resource "aws_iam_role_policy_attachment" "api_orchestration" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.api_orchestration.arn
}

resource "aws_iam_policy" "api_invocation" {
  name        = "thinkwork-${var.stage}-api-invocation"
  description = "Internal Lambda invocation grants for the shared api Lambda role"

  policy = local.api_grouped_policy_documents.invocation

  lifecycle {
    precondition {
      condition     = length(local.api_grouped_policy_documents.invocation) <= 6144
      error_message = "The grouped API invocation managed-policy document exceeds AWS IAM's 6,144-character limit."
    }
  }
}

resource "aws_iam_role_policy_attachment" "api_invocation" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.api_invocation.arn
}

resource "aws_iam_policy" "api_ai" {
  name        = "thinkwork-${var.stage}-api-ai"
  description = "Grouped AI grants (Bedrock invoke, AgentCore memory/eval/code-interpreter) for the shared api Lambda role"

  policy = local.api_grouped_policy_documents.ai

  lifecycle {
    precondition {
      condition     = length(local.api_grouped_policy_documents.ai) <= 6144
      error_message = "The grouped API AI managed-policy document exceeds AWS IAM's 6,144-character limit."
    }
  }
}

resource "aws_iam_role_policy_attachment" "api_ai" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.api_ai.arn
}

resource "aws_iam_policy" "api_observability" {
  name        = "thinkwork-${var.stage}-api-observability"
  description = "Grouped observability grants (CloudWatch Logs reads, ECS/ALB health reads) for the shared api Lambda role"

  policy = local.api_grouped_policy_documents.observability

  lifecycle {
    precondition {
      condition     = length(local.api_grouped_policy_documents.observability) <= 6144
      error_message = "The grouped API observability managed-policy document exceeds AWS IAM's 6,144-character limit."
    }
  }
}

resource "aws_iam_role_policy_attachment" "api_observability" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.api_observability.arn
}

# ----------------------------------------------------------------------------
# Quota-safe cutover from the absorbed standalone managed policies.
#
# The role had up to 9 managed-policy attachments before this consolidation;
# IAM's default quota is 10 per role. Naively, terraform could create the 4
# grouped attachments before destroying the 7 absorbed ones (creates and
# destroys of unrelated resources have no ordering), transiently hitting 13
# and failing the apply with LimitExceeded — in a customer account, that is
# exactly the #2375-class deploy failure this plan exists to retire.
#
# These moved blocks alias 4 of the absorbed attachment addresses to the 4
# grouped attachments. Changing policy_arn forces a same-address REPLACEMENT,
# and attachments replace destroy-before-create, so each swap is
# count-neutral; the remaining absorbed attachments are pure destroys. The
# attachment count therefore never exceeds its pre-apply value.
# ----------------------------------------------------------------------------

moved {
  from = aws_iam_role_policy_attachment.lambda_model_catalog_import_read
  to   = aws_iam_role_policy_attachment.api_data_plane
}

moved {
  from = aws_iam_role_policy_attachment.lambda_thread_idle_memory_learning_invoke
  to   = aws_iam_role_policy_attachment.api_orchestration
}

moved {
  from = aws_iam_role_policy_attachment.lambda_bedrock_knowledge_base
  to   = aws_iam_role_policy_attachment.api_ai
}


