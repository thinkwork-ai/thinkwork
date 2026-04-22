# ADR: Per-tenant AWS resource fan-out pattern

**Status:** Accepted, 2026-04-22
**First instance:** [docs/plans/2026-04-22-006-feat-agentcore-code-sandbox-plan.md](../plans/2026-04-22-006-feat-agentcore-code-sandbox-plan.md) (AgentCore Code Sandbox)

## Context

ThinkWork is onboarding toward 4 enterprises × 100+ agents × ~5 templates. A subset of features requires AWS resources *per tenant* — per-tenant AgentCore Code Interpreter + tenant-scoped IAM role is the forcing case because the trust boundary is enforced by the cloud service, not by app-layer filtering. Terraform's `data.external` precedent (`terraform/modules/app/agentcore-memory/main.tf`) is stage-scoped: running terraform per tenant is intractable at 100+ tenants and couples tenant lifecycle to CI. We need a repeatable runtime fan-out pattern future features can cite.

## Decision

Per-tenant AWS resources are provisioned at **runtime**, by a **single-purpose admin Lambda** invoked **synchronously** from the tenant-lifecycle mutation, with a **scheduled reconciler** as the catch-up + drift backstop.

### When to use per-tenant fan-out

Only when the service enforces per-tenant isolation that stage-shared resources cannot express — cross-tenant IAM trust boundary, per-tenant quota accounting, or vendor-enforced per-tenant allocation. Everything else stays stage-shared.

### Provisioning shape

1. Mutation `INSERT`s the tenant row with nullable resource-ID columns.
2. Mutation invokes the admin Lambda `RequestResponse`, ~45s timeout (per `feedback_avoid_fire_and_forget_lambda_invokes`).
3. Lambda does list-then-create (idempotent), writes IDs back.
4. On timeout or partial failure the mutation returns the tenant row with null IDs; downstream consumers gate on *ID present* independently of any policy flag so provisioning state and policy state are structurally decoupled.

### Reconciler (EventBridge scheduled)

Same Lambda is invoked periodically with two passes: **fill** (populate null IDs) and **drift** (list actual cloud resources, null columns pointing at deleted IDs so the next fill repopulates).

### Destroy-path symmetry

Every create handler ships with a `deprovision` handler *and* a scheduled orphan GC. The GC cross-references cloud tags (`TenantId`, `Stage`) against the `tenants` table; name-pattern matching alone is not acceptable — substring stage collisions can cross-delete production resources.

### Quota monitoring

When a service has a per-account ceiling (AgentCore Code Interpreter: 1000/account), monitor `tenant_count × per-tenant_allocation`. **Request quota increase at 10% of ceiling**, not at pressure. Isolate CI churn from production stacks where possible.

### Naming

`thinkwork-{stage}-{feature}-tenant-{tenant_id_suffix}`, truncated to service-specific length limits (IAM: 64 chars). `tenant_id_suffix` must be deterministic.

## Alternatives considered

- **Stage-shared resource + app-layer tenancy** — preferred default. Rejected for Code Interpreter because AgentCore's IAM trust is per-interpreter; app-layer filtering cannot stop cross-tenant credential exfil from a compromised session.
- **`data.external` terraform per tenant** — stage-scoped by design; forces a terraform run on every tenant create, and doesn't compose with an application-driven tenant lifecycle.
- **Lambda/Fargate code-exec substrate instead of AgentCore** — technically viable but rebuilds tenant-scoped IAM, session management, egress policy, and the pip/base-image supply chain by hand. The only reason fan-out is required *at all* is AgentCore's 1000-per-account quota; a Lambda-based sandbox would collapse to a stage-shared substrate at the cost of the managed-sandbox guarantees. Revisit if the 1000 ceiling becomes structural rather than addressable.

## Consequences

- Every per-tenant feature ships two handlers (provision + deprovision), one scheduled reconciler, and one orphan GC.
- Tenant-lifecycle mutations gain a synchronous Lambda hop but do not block on success — callers tolerate null IDs.
- Quota ceilings become first-class ops concerns, tracked explicitly.
- Future candidates: per-tenant wiki compile, per-tenant eval fleet, per-tenant MCP servers. This ADR is the precedent they cite.
