################################################################################
# Workflow Interpreter Step Functions — App Module (stage-level)
#
# ONE static Step Functions Standard state machine per stage interprets every
# ThinkWork workflow definition (THINK-219). Unlike the routines substrate —
# which mints a state machine per routine at runtime — the interpreter is a
# fixed loop that lives entirely in this module:
#
#   LoadNextStep (Lambda) -> Choice on directive -> dispatch
#     (waitForTaskToken for agent/approval, Wait with TimestampPath for wait)
#     -> RecordAdvance -> Choice (loop / rollover / terminal).
#
# SFN state carries ONLY a cursor {workflowRunId, tenantId, stepPointer,
# iteration, loopCycleCount}; all step results live in Postgres, so the 256KB
# payload cap is a non-issue by construction (KTD1). Rollover self-restarts the
# machine at loop-cycle thresholds via a fire-and-forget states:startExecution
# so the ~1,400-event history ceiling is never hit (KTD6).
#
# **Fresh module name.** This deliberately does NOT reclaim the empty
# `system-workflows-stepfunctions/` directory — that is the tombstone of the
# System Workflows subsystem destroyed 2026-05-06 (#871); re-attaching the
# retired name would confuse state history.
#
# **Tenant isolation is application-layer for the shared role (KTD9).** Matching
# the routines substrate reality, one shared execution role serves the single
# machine; the step-dispatch Lambda re-asserts tenant_id from the run row on
# every invocation. Accepted v1 posture — no per-tenant tags, no ABAC.
################################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

locals {
  state_machine_name = "thinkwork-${var.stage}-workflow-interpreter"
  log_group_name     = "/aws/vendedlogs/states/thinkwork-${var.stage}-workflow-interpreter"
  role_name          = "thinkwork-${var.stage}-workflow-interpreter-execution-role"

  # Constructed (not resource-referenced) to avoid a cycle: the state machine's
  # ARN is deterministic from name/region/account, so the execution role can
  # grant states:StartExecution on its OWN machine without a self-reference.
  state_machine_arn = "arn:aws:states:${var.region}:${var.account_id}:stateMachine:${local.state_machine_name}"

  # Single Lambda serves all interpreter phases (load_next, dispatch_agent,
  # await_approval, record_approval, record_advance). Constructed by string to
  # avoid a chicken-and-egg with the lambda-api module.
  step_dispatch_lambda_arn = "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-workflow-step-dispatch"

  # Retry applied to every synchronous lambda:invoke Task (transient
  # service/SDK faults only — application errors surface, they do not retry).
  lambda_invoke_retry = [{
    ErrorEquals = [
      "Lambda.ServiceException",
      "Lambda.AWSLambdaException",
      "Lambda.SdkClientException",
      "Lambda.TooManyRequestsException",
    ]
    IntervalSeconds = 2
    MaxAttempts     = 3
    BackoffRate     = 2
  }]

  ssm_state_machine_arn_param = "/thinkwork/${var.stage}/workflow-interpreter/state-machine-arn"
}

################################################################################
# CloudWatch Log Group — vendedlogs prefix dodges the resource-policy size cap.
################################################################################

resource "aws_cloudwatch_log_group" "interpreter" {
  name              = local.log_group_name
  retention_in_days = var.log_retention_days

  tags = {
    Name    = local.log_group_name
    Stage   = var.stage
    Purpose = "step-functions-workflow-interpreter"
  }
}

################################################################################
# Step Functions Execution Role — single shared role for the one machine.
# Trust: states.amazonaws.com, scoped by aws:SourceAccount.
################################################################################

resource "aws_iam_role" "execution" {
  name = local.role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "states.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = var.account_id
        }
      }
    }]
  })

  tags = {
    Name    = local.role_name
    Stage   = var.stage
    Purpose = "step-functions-workflow-interpreter-execution"
  }
}

# CloudWatch Logs delivery + X-Ray. Step Functions requires these to populate
# execution history into the vendedlogs prefix.
resource "aws_iam_role_policy" "execution_logs" {
  name = "logs-and-xray"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "${aws_cloudwatch_log_group.interpreter.arn}:*"
      },
      {
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets",
        ]
        Resource = "*"
      },
    ]
  })
}

