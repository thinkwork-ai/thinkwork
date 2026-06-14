################################################################################
# R9 (plan 2026-06-11-006 U6) — Grouped customer-managed policies for the
# shared api Lambda role (aws_iam_role.lambda).
#
# On 2026-06-11 the role's ~25 inline aws_iam_role_policy resources hit IAM's
# 10,240-byte aggregate hard cap for inline policies (#2378 failed the dev
# apply with LimitExceeded; #2379 is this consolidation). Every grant that was
# inline on this role — plus the one-off standalone managed policies that had
# accreted as cap workarounds — now lives in exactly four grouped
# customer-managed policies:
#
#   thinkwork-<stage>-api-data-plane     — RDS Data API, Secrets Manager, S3,
#                                          DynamoDB, Cognito, SSM reads, KMS,
#                                          SQS (here for size balance, see
#                                          the locals note)
#   thinkwork-<stage>-api-orchestration  — lambda:InvokeFunction, Scheduler,
#                                          Step Functions, SES
#   thinkwork-<stage>-api-ai             — Bedrock invoke, Knowledge Bases,
#                                          AgentCore memory/eval/code-interp
#   thinkwork-<stage>-api-observability  — CloudWatch Logs reads, ECS/ALB
#                                          health reads
#
# STANDING RULE: new grants for aws_iam_role.lambda go into one of these four
# grouped policies — never a new inline aws_iam_role_policy and never a new
# standalone managed-policy attachment. (Managed-policy attachments have a
# default quota of 10 per role; the steady state here is
# AWSLambdaBasicExecutionRole + these four, plus the conditional AWS-managed
# VPC-access policy when Cognee workers are enabled.)
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
          "secretsmanager:GetSecretValue"
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
      # (was inline policy "wiki-exports-s3" in handlers.tf) — wiki-export
      # writes markdown vault bundles to the per-stage wiki-exports bucket.
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:AbortMultipartUpload"]
        Resource = "${aws_s3_bucket.wiki_exports.arn}/*"
      },
      # Canonical Company Brain artifacts: durable source artifacts,
      # ingestion manifests, migration snapshots, vault projections, and
      # exports. Tenant-visible APIs redact object keys; Lambdas need object
      # read/write for replay and list access for migration enumeration.
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
      # (was inline policy "cognito-access")
      {
        Effect = "Allow"
        Action = [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminUpdateUserAttributes",
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
    ],
    # (was standalone managed policy "lambda_deployment_evidence_read")
    # Read-only access to the deployment evidence bucket: graphql-http's
    # deployments resolvers read deployment/status/current.json (deployed-
    # release pointer behind Settings > General and the sidebar release
    # label) and session evidence artifacts. Without this the S3 read fails
    # with a 403 that is indistinguishable from "no pointer yet" and the UI
    # shows "unknown".
    var.deployment_evidence_bucket != "" ? [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket",
        ]
        Resource = [
          "arn:aws:s3:::${var.deployment_evidence_bucket}",
          "arn:aws:s3:::${var.deployment_evidence_bucket}/*",
        ]
      },
    ] : [],
    # SQS grants live here rather than in the orchestration group purely for
    # size balance: with every conditional on, orchestration's rendered JSON
    # would exceed IAM's 6,144-char per-managed-policy cap (R9 rebalance).
    # Handler-gated SQS grants. Each statement was a count-gated inline
    # policy whose queue exists only when local.deploy_lambda_handlers.
    local.deploy_lambda_handlers ? [
      # (was inline policy "thinkwork-${stage}-wiki-compile-dlq-send")
      {
        Sid      = "WikiCompileDlqSend"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.wiki_compile_dlq[0].arn
      },
      # (was inline policy "thinkwork-${stage}-ontology-scan-dlq-send")
      {
        Sid      = "OntologyScanDlqSend"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.ontology_scan_dlq[0].arn
      },
      # (was inline policy "thinkwork-${stage}-ontology-reprocess-dlq-send")
      {
        Sid      = "OntologyReprocessDlqSend"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.ontology_reprocess_dlq[0].arn
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
  )

  # ---------------------------------------------------------------------------
  # Group 2: orchestration — cross-function invokes, Scheduler, Step
  # Functions, SQS, SES.
  # ---------------------------------------------------------------------------
  api_orchestration_statements = concat(
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
      # resolvers reach knowledge-base-manager and job-schedule-manager for
      # admin-driven operations. The agentcore-invoke statement below covers
      # the Pi runtime Lambda only — this one covers internal api-to-api
      # calls. ARNs are constructed deterministically from the handler naming
      # pattern so we don't create a dependency cycle with the handler
      # resource.
      {
        Effect = "Allow"
        Action = ["lambda:InvokeFunction"]
        Resource = [
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-chat-agent-invoke",
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-knowledge-base-manager",
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-job-schedule-manager",
          # eval-runner: graphql-http's startEvalRun mutation Event-invokes
          # this asynchronously after inserting the eval_runs row.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-eval-runner",
          # wiki-compile: memory-retain Event-invokes this after a successful
          # retainTurn when the tenant's wiki_compile_enabled flag is on.
          # compileWikiNow admin mutation also Event-invokes.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-wiki-compile",
          # knowledge-graph-thread-ingest: graphql-http's
          # startKnowledgeGraphThreadIngest mutation invokes this with
          # RequestResponse after inserting the durable ingest run.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-knowledge-graph-thread-ingest",
          # knowledge-graph-observations-ingest: graphql-http's
          # startKnowledgeGraphObservationsIngest mutation invokes this with
          # RequestResponse; the worker also Event-invokes ITSELF to drain a
          # truncated candidate backlog across successive runs.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-knowledge-graph-observations-ingest",
          # wiki-bootstrap-import: bootstrapJournalImport admin mutation
          # Event-invokes this for the long-running ingest path.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-wiki-bootstrap-import",
          # ontology-scan: startOntologySuggestionScan Event-invokes this
          # after inserting a durable scan job row.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-ontology-scan",
          # ontology-reprocess: approveOntologyChangeSet Event-invokes this
          # after inserting a durable reprocess job row.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-ontology-reprocess",
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
          # per-(agent, Space, user) workspace prefix.
          "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-workspace-renderer",
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

  # ---------------------------------------------------------------------------
  # Group 3: AI — Bedrock model invocation, Knowledge Bases, AgentCore
  # memory / evaluations / code interpreter.
  # ---------------------------------------------------------------------------
  api_ai_statements = [
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
    # (was standalone managed policy "lambda_bedrock_knowledge_base")
    # The knowledge-base-manager Lambda provisions and manages Bedrock
    # Knowledge Bases (control plane: create/sync/rechunk/delete), and
    # graphql-http's testKnowledgeBaseRetrieval query calls Retrieve. Without
    # these the manager fails with "not authorized to perform:
    # bedrock:CreateKnowledgeBase" and every KB is stuck in `failed`.
    # CreateKnowledgeBase / CreateDataSource also take a roleArn that Bedrock
    # assumes, so the caller needs iam:PassRole on the KB service role.
    {
      Effect = "Allow"
      Action = [
        "bedrock:CreateKnowledgeBase",
        "bedrock:GetKnowledgeBase",
        "bedrock:UpdateKnowledgeBase",
        "bedrock:DeleteKnowledgeBase",
        "bedrock:ListKnowledgeBases",
        "bedrock:CreateDataSource",
        "bedrock:GetDataSource",
        "bedrock:UpdateDataSource",
        "bedrock:DeleteDataSource",
        "bedrock:ListDataSources",
        "bedrock:StartIngestionJob",
        "bedrock:GetIngestionJob",
        "bedrock:ListIngestionJobs",
        "bedrock:Retrieve",
      ]
      # CreateKnowledgeBase/CreateDataSource have no resource ARN at create
      # time and don't support resource-level scoping, so a knowledge-base/*
      # ARN makes the grant not match. Control-plane "*" for this internal
      # manager Lambda; PassRole below stays scoped to the KB service role.
      Resource = "*"
    },
    {
      Effect   = "Allow"
      Action   = ["iam:PassRole"]
      Resource = var.kb_service_role_arn != "" ? var.kb_service_role_arn : "*"
    },
    # (was inline policy "agentcore-memory-rw")
    # AgentCore Memory read access for the GraphQL memory resolvers.
    # memoryRecords / memorySearch call ListMemoryRecordsCommand to fetch
    # records across the tenant's agents.
    {
      Effect = "Allow"
      Action = [
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
  ]

  # ---------------------------------------------------------------------------
  # Group 4: observability — CloudWatch Logs reads, ECS/ALB health reads.
  # ---------------------------------------------------------------------------
  api_observability_statements = [
    # (was inline policy "cloudwatch-logs-read")
    {
      Effect   = "Allow"
      Action   = ["logs:FilterLogEvents", "logs:GetLogEvents", "logs:DescribeLogGroups"]
      Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:*model-invocations*"
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
    # (was standalone managed policy "lambda_cognee_health_read")
    # graphql-http's Knowledge Graph health check validates the private
    # Cognee service from outside the VPC by reading ECS service steadiness
    # and ALB target health. ELBv2 Describe* actions do not support useful
    # resource scoping.
    {
      Effect = "Allow"
      Action = [
        "ecs:DescribeServices",
        "elasticloadbalancing:DescribeTargetGroups",
        "elasticloadbalancing:DescribeTargetHealth",
      ]
      Resource = "*"
    },
  ]
}

resource "aws_iam_policy" "api_data_plane" {
  name        = "thinkwork-${var.stage}-api-data-plane"
  description = "Grouped data-plane grants (RDS Data API, Secrets Manager, S3, DynamoDB, Cognito, SSM, KMS-via-SSM, SQS) for the shared api Lambda role"

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.api_data_plane_statements
  })
}

resource "aws_iam_role_policy_attachment" "api_data_plane" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.api_data_plane.arn
}

resource "aws_iam_policy" "api_orchestration" {
  name        = "thinkwork-${var.stage}-api-orchestration"
  description = "Grouped orchestration grants (Lambda invoke, EventBridge Scheduler, Step Functions, SES) for the shared api Lambda role"

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.api_orchestration_statements
  })
}

resource "aws_iam_role_policy_attachment" "api_orchestration" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.api_orchestration.arn
}

resource "aws_iam_policy" "api_ai" {
  name        = "thinkwork-${var.stage}-api-ai"
  description = "Grouped AI grants (Bedrock invoke, Knowledge Bases, AgentCore memory/eval/code-interpreter) for the shared api Lambda role"

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.api_ai_statements
  })
}

resource "aws_iam_role_policy_attachment" "api_ai" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.api_ai.arn
}

resource "aws_iam_policy" "api_observability" {
  name        = "thinkwork-${var.stage}-api-observability"
  description = "Grouped observability grants (CloudWatch Logs reads, ECS/ALB health reads) for the shared api Lambda role"

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.api_observability_statements
  })
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

moved {
  from = aws_iam_role_policy_attachment.lambda_cognee_health_read
  to   = aws_iam_role_policy_attachment.api_observability
}
