---
title: Plane-style managed apps need compact topology and product-path verification
date: 2026-06-16
category: architecture-patterns
module: Plane Application Plugin / Deployment Runner
problem_type: architecture_pattern
component: tooling
severity: high
applies_when:
  - "A self-hosted third-party application is packaged as a ThinkWork Application Plugin"
  - "The upstream app has optional or reference services that should not become managed dependencies by default"
  - "The app exposes MCP tools that must run under the current user's credentials"
  - "Verification must prove install, routing, agent use, and teardown through the deployed ThinkWork path"
related_components:
  - terraform
  - plugin-catalog
  - deployment-runner
  - mcp-runtime
  - agentcore-pi
tags:
  - plane
  - managed-apps
  - application-plugins
  - terraform
  - mcp
  - agentcore
  - verification
  - thnk-27
---

# Plane-style managed apps need compact topology and product-path verification

## Context

THNK-27 added Plane as a curated Application Plugin: ThinkWork installs a
self-hosted Plane runtime in AWS, registers a Plane MCP server, installs a
Plane issue-loop skill, and lets agents act through the current user's Plane
activation. The durable learning is not simply "Plane works." The useful
pattern is how the deployment contract was narrowed and how completion was
proved.

Plane's upstream self-hosting shape can pull an implementation toward
multi-service infrastructure. During the THNK-27 rollout, an early deployment
attempt started down that path with managed Redis/RabbitMQ resources. Eric
caught the mismatch, the apply was stopped, and the module was corrected to one
ECS service and one task definition containing Plane AIO, Plane MCP, and
task-local Redis/RabbitMQ sidecars. That correction became a stop-the-line gate
in AGENTS.md, the Plane manifest, the Terraform module, the deployment-runner
adapter, and fixture tests.

The verification trail also exposed several product-path gaps (session
history). Cloudflare DNS had to be created by the managed-app runner, not by a
manual shortcut. ALB MCP routing had to split OAuth/discovery paths from stream
paths because AWS listener conditions have path-count limits. Listener rule
priorities needed non-conflicting values for replacement-safe upgrades. Plane
PAT activation had to be sent as bearer auth plus `x-workspace-slug`, not as
the older `x-api-key` header. Finally, the deployed `chat-agent-invoke` Lambda
initially handed both `twenty--crm` and `plane--issues` to Pi because a prompt
that said "Do not use Twenty CRM tools" was treated as a positive Twenty
mention; PR #2538 fixed negative plugin mentions and the deploy target so the
Lambda could not stay stale.

## Guidance

Package self-hosted application plugins as a product contract with explicit
topology, identity, routing, and proof gates.

### 1. Choose the smallest supported runtime topology and encode it everywhere

For Plane v1, the accepted runtime is one ECS service and one ECS task
definition with four containers:

```text
plane task
  plane-app       Plane all-in-one app runtime
  plane-mcp       Plane MCP server
  plane-redis     task-local loopback Redis sidecar
  plane-rabbitmq  task-local loopback RabbitMQ sidecar
```

`REDIS_URL` and `AMQP_URL` stay on the app container, but they point to
`127.0.0.1` sidecars:

```hcl
{ name = "REDIS_URL", value = "redis://127.0.0.1:${var.redis_container_port}" }
{ name = "AMQP_URL", value = "amqp://${var.rabbitmq_username}:${var.rabbitmq_password}@127.0.0.1:${var.rabbitmq_container_port}/${var.rabbitmq_vhost}" }
```

That keeps the AIO runtime honest without turning Plane into a fleet of
speculative AWS dependencies. If a future runtime proves the compact shape
cannot satisfy the app contract, treat that as an exception: record the
evidence, rationale, and resource impact on the owning issue before changing
the topology.

### 2. Put the topology contract in tests, docs, and plan review gates

Do not rely on one README sentence to protect the shape. THNK-27 hardened the
contract in several places:

- `AGENTS.md` stops Plane plans that include `aws_mq_broker`,
  `aws_elasticache_*`, `aws_opensearch*`, separately managed Redis/RabbitMQ, or
  more than one Plane ECS service without an evidence-backed exception.
- `plugins/plane/src/manifest.ts` describes the compact task-local sidecar
  contract and the per-user bearer/header auth mode.
- `terraform/modules/app/plane/main.tf` starts with the same compact-topology
  warning and models the four-container task.
- `apps/cli/__tests__/terraform-plane-fixture.test.ts` and deployment-runner
  fixture tests guard against accidental reintroduction of managed dependencies
  or multi-service Plane topology.

This is especially important for third-party apps because a future maintainer
may copy an upstream reference topology and accidentally broaden the resource
surface.

### 3. Route app UI and MCP on the same canonical host deliberately

Plane settled on `https://plane.thinkwork.ai` as the user-facing app URL. The
app traffic is the default ALB route; MCP and OAuth/discovery paths route to
the MCP sidecar on the same host:

```hcl
mcp_oauth:
  priority: 12
  paths:
    - "/.well-known/*"
    - "/authorize"
    - "/http/*"
    - "/register"
    - "/token"

mcp_stream:
  priority: 11
  paths:
    - "/header/mcp"
    - "/header/mcp/*"
    - "/mcp"
    - "/mcp/*"
```

Keep AWS limits and replacement behavior in the design, not in the incident
response. The THNK-27 rollout first hit the path-values-per-condition limit,
then hit `PriorityInUse` during listener replacement. Splitting the rules and
assigning stable non-conflicting priorities made the same-host design
deployable.