# Lambda invocation — scoped to the single interpreter step-dispatch Lambda,
# which serves every ASL phase. The Lambda itself re-asserts tenant_id from the
# run row, so no ABAC is layered here.
resource "aws_iam_role_policy" "execution_lambda_invoke" {
  name = "lambda-invoke-step-dispatch"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = [local.step_dispatch_lambda_arn]
    }]
  })
}

# Step Functions self-invocation (rollover continue-as-new via RolloverStart's
# fire-and-forget states:startExecution) plus task-token completion. The
# self-reference uses the constructed ARN (local.state_machine_arn) rather than
# the resource attribute to avoid a definition<->role dependency cycle.
#
# Application-layer tenant isolation (KTD9): the shared role has no tenantId
# principal tag; tenant scoping lives in the step-dispatch Lambda + the run row.
resource "aws_iam_role_policy" "execution_states" {
  name = "states-self-invoke"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["states:StartExecution"]
        Resource = local.state_machine_arn
      },
      {
        Effect = "Allow"
        Action = [
          "states:SendTaskSuccess",
          "states:SendTaskFailure",
          "states:SendTaskHeartbeat",
        ]
        Resource = "*"
      },
    ]
  })
}

################################################################################
# The one static interpreter state machine (Standard).
#
# See KTD1 for the loop shape. Directives are the FROZEN protocol the
# step-dispatch Lambda emits: dispatch_agent, wait_until, execute_step,
# await_approval, await_memory_stage, continue, rollover, terminal_success,
# terminal_failure, terminal_canceled.
################################################################################

