# `agentcore-flue` — Flue agent runtime

Provisions the **Flue** agent runtime as a Lambda+LWA function (Plan §005 U2).

The Flue runtime supersedes the in-flight `agentcore-pi` scaffolding (renamed in U1, PR #785). U2 splits the Flue Lambda + log group + IAM role + event-invoke config out of the Strands `agentcore-runtime` module into this dedicated module so Flue can carry its own permissions surface independently.

## Resources owned

- `aws_iam_role.agentcore_flue` (`thinkwork-${stage}-agentcore-flue-role`) — assumed by Lambda + Bedrock AgentCore Runtime principals.
- `aws_iam_role_policy.agentcore_flue` — baseline permissions (S3 skill catalog, Bedrock model invoke, AgentCore Memory + Code Interpreter, CloudWatch Logs, X-Ray ingestion, ECR pull, SSM parameter access, memory-retain Lambda invoke). Forward-compat additions for U4-U8: Aurora Data API + Secrets Manager scoped to `thinkwork-${stage}-*`.
- `aws_iam_role_policy.agentcore_flue_dlq_send` — `sqs:SendMessage` against the shared async DLQ (injected via `var.async_dlq_arn`).
- `aws_cloudwatch_log_group.agentcore_flue` (`/thinkwork/${stage}/agentcore-flue`).
- `aws_lambda_function.agentcore_flue` (`thinkwork-${stage}-agentcore-flue`) — `package_type = "Image"`, pulls `${ecr_repository_url}:flue-latest`.
- `aws_lambda_function_event_invoke_config.agentcore_flue` — `MaximumRetryAttempts=0`, on-failure → shared DLQ.

## Resources NOT owned (injected via inputs)

- **ECR repository** — shared with the Strands runtime (`thinkwork-${stage}-agentcore`). The Flue runtime pulls the `flue-latest` / `${sha}-flue` image tags from this repo. Owned by `../agentcore-runtime`; URL injected via `var.ecr_repository_url`.
- **Async DLQ** — shared with the Strands runtime so operator inspection has a single queue. Owned by `../agentcore-runtime`; ARN injected via `var.async_dlq_arn`.

## State migration (U1 → U2)

The Flue resources previously lived inside `module.agentcore` under the address `aws_*.agentcore_flue` (renamed from `agentcore_pi` in U1 via in-module `moved {}` blocks). U2 realigns state across modules via `moved {}` blocks declared in the parent composition (`terraform/modules/thinkwork/main.tf`):

```hcl
moved {
  from = module.agentcore.aws_lambda_function.agentcore_flue
  to   = module.agentcore_flue.aws_lambda_function.agentcore_flue
}
# (and the analogous moves for the log group + event-invoke config + IAM role)
```

The Lambda `function_name` attribute is unchanged (`thinkwork-${stage}-agentcore-flue` from U1), so the cross-module migration is pure state-address realignment without destroy+create on the underlying AWS resource.

## Inputs

| Variable | Required | Purpose |
|---|---|---|
| `stage` | yes | Deployment stage (e.g., `dev`, `prod`). |
| `account_id` | yes | AWS account ID (used in IAM resource ARNs). |
| `region` | yes | AWS region. |
| `bucket_name` | yes | Primary S3 bucket for skills + workspace files. |
| `ecr_repository_url` | yes | Shared ECR repo URL from `module.agentcore.ecr_repository_url`. |
| `async_dlq_arn` | yes | Shared async DLQ ARN from `module.agentcore.agentcore_async_dlq_arn`. |
| `hindsight_endpoint` | no | Hindsight API endpoint when enabled; empty disables Hindsight tools. |
| `agentcore_memory_id` | no | AgentCore Memory resource ID for auto-retention. |
| `api_endpoint` | no | API Gateway base URL for the `/api/skills/complete` callback. |
| `api_auth_secret` | no | Service-auth bearer for the same callback. |
| `memory_engine` | no | `hindsight` or `agentcore`; surfaced as `MEMORY_ENGINE` env var. |

## Outputs

| Output | Purpose |
|---|---|
| `flue_function_name` | Direct SDK invoke target (passed to `chat-agent-invoke` as `AGENTCORE_FLUE_FUNCTION_NAME`). |
| `flue_function_arn` | Granted to `chat-agent-invoke`'s `lambda:InvokeFunction` policy. |
| `flue_runtime_role_arn` | Assumed by the Bedrock AgentCore Runtime when Flue is invoked via the Bedrock control plane. |
| `flue_log_group_name` | Scrubber + operator inspection target. |