### 4. Keep infrastructure lifecycle separate from user MCP activation

The application plugin installs and operates Plane. It does not provide a
tenant-wide Plane credential for user-scoped agent work.

Plane MCP activation uses the current user's PAT as bearer auth plus the
workspace slug as an auxiliary header:

```ts
auth: {
  mode: "user-provided-headers",
  bearer: {
    credentialKey: "apiKey",
    displayName: "Plane personal access token",
    secret: true,
  },
  headers: [
    {
      name: "x-workspace-slug",
      credentialKey: "workspaceSlug",
      displayName: "Plane workspace slug",
    },
  ],
}
```

This follows the managed-app/MCP split documented for Twenty: infrastructure
lifecycle and user credentials are separate state machines.

### 5. Verify through the deployed product path before calling the issue done

For application plugins, Terraform success is not the finish line. THNK-27 was
only done after the deployed ThinkWork path proved:

- Plane installed through the managed Application Plugin flow.
- Generated Terraform evidence showed the compact one-service shape.
- Teardown also ran through ThinkWork and cleanup was observed.
- The live Plane app and MCP endpoint were reachable on
  `https://plane.thinkwork.ai`.
- The current user's Plane MCP activation could read Plane project data,
  create a new work item, update a work item, and read the update back through
  a ThinkWork agent.
- `chat-agent-invoke` logs showed the runtime built authorized MCP configs,
  narrowed the Plane prompt to `plane--issues`, and invoked Pi with `mcp=1`.

The final evidence for THNK-27 included project `thinkwork / THINK`, created
work item `THINK-10`, UUID `c7784cc3-1e4f-470b-af43-2daf36bf0ebe`, and a
write-back read after updating the description.

## Why This Matters

Self-hosted plugins sit at an awkward boundary: they look like ordinary app
infrastructure, but they become agent tools once installed. If the topology is
too broad, every install carries unnecessary operational cost and teardown
risk. If the topology is too informal, a later PR can reintroduce managed
RabbitMQ, Valkey, OpenSearch, or extra ECS services without proving they are
needed.

The product-path verification matters for the same reason. A local Docker
Compose run, direct Terraform apply, or raw MCP smoke can prove pieces of the
system, but it cannot prove the customer experience ThinkWork owns:
install/plan/apply evidence, canonical URL, MCP registration, per-user
activation, runtime routing into Pi, agent tool use, and teardown. THNK-27 only
became trustworthy after the same deployed thread that a user would use could
read, create, and update Plane work items.

The negative-plugin-mention bug is a useful reminder that MCP routing is part
of plugin correctness. It is not enough for the right tool to be available; Pi
must receive the right tool list for the user's intent. A prompt that says
"Use Plane and do not use Twenty" should exclude Twenty, not preserve it
because the word "Twenty" appears.

## When to Apply

- Packaging Plane, Twenty-like, or Company Brain-like third-party runtimes as
  Application Plugins.
- Reviewing Terraform plans for self-hosted apps where upstream docs mention
  Redis, RabbitMQ, Elasticsearch, workers, or multiple service roles.
- Adding an MCP sidecar or MCP route to a managed application.
- Verifying an application plugin whose value depends on agent use, not only
  endpoint health.
- Debugging prompts where several user-authorized MCP servers exist but the
  agent should use only one of them.

Do not apply this pattern to cases where a managed dependency is already a
proved product requirement. In those cases, document the evidence and make the
managed dependency part of the plugin contract rather than treating it as an
incidental copy of upstream reference architecture.

## Examples

Good Plane-style plugin gate:

```text
Plugin install
  -> managed-app deployment job
  -> plan evidence: one ECS service/task, no MQ/ElastiCache/OpenSearch
  -> app URL and MCP path on one host with explicit ALB rules
  -> per-user bearer/header activation
  -> deployed ThinkWork agent reads, creates, updates, and re-reads via MCP
  -> teardown through managed-app lifecycle
```

Poor plugin gate:

```text
Terraform module works locally
  -> deploys separate Redis/RabbitMQ because upstream compose mentions them
  -> manually creates DNS or bypasses managed-app evidence
  -> verifies MCP with a raw PAT curl
  -> declares done before a ThinkWork agent uses the user's activation
```

Focused routing regression:

```text
User prompt:
  "Use Plane to create a work item. Do not use Twenty CRM tools."

Expected runtime handoff:
  authorized configs: twenty--crm, plane--issues
  requested plugin: plane
  excluded plugin: twenty
  Pi payload: mcp=1, plane--issues only
```

## Related

- [THNK-27: Add Plane Plugin](https://linear.app/thinkworkai/issue/THNK-27/add-plane-plugin)
- [PR #2506: stabilize Plane managed app deployment](https://github.com/thinkwork-ai/thinkwork/pull/2506)
- [PR #2538: respect negated plugin mcp mentions](https://github.com/thinkwork-ai/thinkwork/pull/2538)
- [Plane application plugin requirements](../../brainstorms/2026-06-14-plane-application-plugin-requirements.md)
- [Plane application plugin plan](../../plans/2026-06-14-006-feat-plane-application-plugin-plan.md)
- [Managed applications should reconcile MCP connectors and keep user OAuth separate](./managed-app-mcp-oauth-lifecycle-2026-06-06.md)
- [GitHub-free customer deployments use an AWS-native bootstrap-to-control-plane pattern](./github-free-customer-deployments-aws-control-plane-pattern-2026-06-06.md)