resource "aws_sfn_state_machine" "interpreter" {
  name     = local.state_machine_name
  role_arn = aws_iam_role.execution.arn

  logging_configuration {
    include_execution_data = false
    level                  = "ALL"
    log_destination        = "${aws_cloudwatch_log_group.interpreter.arn}:*"
  }

  definition = jsonencode({
    Comment = "ThinkWork Workflow Interpreter — one static loop per stage. DB is source of truth; SFN state carries only a cursor."
    StartAt = "LoadNextStep"
    States = {
      # ---- Load the next step for the current cursor -------------------------
      LoadNextStep = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = local.step_dispatch_lambda_arn
          Payload = {
            phase            = "load_next"
            "cursor.$"       = "$.cursor"
            "executionArn.$" = "$$.Execution.Id"
          }
        }
        OutputPath = "$.Payload"
        Retry      = local.lambda_invoke_retry
        Next       = "DirectiveChoice"
      }

      # ---- Branch on the directive the Lambda emitted ------------------------
      DirectiveChoice = {
        Type = "Choice"
        Choices = [
          { Variable = "$.directive", StringEquals = "dispatch_agent", Next = "AgentStep" },
          { Variable = "$.directive", StringEquals = "wait_until", Next = "WaitState" },
          { Variable = "$.directive", StringEquals = "execute_step", Next = "ExecuteStep" },
          { Variable = "$.directive", StringEquals = "await_approval", Next = "ApprovalStep" },
          { Variable = "$.directive", StringEquals = "await_memory_stage", Next = "MemoryStageStep" },
          { Variable = "$.directive", StringEquals = "continue", Next = "LoadNextStep" },
          { Variable = "$.directive", StringEquals = "rollover", Next = "RolloverStart" },
          { Variable = "$.directive", StringEquals = "terminal_success", Next = "SucceedState" },
          { Variable = "$.directive", StringEquals = "terminal_canceled", Next = "SucceedState" },
        ]
        # terminal_failure and any unknown directive fail the run.
        Default = "FailState"
      }

      # ---- Agent step: dispatch a Pi goal turn, park on the task token -------
      AgentStep = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke.waitForTaskToken"
        Parameters = {
          FunctionName = local.step_dispatch_lambda_arn
          Payload = {
            phase         = "dispatch_agent"
            "cursor.$"    = "$.cursor"
            "taskToken.$" = "$$.Task.Token"
          }
        }
        ResultPath       = "$.stepResult"
        HeartbeatSeconds = 3600
        TimeoutSeconds   = 172800
        # States.ALL must stand alone; it subsumes States.Timeout/States.TaskFailed.
        # Any agent-step failure routes to RecordAdvance so the Lambda records a
        # step-failed event rather than stranding the run.
        Catch = [{
          ErrorEquals = ["States.ALL"]
          ResultPath  = "$.stepResult"
          Next        = "RecordAdvance"
        }]
        Next = "RecordAdvance"
      }

      # ---- Executable step: routine / http / emit_event run synchronously in
      # the Lambda (THINK-215). The phase executes the step, records outcome +
      # output evidence, evaluates advance/policy itself, and returns the next
      # directive — so its output feeds DirectiveChoice directly. Application
      # failures are recorded in the ledger by the Lambda; only an infra-level
      # crash reaches Catch, where the EventBridge execution-callback
      # terminalizes the run.
      ExecuteStep = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = local.step_dispatch_lambda_arn
          Payload = {
            phase      = "execute_step"
            "cursor.$" = "$.cursor"
          }
        }
        OutputPath     = "$.Payload"
        TimeoutSeconds = 900
        Retry          = local.lambda_invoke_retry
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "FailState"
        }]
        Next = "DirectiveChoice"
      }

      # ---- Wait step: park until the ISO timestamp the Lambda emitted --------
      WaitState = {
        Type          = "Wait"
        TimestampPath = "$.until"
        Next          = "InjectWaitResult"
      }

      # Wait carries no stepResult; inject a marker so RecordAdvance's frozen
      # contract (top-level cursor + stepResult) holds uniformly.
      InjectWaitResult = {
        Type       = "Pass"
        Result     = { waitCompleted = true }
        ResultPath = "$.stepResult"
        Next       = "RecordAdvance"
      }

      # ---- Approval step: suspend as waiting_for_human on a task token -------
      ApprovalStep = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke.waitForTaskToken"
        Parameters = {
          FunctionName = local.step_dispatch_lambda_arn
          Payload = {
            phase         = "await_approval"
            "cursor.$"    = "$.cursor"
            "taskToken.$" = "$$.Task.Token"
          }
        }
        ResultPath     = "$.approval"
        TimeoutSeconds = 604800
        Catch = [{
          ErrorEquals = ["States.Timeout"]
          Next        = "FailState"
        }]
        Next = "RecordApproval"
      }

      RecordApproval = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = local.step_dispatch_lambda_arn
          Payload = {
            phase        = "record_approval"
            "cursor.$"   = "$.cursor"
            "approval.$" = "$.approval"
          }
        }
        OutputPath = "$.Payload"
        Retry      = local.lambda_invoke_retry
        Next       = "DirectiveChoice"
      }

      # ---- Memory-stage step: park on a task token while the async memory-
      # stage worker runs one pipeline stage; the await phase Event-invokes the
      # worker, which resumes the token via SendTaskSuccess with a result JSON.
      MemoryStageStep = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke.waitForTaskToken"
        Parameters = {
          FunctionName = local.step_dispatch_lambda_arn
          Payload = {
            phase         = "await_memory_stage"
            "cursor.$"    = "$.cursor"
            "taskToken.$" = "$$.Task.Token"
          }
        }
        ResultPath       = "$.result"
        TimeoutSeconds   = 7200
        HeartbeatSeconds = 3600
        Catch = [{
          ErrorEquals = ["States.Timeout"]
          Next        = "FailState"
        }]
        Next = "RecordMemoryStage"
      }

      RecordMemoryStage = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = local.step_dispatch_lambda_arn
          Payload = {
            phase      = "record_memory_stage"
            "cursor.$" = "$.cursor"
            "result.$" = "$.result"
          }
        }
        OutputPath = "$.Payload"
        Retry      = local.lambda_invoke_retry
        Next       = "DirectiveChoice"
      }

      # ---- Record the step outcome, evaluate policy, emit the next directive -
      RecordAdvance = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = local.step_dispatch_lambda_arn
          Payload = {
            phase          = "record_advance"
            "cursor.$"     = "$.cursor"
            "stepResult.$" = "$.stepResult"
          }
        }
        OutputPath = "$.Payload"
        Retry      = local.lambda_invoke_retry
        Next       = "DirectiveChoice"
      }

      # ---- Rollover: continue-as-new self-restart (fire-and-forget) ----------
      RolloverStart = {
        Type     = "Task"
        Resource = "arn:aws:states:::states:startExecution"
        Parameters = {
          "StateMachineArn.$" = "$$.StateMachine.Id"
          Input = {
            "cursor.$"                                     = "$.cursor"
            "AWS_STEP_FUNCTIONS_STARTED_BY_EXECUTION_ID.$" = "$$.Execution.Id"
          }
        }
        Next = "SucceedState"
      }

      SucceedState = { Type = "Succeed" }

      FailState = {
        Type  = "Fail"
        Error = "WorkflowFailed"
        Cause = "see ThinkWork run ledger"
      }
    }
  })

  tags = {
    Name    = local.state_machine_name
    Stage   = var.stage
    Purpose = "workflow-interpreter"
  }
}

