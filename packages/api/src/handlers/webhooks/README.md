# Webhook ingress pattern

This directory implements the shared webhook handler pattern from Unit 8 of the
composable-skills plan (decision **D7b**). External integrations — CRM, task
systems, Slack, GitHub, inbound email — trigger composition runs by POSTing
here instead of each one standing up its own bespoke Lambda.

A new integration should land in well under 100 lines of TypeScript.

## Route shape

```
POST /webhooks/{integration}/{tenantId}
```

`{integration}` is the integration slug (`crm-opportunity`, `task-event`, …).
`{tenantId}` is the receiving tenant's UUID — it scopes the signing secret and
feeds into the `skill_runs.tenant_id` column.

## Security model

Each integration Lambda is public (no bearer token — the signature IS the
auth), but it enforces three layers:

1. **HMAC-SHA256 signature** over the raw request body, using a per-(tenant,
   integration) signing secret stored in Secrets Manager at
   `thinkwork/tenants/{tenantId}/webhooks/{integration}/signing-secret`.
   The header is `x-thinkwork-signature: sha256=<hex>`; we accept bare hex
   too for vendors that don't prefix.
2. **Tenant scoping.** The URL's `{tenantId}` bounds which signing secret is
   looked up. A leaked secret for tenant A does not let a caller act as
   tenant B because tenant B's secret is a different key — signature
   verification fails before the resolver ever runs.
3. **Server-side actor identity.** Webhook-triggered runs always use the
   tenant's system-user UUID (`tenant_system_users` table, one row per
   tenant, compiled-in scope = invoke-composition-only). The vendor payload
   CANNOT specify which user to act as; `_shared.ts` sets the actor from
   `ensureTenantSystemUser(tenantId)` and no caller-provided field
   influences it. This is the inversion of `resolveCaller` — deliberate, per
   the `service-endpoint-vs-widening-resolvecaller-auth` best-practices doc.

## Adding a new integration in three steps

### 1. Create the handler file

```ts
// packages/api/src/handlers/webhooks/slack-event.ts
import { createWebhookHandler, type WebhookResolveResult } from "./_shared.js";

export async function resolveSlackEvent(args: {
  tenantId: string;
  rawBody: string;
  headers: Record<string, string>;
}): Promise<WebhookResolveResult> {
  const payload = JSON.parse(args.rawBody);

  if (payload.type !== "message.im") {
    return { ok: true, skip: true, reason: "not a DM event" };
  }
  if (!payload.userId) {
    return { ok: false, status: 400, message: "userId required" };
  }
  return {
    ok: true,
    skillId: "slack-dm-triage",
    inputs: {
      slackUserId: payload.userId,
      text: payload.text,
    },
  };
}

export const handler = createWebhookHandler({
  integration: "slack-event",
  resolve: (args) => resolveSlackEvent(args),
});
```

### 2. Register the Lambda in Terraform

`terraform/modules/app/lambda-api/handlers.tf`:

```hcl
resource "aws_lambda_function" "handler" {
  for_each = local.use_local_zips ? toset([
    # … existing handlers …
    "webhook-slack-event",
  ]) : toset([])
  # rest unchanged — common_env + handler_extra_env propagate automatically
}

locals {
  api_routes = local.use_local_zips ? {
    # … existing routes …
    "POST /webhooks/slack-event/{tenantId}" = "webhook-slack-event"
  } : {}
}
```

### 3. Wire the bundler

`scripts/build-lambdas.sh`:

```bash
build_handler "webhook-slack-event" \
  "$REPO_ROOT/packages/api/src/handlers/webhooks/slack-event.ts"
```

That's all. The helper owns HMAC verification, signing-secret fetch, rate
limiting, `tenant_system_users` bootstrap, dedup via the partial unique
index, and the RequestResponse invoke at `agentcore-invoke`.

## Resolver responsibilities

The resolver is the one thing that varies per integration. It takes
`{ tenantId, rawBody, headers }` and returns a `WebhookResolveResult`:

| Return shape | Meaning | Response |
|--------------|---------|----------|
| `{ ok: true, skillId, inputs }` | Start a composition run | 200 `{runId, deduped}` |
| `{ ok: true, skip: true, reason }` | Authenticated but no action needed | 200 `{skipped, reason}` |
| `{ ok: false, status, message }` | Payload malformed / cross-tenant | `status` + error envelope |

Reconciler integrations (like `task-event`) additionally set
`triggeredByRunId` so the new run links back to the run whose composition
spawned the completed task. That link is what powers the reconciler loop
query in the admin UI (R13).

## Rotation and rollout

- **Bootstrapping a signing secret for a new tenant:** create the Secrets
  Manager entry at the exact path above; the handler reads it lazily on
  the first request. No admin UI in v1 — this is an operator task.
- **Rotation:** overwrite the Secrets Manager value. In-flight requests
  using the old secret will fail; the vendor's retries pick up the new
  secret on the next attempt. Plan rotations for low-traffic windows.
- **Revocation:** delete the Secrets Manager entry. Subsequent requests
  fail closed with `401 Unauthorized` — no tenant enumeration in the
  error body.

## Observability

Every inbound request that passes signature verification inserts a row in
`skill_runs` with `invocation_source = 'webhook'`. The admin UI (Unit 7)
filters by invocation source so operators can watch webhook traffic
separately from chat-driven runs. Rejected requests (bad signature, rate
limit, malformed payload) are logged at the handler level only — we
intentionally don't insert audit rows for unauthenticated traffic to
avoid a log-injection surface.

## References

- `docs/plans/2026-04-21-003-feat-composable-skills-with-learnings-plan.md` — Unit 8 scope + D7b decision.
- `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md` — why the webhook path is its own auth surface.
- `docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md` — why `_shared.ts` imports from `graphql/utils.js` rather than re-inlining.
- `packages/database-pg/src/schema/tenant-system-users.ts` — actor identity schema.
- `packages/database-pg/src/schema/skill-runs.ts` — run row shape + dedup index.
