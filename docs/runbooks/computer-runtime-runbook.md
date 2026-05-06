# ThinkWork Computer Runtime Runbook

Phase 3 activates the shared ECS/EFS substrate with a versioned runtime image path, CLI lifecycle controls, a task enqueue surface, and a scheduled reconciler that nudges active Computers toward `desired_runtime_status`.

## Deploy Prerequisites

- `pnpm build:lambdas` must produce `computer-runtime.zip`, `computer-manager.zip`, and `computer-runtime-reconciler.zip`.
- Terraform must apply the shared `computer-runtime` module before Lambda API routes depend on its outputs.
- The Computer runtime image must be built and pushed to the ECR repository output by the module.
- `API_AUTH_SECRET` must match between the Lambda API and the ECS task environment.

## Build And Push Runtime Image

Use the dedicated image helper. Prefer a commit-derived tag over `latest`.

```bash
scripts/build-computer-runtime-image.sh \
  --repository-url "$COMPUTER_RUNTIME_REPOSITORY_URL" \
  --tag "$(git rev-parse --short=12 HEAD)-arm64" \
  --push
```

Set `COMPUTER_RUNTIME_IMAGE_TAG` for the manager/reconciler Lambda environment before provisioning or restarting services. ECS services move to a new image only when the manager registers a fresh task definition and updates the service.

## Provision A Computer Runtime

1. Confirm the Computer exists and has `desired_runtime_status = running`.
2. Use the CLI:

```bash
thinkwork computer runtime provision \
  --tenant-id "$TENANT_ID" \
  --computer-id "$COMPUTER_ID"
```

The raw service-auth endpoint is still available for break-glass use:

```bash
curl -sS "$THINKWORK_API_URL/api/computers/manager" \
  -H "authorization: Bearer $API_AUTH_SECRET" \
  -H "content-type: application/json" \
  -d '{
    "tenantId": "'"$TENANT_ID"'",
    "computerId": "'"$COMPUTER_ID"'",
    "action": "provision"
  }'
```

3. Verify the response includes `serviceName`, `accessPointId`, and `taskDefinitionArn`.
4. Check the Computer detail page for `runtime_status = starting`.
5. Wait for the runtime heartbeat to move status to `running`.

## Start, Stop, Restart, Status

Use the CLI:

```bash
thinkwork computer runtime status  --tenant-id "$TENANT_ID" --computer-id "$COMPUTER_ID"
thinkwork computer runtime start   --tenant-id "$TENANT_ID" --computer-id "$COMPUTER_ID"
thinkwork computer runtime stop    --tenant-id "$TENANT_ID" --computer-id "$COMPUTER_ID"
thinkwork computer runtime restart --tenant-id "$TENANT_ID" --computer-id "$COMPUTER_ID"
```

`status` describes the ECS service and writes the observed runtime status back to the Computer row.

## Enqueue Phase 3 Tasks

Phase 3 supports three bounded task types:

| Task | Purpose |
| --- | --- |
| `health_check` | Runtime writes a small marker file to prove the EFS mount is writable |
| `workspace_file_write` | Runtime writes operator-supplied UTF-8 content to a workspace-relative path |
| `google_cli_smoke` | Runtime checks whether the Google Workspace CLI binary is present; no OAuth token is accepted |

Examples:

```bash
thinkwork computer task enqueue \
  --tenant-id "$TENANT_ID" \
  --computer-id "$COMPUTER_ID" \
  --type health_check \
  --idempotency-key "health-$(date +%Y%m%d%H%M)"

thinkwork computer task enqueue \
  --tenant-id "$TENANT_ID" \
  --computer-id "$COMPUTER_ID" \
  --type workspace_file_write \
  --path "smoke/phase3.txt" \
  --content "ThinkWork Computer runtime is writing to EFS."

thinkwork computer task enqueue \
  --tenant-id "$TENANT_ID" \
  --computer-id "$COMPUTER_ID" \
  --type google_cli_smoke
```

`workspace_file_write` rejects absolute paths and `.` / `..` segments. Do not put secrets, OAuth refresh tokens, or provider access tokens in task input.

## Runtime Reconciler

`computer-runtime-reconciler` runs every 5 minutes. It selects a bounded batch of active Computers and:

- provisions a service when `desired_runtime_status = running` and no ECS service exists
- starts a provisioned service when desired running but observed stopped or unknown
- stops a provisioned service when desired stopped but observed running or starting
- records `computer_runtime_reconcile_succeeded` or `computer_runtime_reconcile_failed` events

Use the manager CLI for immediate actions during smoke tests; rely on the reconciler for drift correction.

## Migration Flow

Run dry-run first:

```bash
thinkwork computer migration dry-run --tenant-id "$TENANT_ID"
```

Apply only when blockers are empty:

```bash
thinkwork computer migration apply --tenant-id "$TENANT_ID" --confirm
```

Blockers are intentional. Resolve duplicate human-paired Agents, existing Computer conflicts, or incorrectly typed templates before applying.

## Common Failures

| Symptom                              | Check                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Manager returns 401                  | `API_AUTH_SECRET` mismatch or missing bearer token                                              |
| Manager returns 409                  | Computer has no provisioned ECS service for start/stop, or migration blockers exist             |
| Provision returns 500 missing config | Lambda env is missing `COMPUTER_RUNTIME_*` outputs from Terraform                               |
| ECS task stops immediately           | Check `/thinkwork/<stage>/computer-runtime` CloudWatch logs                                     |
| Heartbeat never arrives              | Verify private subnet egress, API URL, API secret, and task security group egress               |
| Workspace mount fails                | Verify EFS mount targets exist in every private subnet and task SG can reach EFS SG on TCP 2049 |

## Phase 3 Limits

- Google Workspace CLI probing is best-effort and does not configure user OAuth by itself.
- Gmail, Calendar, Drive, Docs, and Sheets tasks are not implemented yet.
- Delegated AgentCore execution through `computer_delegations` is not implemented yet.
- Browser/computer-use tooling is a follow-on capability once the runtime image is hardened.
