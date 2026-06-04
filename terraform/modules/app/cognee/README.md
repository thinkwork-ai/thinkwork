# Cognee Module (optional ontology/KG add-on)

Cognee is the optional ontology and knowledge-graph substrate for future
Company Brain work. It is **not** the memory engine, does not replace Hindsight,
and does not ingest or migrate Wiki/Brain content during Terraform apply.

## What it creates

When the parent module enables Cognee, this module provisions:

- ECS Fargate cluster, task definition, and service for the Cognee API on port 8000.
- Internal Application Load Balancer. There is no internet-facing endpoint mode
  in phase 1.
- Security groups for ALB to Cognee, Cognee to Aurora, and Cognee to EFS.
- EFS encrypted storage mounted at `/app/cognee-storage`, with Cognee
  `DATA_ROOT_DIRECTORY` and `SYSTEM_ROOT_DIRECTORY` rooted below it.
- CloudWatch log group `/thinkwork/{stage}/cognee`.
- Task/execution IAM roles, including explicit Bedrock invoke permissions and
  Secrets Manager access for ECS secret injection.

## Enablement checklist

Cognee is disabled by default at the composite module, greenfield example,
CLI-generated root, enterprise deploy template, and CI workflow surfaces. Existing
deployments should not expect Cognee resources until `enable_cognee = true` is
set explicitly.

Before enabling it, prepare these operator-owned inputs:

- `cognee_image_uri` pinned to an immutable `@sha256:` digest.
- `cognee_db_password_secret_arn` for the dedicated `cognee_db_username`
  database user. Do not reuse the shared Thinkwork admin database secret.
- `cognee_bedrock_model_resource_arns` for the selected Bedrock LLM and
  embedding models, or non-Bedrock provider secret ARNs when using external
  providers.
- `cognee_allowed_internal_cidr_blocks` or
  `cognee_allowed_internal_security_group_ids` for the callers allowed to reach
  the internal ALB.
- `cognee_backend_mode`, `cognee_desired_count`, and graph/vector configuration.
  Keep dogfood mode at one task; use remote stores before scaling out.

After apply, inspect these outputs instead of reconstructing resource names:

- `cognee_enabled`
- `cognee_endpoint`
- `cognee_log_group_name`
- `cognee_backend_mode`
- `cognee_cluster_arn`
- `cognee_service_name`
- `cognee_security_group_id`
- `cognee_storage_file_system_id`

Terraform proves that the infrastructure graph is syntactically valid and that
ECS reached steady state when `wait_for_steady_state = true`. It does not prove
that Cognee can serve ontology work, that provider credentials are populated, or
that any Wiki/Brain content has migrated.

## Phase-1 network contract

The ALB is internal-only (`internal = true`). ECS tasks run in the existing
public subnets with `assign_public_ip = true` so they can reach Bedrock, ECR,
Secrets Manager, CloudWatch Logs, and optional external providers without NAT
gateway or VPC endpoint work in this pass.

The Cognee task security group accepts inbound traffic only from the internal
ALB. The ALB accepts inbound traffic only from
`allowed_internal_cidr_blocks`/`allowed_internal_security_group_ids`.
All-network CIDRs such as `0.0.0.0/0` and `::/0` are rejected.

ThinkWork owns tenant/user authorization at the GraphQL and worker boundaries.
Because this module exposes Cognee only on a private internal ALB, Cognee-native
request authentication and backend access control are disabled together
(`REQUIRE_AUTHENTICATION=false`, `ENABLE_BACKEND_ACCESS_CONTROL=false`) so the
VPC-attached worker can call the REST API without a Cognee login flow. Do not
reuse this module shape for an internet-reachable Cognee endpoint.

## Backend modes

| Mode      | Purpose                                                           | Scale contract                                         |
| --------- | ----------------------------------------------------------------- | ------------------------------------------------------ |
| `dogfood` | Low-cost internal trials with EFS-backed local graph/vector paths | `desired_count = 1`; not HA                            |
| `remote`  | Externally managed graph/vector stores                            | Requires both `vector_db_url` and `graph_database_url` |

Dogfood mode is deliberately single-task because Cognee's local Kuzu/LanceDB
style stores are not suitable for concurrent writers. Use remote stores before
raising `desired_count` above 1.

