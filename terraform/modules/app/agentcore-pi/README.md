# `agentcore-pi` — Pi agent runtime

Provisions the **Pi** agent runtime as a Lambda+LWA function (Plan §005 U2).

This module owns the dedicated Pi Lambda + log group + IAM role + event-invoke config. Shared AgentCore platform resources live in `../agentcore-platform`.

## Resources owned

- `aws_iam_role.agentcore_pi` (`thinkwork-${stage}-agentcore-pi-role`) — assumed by Lambda + Bedrock AgentCore Runtime principals.
- `aws_iam_role_policy.agentcore_pi` — baseline permissions (S3 skill catalog, Bedrock model invoke, AgentCore Memory + Code Interpreter, CloudWatch Logs, X-Ray ingestion, ECR pull, SSM parameter access, memory-retain Lambda invoke). Forward-compat additions for U4-U8: Aurora Data API + Secrets Manager scoped to `thinkwork-${stage}-*`.
- `aws_iam_role_policy_attachment.agentcore_pi_vpc_access` — attached when Pi needs private-network access for Company Brain/Cognee direct MCP or the OKF EFS mount.
- `aws_iam_role_policy.agentcore_pi_dlq_send` — `sqs:SendMessage` against the shared async DLQ (injected via `var.async_dlq_arn`).
- `aws_cloudwatch_log_group.agentcore_pi` (`/thinkwork/${stage}/agentcore-pi`).
- `aws_lambda_function.agentcore_pi` (`thinkwork-${stage}-agentcore-pi`) — `package_type = "Image"`, pulls `${ecr_repository_url}:pi-latest`.
- `aws_lambda_function_event_invoke_config.agentcore_pi` — `MaximumRetryAttempts=0`, on-failure → shared DLQ.

## Resources NOT owned (injected via inputs)

- **ECR repository** — shared AgentCore image repository (`thinkwork-${stage}-agentcore`). Pi pulls the `pi-latest` / `${sha}-pi` image tags from this repo. Owned by `../agentcore-platform`; URL injected via `var.ecr_repository_url`.
- **Async DLQ** — shared AgentCore async failure queue. Owned by `../agentcore-platform`; ARN injected via `var.async_dlq_arn`.

## State migration

The dedicated runtime previously shipped as Flue. The migration renamed that module and runtime identity back to Pi via `moved {}` blocks declared in the parent composition (`terraform/modules/thinkwork/main.tf`):

```hcl
moved {
  from = module.agentcore_flue.aws_lambda_function.agentcore_flue
  to   = module.agentcore_pi.aws_lambda_function.agentcore_pi
}
# (and the analogous moves for the log group + event-invoke config + IAM role)
```

The Lambda function name changes from `thinkwork-${stage}-agentcore-flue` to `thinkwork-${stage}-agentcore-pi`, so apply the runtime/data migration as part of the same release window.

## Inputs

| Variable              | Required | Purpose                                                                        |
| --------------------- | -------- | ------------------------------------------------------------------------------ |
| `stage`               | yes      | Deployment stage (e.g., `dev`, `prod`).                                        |
| `account_id`          | yes      | AWS account ID (used in IAM resource ARNs).                                    |
| `region`              | yes      | AWS region.                                                                    |
| `bucket_name`         | yes      | Primary S3 bucket for skills + workspace files.                                |
| `ecr_repository_url`  | yes      | Shared ECR repo URL from `module.agentcore_platform.ecr_repository_url`.       |
| `async_dlq_arn`       | yes      | Shared async DLQ ARN from `module.agentcore_platform.agentcore_async_dlq_arn`. |
| `hindsight_endpoint`  | no       | Hindsight API endpoint when enabled; empty disables Hindsight tools.           |
| `agentcore_memory_id` | no       | AgentCore Memory resource ID for auto-retention.                               |
| `api_endpoint`        | no       | API Gateway base URL for the `/api/skills/complete` callback.                  |
| `api_auth_secret`     | no       | Service-auth bearer for the same callback.                                     |
| `memory_engine`       | no       | `hindsight` or `agentcore`; surfaced as `MEMORY_ENGINE` env var.               |
| `cognee_subnet_ids`   | no       | Private subnets for direct Company Brain/Cognee MCP access.                    |
| `cognee_security_group_ids` | no | Security groups allowed to reach the internal Company Brain/Cognee endpoint.    |

## Outputs

| Output                | Purpose                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `pi_function_name`    | Direct SDK invoke target (passed to `chat-agent-invoke` as `AGENTCORE_PI_FUNCTION_NAME`).  |
| `pi_function_arn`     | Granted to `chat-agent-invoke`'s `lambda:InvokeFunction` policy.                           |
| `pi_runtime_role_arn` | Assumed by the Bedrock AgentCore Runtime when Pi is invoked via the Bedrock control plane. |
| `pi_log_group_name`   | Scrubber + operator inspection target.                                                     |