################################################################################
# SSM parameter — interpreter machine ARN.
#
# graphql-http (manual triggerWorkflowRun) and job-trigger (workflow_schedule)
# resolve the machine ARN from SSM rather than a Lambda env var, dodging the
# graphql-http 4KB env ceiling (plan Risks). The shared API lambda role already
# reads /thinkwork/${stage}/* via the api_data_plane grant.
################################################################################

resource "aws_ssm_parameter" "state_machine_arn" {
  name        = local.ssm_state_machine_arn_param
  description = "ARN of the shared workflow-interpreter Step Functions state machine."
  type        = "String"
  value       = aws_sfn_state_machine.interpreter.arn

  tags = {
    Stage   = var.stage
    Purpose = "workflow-interpreter"
  }
}

################################################################################
# EventBridge — Step Functions execution-state-change -> workflow-execution-callback
#
# AWS fires `Step Functions Execution Status Change` on every transition. The
# callback Lambda projects terminal status onto workflow_runs (with the
# current-ARN guard for rolled-over executions, KTD6). Gated on the callback
# ARN being wired so this substrate module applies before lambda-api defines
# the function; the composite module passes the ARN once both apply.
################################################################################

resource "aws_cloudwatch_event_rule" "sfn_state_change" {
  count       = var.enable_execution_callback ? 1 : 0
  name        = "thinkwork-${var.stage}-workflow-interpreter-sfn-state-change"
  description = "Forward interpreter Step Functions execution-state-change events to workflow-execution-callback so workflow_runs tracks lifecycle status."

  event_pattern = jsonencode({
    source        = ["aws.states"]
    "detail-type" = ["Step Functions Execution Status Change"]
    detail = {
      stateMachineArn = [
        {
          prefix = local.state_machine_arn
        },
      ]
      # SUCCEEDED is intentionally excluded: success is always projected onto
      # workflow_runs by the step-dispatch Lambda BEFORE the execution ends,
      # and a rolled-over execution's SUCCEEDED racing the repoint could
      # otherwise terminalize a live looping run.
      status = ["FAILED", "TIMED_OUT", "ABORTED"]
    }
  })

  tags = {
    Name  = "thinkwork-${var.stage}-workflow-interpreter-sfn-state-change"
    Stage = var.stage
  }
}

resource "aws_cloudwatch_event_target" "sfn_state_change" {
  count     = var.enable_execution_callback ? 1 : 0
  rule      = aws_cloudwatch_event_rule.sfn_state_change[0].name
  target_id = "workflow-execution-callback"
  arn       = var.execution_callback_lambda_arn
}

resource "aws_lambda_permission" "sfn_state_change" {
  count         = var.enable_execution_callback ? 1 : 0
  statement_id  = "AllowEventBridgeInvokeWorkflowExecutionCallback"
  action        = "lambda:InvokeFunction"
  function_name = var.execution_callback_lambda_arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.sfn_state_change[0].arn
}