## Secret handling

Sensitive values enter the ECS task through the `secrets` block, not the normal
environment list:

- `DB_PASSWORD` is read from `db_password_secret_arn` JSON key `password`.
  Use a dedicated least-privilege Cognee database user. Do not pass the shared
  Aurora admin/master credential.
- Optional non-Bedrock `LLM_API_KEY` and `EMBEDDING_API_KEY` values come from
  their matching secret ARN inputs.
- Optional remote vector/graph credentials use `VECTOR_DB_KEY` and
  `GRAPH_DATABASE_PASSWORD` secret ARN inputs.

Bedrock is the default LLM and embedding provider path, so no provider API key is
needed by default. Callers must still pass the specific
`bedrock_model_resource_arns` Cognee may invoke. If a non-Bedrock provider cannot
consume secrets through ECS secret injection, do not enable that provider mode
until a wrapper/entrypoint is added.

The module accepts pre-existing secret ARNs by default. For deployments that
want Terraform to create the secret containers, set
`create_secret_placeholders = true`. Terraform then creates only the missing
secret containers required by the selected configuration:

- `thinkwork/{stage}/cognee/db-credentials`
- `thinkwork/{stage}/cognee/llm-api-key`
- `thinkwork/{stage}/cognee/embedding-api-key`
- `thinkwork/{stage}/cognee/vector-db-key`
- `thinkwork/{stage}/cognee/graph-database-password`

Secret versions are seeded with `PLACEHOLDER_SET_VIA_CLI` and use
`lifecycle.ignore_changes = [secret_string]`. Operators populate or rotate the
real values with Secrets Manager after apply, and later Terraform applies do not
clobber those values. Outputs expose only the selected secret ARNs.

`vector_db_url` and `graph_database_url` must not embed credentials in userinfo
or query parameters. Put remote-store credentials in the matching secret ARN
inputs.

## Image pinning

`image_uri` is required and must be pinned to an immutable `@sha256:` digest.
Mutable public tags such as `cognee/cognee:main` are intentionally rejected
because the task can access customer knowledge stores, secrets, and Bedrock.

## Smoke expectations

Terraform validation proves syntax and dependencies, not runtime readiness.
After enabling Cognee in a stage, operators should verify:

- `cognee_enabled` is `true`, `cognee_backend_mode` matches the intended mode,
  and `cognee_endpoint` is an internal ALB URL.
- The internal ALB health check is healthy and the health endpoint is reachable
  from the intended caller network or security group.
- Terraform waited for ECS steady state, or operators manually confirmed the
  service is stable if `wait_for_steady_state = false` was used.
- `cognee_log_group_name` points to logs where Cognee boots without provider,
  database, graph, vector, or filesystem errors.
- Cognee reports the configured LLM, embedding, graph, and vector providers.
- Cognee can call the selected LLM/embedding provider.
- Cognee can reach the configured relational, vector, and graph stores.

If startup fails, start with the ECS service events and the Cognee CloudWatch log
group. Provider failures usually indicate missing Bedrock ARNs, missing
Secrets Manager values, or unsupported provider/credential plumbing. Database,
graph, and vector failures usually indicate connectivity, URL, secret, or
backend-mode mismatches.

## Rollback

To disable the substrate, set `enable_cognee = false` and apply through the
normal deploy pipeline. That removes the ECS service, internal ALB, security
groups, and Terraform-owned storage/secrets for the module. It does not roll back
or rewrite approved ontology definitions, Brain pages, Wiki content, or agent
context. Those product migrations are owned by later application-level work.

For a failed rollout where data should be preserved, scale or disable callers
first, snapshot/export EFS or remote graph/vector stores as appropriate, and then
apply the Terraform change. Do not manually mutate production resources outside
the normal incident/deploy process.

## Cleanup

EFS stores persistent Cognee data/system files. Destroying the module may delete
that storage if Terraform owns it. Remote graph/vector stores may retain data
outside Terraform entirely. Treat production data cleanup as an operator
decision: snapshot or export before destructive changes, and document whether the
data belongs to the Terraform-owned EFS volume, an operator-managed remote store,
or both.
