---
title: "External workflow agent-step bridges need resumable ledgers"
date: 2026-06-21
category: architecture-patterns
module: n8n Agent-Step Bridge
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "An external workflow engine calls ThinkWork and waits for an agent result"
  - "A callback or resume URL is supplied by a managed application runtime"
  - "An idempotency key protects visible thread creation or downstream wakeup dispatch"
  - "Operator telemetry must prove progress without exposing raw payloads or secrets"
  - "A deployed smoke needs to prove a managed application path without unsafe default mutation"
related_components:
  - packages/api
  - packages/database-pg
  - plugins/n8n
  - deployment-runner
  - github-actions
  - docs
tags:
  - n8n
  - agent-step
  - bridge-ledger
  - idempotency
  - callback-security
  - telemetry-redaction
  - deployed-smoke
  - thnk-54
---

# External workflow agent-step bridges need resumable ledgers

## Context

THNK-54 added the n8n agent-step bridge: a managed n8n workflow can call
ThinkWork as a durable agent step, hibernate at a stock n8n Wait node, and
resume only after ThinkWork posts a structured result back to n8n. The product
contract was intentionally webhook-first and node-later: stock HTTP Request and
Wait nodes prove the start/resume/result semantics before a custom n8n node or a
workflow-control MCP surface exists.

That contract created a sharper reliability problem than a normal webhook
ingress. ThinkWork had to create a visible Space thread, persist an opening
message, enqueue an agent wakeup, store secret callback material, hold for human
review, retry resume delivery, expire stale waits, and expose operator evidence.
Verification found the risky edges: an arbitrary HTTPS `resumeUrl` could point
outside managed n8n, a partially inserted run row could poison idempotent
replay, and telemetry previews could stringify arbitrary output objects.

The compounding recommendation was **full documentation**. The issue produced a
durable architecture pattern for any future workflow engine bridge, not just
n8n. Related docs covered plugin source boundaries and managed-app lifecycle,
but overlap was low because neither described callback URL policy, resumable
start semantics, redacted bridge telemetry, and opt-in deployed bridge smoke as
one contract. Session history search found the same THNK-54 planning and
implementation arc, with no separate older attempt that changed the conclusion
(session history).

## Guidance

Treat an external workflow agent step as a resumable state machine with a
ledger, not as a one-shot request handler.

### 1. Validate callback URLs against the managed runtime, not just URL syntax

A resume URL is capability-bearing callback material. Basic checks such as
`https:` and no username/password are not enough. The bridge should compare the
callback origin and path against an audited policy source, preferably the
managed application's current desired/runtime configuration.

THNK-54 uses the authenticated managed n8n public URL as that source and only
accepts n8n's waiting-webhook path:

```ts
export function assertN8nAgentStepResumeUrlPolicy(
  resumeUrl: ParsedN8nAgentStepResumeUrl | null,
  managedN8nPublicUrl: string | null,
) {
  if (!resumeUrl) return;
  const managedOrigin = managedN8nOrigin(managedN8nPublicUrl);
  if (!managedOrigin) {
    throw new N8nAgentStepPayloadError(
      "resumeUrl cannot be accepted until the managed n8n public URL is configured",
    );
  }
  if (resumeUrl.origin !== managedOrigin) {
    throw new N8nAgentStepPayloadError(
      "resumeUrl must use the managed n8n public origin",
    );
  }
  if (!isWaitingWebhookPath(resumeUrl.pathname)) {
    throw new N8nAgentStepPayloadError(
      "resumeUrl must use n8n's waiting webhook path",
    );
  }
}

function isWaitingWebhookPath(pathname: string): boolean {
  return (
    pathname === "/webhook-waiting" || pathname.startsWith("/webhook-waiting/")
  );
}
```

The regression test should include both kinds of malicious callback:

- an off-origin URL such as `https://attacker.example.test/not-n8n-waiting`;
- a same-origin but wrong-path URL such as `https://n8n.example.test/not-n8n-waiting`.

Reject both before creating a bridge run, thread, message, wakeup, or secret.

### 2. Make accepted idempotency rows recoverable until every side effect exists

The idempotency ledger is useful only if replay can repair an incomplete start.
An external workflow retry may arrive after the run row exists but before a
secret write, thread creation, opening message, or wakeup queue insert succeeds.
If replay returns that half-built row as final truth, the external workflow can
be stuck forever with no visible thread or queued agent work.

THNK-54 made `accepted` rows and incomplete `waiting` rows resumable:

```ts
function shouldRecoverRunStart(run: RunRow, wakeup: WakeupRow | null): boolean {
  if (run.status === "accepted") return true;
  if (run.status !== "waiting") return false;
  return !run.thread_id || !run.opening_message_id || !wakeup?.id;
}
```

