# ThinkWork Computer Runtime Runbook

Phase 2 introduces a shared ECS/EFS substrate and a service-auth manager endpoint for per-Computer runtime reconciliation.

## Deploy Prerequisites

- `pnpm build:lambdas` must produce both `computer-runtime.zip` and `computer-manager.zip`.
- Terraform must apply the shared `computer-runtime` module before Lambda API routes depend on its outputs.
- The Computer runtime image must be built and pushed to the ECR repository output by the module.
- `API_AUTH_SECRET` must match between the Lambda API and the ECS task environment.

## Provision A Computer Runtime

1. Confirm the Computer exists and has `desired_runtime_status = running`.
2. Call the manager endpoint:

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

Use the same endpoint with a different `action`:

```json
{ "action": "start" }
{ "action": "stop" }
{ "action": "restart" }
{ "action": "status" }
```

`status` describes the ECS service and writes the observed runtime status back to the Computer row.

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

## Phase 2 Limits

- The runtime image is a skeleton loop, not the final Computer-use environment.
- Google Workspace CLI probing is best-effort and does not configure user OAuth by itself.
- ECS service reconciliation is explicit through the manager endpoint; there is no background reconciler yet.
- Browser/computer-use tooling is a follow-on capability once the runtime image is hardened.
