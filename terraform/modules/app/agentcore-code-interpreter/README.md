# `agentcore-code-interpreter` — stage-level sandbox substrate

Stage-scoped substrate for the AgentCore Code Interpreter sandbox. **Per-tenant
Code Interpreter instances are created at runtime** by the `agentcore-admin`
Lambda (see `docs/adrs/per-tenant-aws-resource-fanout.md`) — this module
stops at the stage-level pieces everything else depends on.

## What it provides

The module creates no AWS resources today; it is a typed catalog + policy-template
surface consumed by the provisioning Lambda and by downstream modules:

- `environment_ids` + `environments` — the environment catalog (`default-public`,
  `internal-only`, `capability-private`) with network modes.
- `tenant_role_trust_policy_template` / `tenant_role_inline_policy_template` —
  JSON templates the provisioning Lambda substitutes `{tenant_id}` into at
  `CreateRole` time (plan Unit 5).
- `capability_private_role_inline_policy_template` — logs-only policy for the
  THINK-280 U4 capability-private interpreter role.
- `capability_private_subnet_ids` / `capability_private_security_group_ids` —
  pass-through of the broker's no-NAT VPC placement (empty when the broker is
  disabled); wired into the `agentcore-admin` module.

## No custom sandbox image (THINK-617)

This module used to own an ECR repo (`thinkwork-{stage}-sandbox-base`), a
`Dockerfile.sandbox-base` (Python 3.12 + pinned libs + a `sitecustomize.py`
stdio scrubber) and a CI build script. **AgentCore Code Interpreter cannot use
a custom image** — `CreateCodeInterpreterRequest` has no image/container
parameter (verified against `@aws-sdk/client-bedrock-agentcore-control`
3.1103.0), and `agentcore-admin` has only ever created interpreters on the
AWS-managed image.

The practical need (openpyxl et al. in the sandbox) is covered by the runtime's
on-demand install preamble — `ON_DEMAND_LIBRARIES` in
`packages/agentcore-pi/agent-container/src/runtime/tools/execute-code.ts`.

Consequence for log scrubbing: the value-based in-image redactor never ran in
production. The `sandbox-log-scrubber` CloudWatch subscription filter
(pattern-based, known OAuth token shapes) is the only scrubbing layer.

## What this module does **not** do

- Create per-tenant Code Interpreter instances — that's the `agentcore-admin` Lambda.
- Build or push any container image.