Replay then completes the missing side effects before returning success:

```ts
const existing = await findRunByIdempotencyKey({
  db,
  tenantId: auth.tenantId,
  idempotencyKey,
});
if (existing) {
  assertResumeUrlMatchesExistingRun(existing, payload);
  const wakeup = await findWakeupByIdempotencyKey({
    db,
    tenantId: auth.tenantId,
    agentId: payload.agentId,
    idempotencyKey,
  });
  if (!shouldRecoverRunStart(existing, wakeup)) {
    return replayResult(existing, wakeup);
  }
  return completeRunStart({ ... });
}
```

Keep the original callback host/path on the row and reject replay with different
callback material. Recovery should be idempotent, not an opportunity to swap the
resume target.

### 3. Store callback material as secret material and expose only evidence

The ledger needs enough metadata for audit and troubleshooting, but callback
URLs and raw payloads should not become GraphQL or log data. Store the full
resume URL through the existing secret mechanism and keep only bounded host/path
evidence on the row.

For operator surfaces, publish compact facts: workflow id/name, execution id,
step id, correlation id, status, resume status, timeout, attempt counts, HTTP
status, safe summary, and links. Avoid idempotency keys, tenant IDs, secret refs,
raw request metadata, full result payloads, and callback URLs.

### 4. Never derive telemetry previews by stringifying arbitrary objects

THNK-54's first telemetry implementation looked redacted but still leaked raw
payload content. The resolver tried to build `outputPreview` from
`payloadPreview(row.output_payload ?? row.result_payload)`, and the helper fell
back to `JSON.stringify(value)` for object payloads without a known text key.
That leaked values such as raw output secrets and nested tokens.

The safe rule is: only preview explicitly safe scalar summary fields. Return a
placeholder or `null` for arbitrary structured output.

```ts
function outputPreview(row: RunRow): string | null {
  return bounded(row.summary) ?? resultSummaryPreview(row.result_payload);
}

function resultSummaryPreview(value: unknown): string | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["summary", "preview"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return bounded(candidate);
      }
    }
  }
  return null;
}
```

Add tests with product-reachable arbitrary objects, for example:

```ts
output_payload: { secret: "raw output should not leak" },
result_payload: { output: { secret: "nested raw token" } },
```

Then assert the serialized telemetry response contains neither string.

### 5. Hold human-needed states inside ThinkWork and resume only from terminal states

The external workflow should not have to reimplement ThinkWork's human-review
mechanics. The bridge finalizer should inspect the thread/turn state and choose
one of three actions:

- hold while the agent is running, awaiting a user answer, in review, or blocked;
- move to `resume_pending` with a structured success/failure/expired payload
  when ThinkWork has a terminal outcome;
- no-op if another worker or retry already handled the terminal state.

For human-review flows, re-check after `answerUserQuestion` and terminal thread
status updates. The subtle guard is that answering a question mid-turn should
not resume the external workflow from the asking turn; it should wait for the
resumed agent turn to finish.

### 6. Make resume delivery claim-based and retryable

Resume delivery is a downstream side effect and needs its own idempotency. Use a
conditional claim such as `resume_pending -> resuming`, post the structured
result to the stored callback URL, then record the observed outcome:

- 2xx: mark `resumed`;
- network/timeout/5xx: increment attempts, record the error, and schedule the
  next attempt;
- non-retryable 4xx or missing/malformed secret: mark `resume_failed` with
  operator evidence.

Use a sweeper over indexed rows for expiry instead of one Scheduler object per
run. The same resume helper should deliver normal terminal payloads and expired
payloads.

### 7. Wire deployed smoke as opt-in, fail-closed evidence

For managed application bridges, local unit tests are necessary but not enough.
The smoke needs to prove the deployed path: managed n8n runtime, native n8n MCP
endpoint, ThinkWork bridge endpoint, visible thread/telemetry, and n8n resume.

The safe default is dry-run evidence. THNK-54's smoke exits successfully without
mutating anything unless `SMOKE_ENABLE_N8N_AGENT_STEP_BRIDGE=1` is present. The
dry-run output lists the live prerequisites and assertions. Live mode requires
an explicit disposable trigger or workflow execution context, n8n MCP service
credential, ThinkWork GraphQL/tenant auth, and a unique correlation id.

The deploy workflow wires the smoke only for manual workflow dispatch with
`run_smokes == true`:

```yaml
- name: n8n agent-step bridge smoke
  if: github.event_name == 'workflow_dispatch' && inputs.run_smokes == true
  timeout-minutes: 15
  env:
    SMOKE_ENABLE_N8N_AGENT_STEP_BRIDGE: ${{ secrets.SMOKE_ENABLE_N8N_AGENT_STEP_BRIDGE }}
    SMOKE_N8N_URL: ${{ secrets.SMOKE_N8N_URL }}
    SMOKE_N8N_MCP_URL: ${{ secrets.SMOKE_N8N_MCP_URL }}
    SMOKE_N8N_MCP_SERVICE_TOKEN: ${{ secrets.SMOKE_N8N_MCP_SERVICE_TOKEN }}
    SMOKE_N8N_BRIDGE_TRIGGER_URL: ${{ secrets.SMOKE_N8N_BRIDGE_TRIGGER_URL }}
    SMOKE_N8N_BRIDGE_CORRELATION_ID: deploy-${{ github.run_id }}-${{ github.run_attempt }}
    SMOKE_GRAPHQL_HTTP_URL: ${{ secrets.SMOKE_GRAPHQL_HTTP_URL }}
    SMOKE_TENANT_ID: ${{ secrets.SMOKE_TENANT_ID }}
    API_AUTH_SECRET: ${{ secrets.API_AUTH_SECRET }}
    GRAPHQL_API_KEY: ${{ secrets.GRAPHQL_API_KEY }}
    SMOKE_EVIDENCE_FILE: deploy-artifacts/n8n-agent-step-bridge-smoke.json
  run: node plugins/n8n/smoke/n8n-agent-step-bridge-smoke.mjs
```

This gives operators a real deployed proof path without exposing bearer tokens,
resolved IPs, production secrets, or running surprise workflow mutations during
ordinary CI.

## Why This Matters

External workflow engines retry, wait, and resume differently from ThinkWork's
internal agent runtime. A bridge that only validates JSON and inserts a row can
look correct in happy-path tests while failing in the exact cases operators care
about:

- a malicious or stale callback URL can leak output to the wrong origin;
- a retry can replay a poisoned idempotency key and never create a visible
  ThinkWork thread;
- operator telemetry can accidentally expose raw workflow output;
- human-needed states can strand n8n or resume it too early;
- CI can show green while the deployed managed-app path remains unproven.

The ledger pattern makes each boundary explicit. The run row is the durable
state machine, not a passive audit table. It owns idempotency, callback policy
evidence, thread linkage, human-hold status, retry/expiry state, redacted
telemetry, and smoke correlation.

## When to Apply

- Building a bridge where n8n, Step Functions, Zapier, a CRM workflow engine, or
  another external system asks ThinkWork for agentic work and waits for a
  result.
- Accepting callback URLs, resume URLs, webhooks, or task tokens from a managed
  application runtime.
- Creating visible ThinkWork threads or agent wakeups behind an idempotency key.
- Exposing operator evidence for bridge state, retry attempts, or workflow
  output.
- Adding smoke coverage for a managed app path that needs live credentials or
  disposable workflow targets.

## Examples

### Unsafe start replay

```text
1. Insert bridge run row as accepted.
2. Fail before storing resume URL secret or creating the thread.
3. n8n retries with the same correlation/idempotency key.
4. Handler returns replayed=true with no thread or wakeup.
```

### Safe start replay

```text
1. Insert bridge run row as accepted.
2. Any later side effect may fail.
3. Retry loads the existing row and checks whether thread, opening message, and
   wakeup evidence exist.
4. Missing side effects are completed idempotently.
5. Only a complete run returns as replayed waiting state.
```

### Unsafe telemetry preview

```ts
JSON.stringify({ secret: "raw output should not leak" });
```

### Safe telemetry preview

```ts
row.summary ?? resultPayload.summary ?? resultPayload.preview ?? null;
```

## Related

- Linear: THNK-54, THNK-50, THNK-59.
- PRs: #2750, #2752, #2755, #2757, #2761, #2763, #2768, #2770, #2774.
- Requirements: `docs/brainstorms/2026-06-20-n8n-thinkwork-agent-step-bridge-requirements.md`.
- Plan/status: `docs/plans/2026-06-20-001-feat-n8n-agent-step-bridge-plan.md`,
  `docs/plans/autopilot/THNK-54-status.md`.
- Related solution docs:
  - `docs/solutions/architecture-patterns/plugin-source-boundaries-package-owned-deploy-verified-2026-06-17.md`
  - `docs/solutions/architecture-patterns/managed-app-mcp-oauth-lifecycle-2026-06-06.md`
  - `docs/solutions/architecture-patterns/release-manifest-deployment-status-contract-2026-06-11.md`
