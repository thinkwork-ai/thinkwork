# Hindsight Memory Module (canonical user and Space memory)

Thinkwork provisions AgentCore managed memory as an AWS platform primitive, but
full ThinkWork installs use **Hindsight** as the canonical user and Space memory
provider. AgentCore-only memory remains available as an explicit
low-cost/development opt-out.

## Memory layers

| Layer                 | Backend                 | Always on                     | What it stores                                                                 |
| --------------------- | ----------------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| 1. Workspace files    | S3 per-agent            | Yes                           | Scratchpad, working files                                                      |
| 2. Thread history     | Aurora `messages` table | Yes                           | Last 30 turns per thread                                                       |
| 3a. Managed long-term | AgentCore Memory        | **Yes**                       | AWS platform memory primitive and low-cost/development fallback                |
| 3b. Product long-term | Hindsight ECS service   | **Default for full installs** | Canonical user/Space memory with entity graph + BM25 + cross-encoder reranking |

## How retention works

The agent container automatically emits a `CreateEvent` into AgentCore
Memory after every turn (user message + assistant response), via
`memory.store_turn_pair` in `packages/agentcore/agent-container/memory.py`.
AgentCore's background strategies extract facts into four namespaces:

- `assistant_{actorId}` — semantic facts
- `preferences_{actorId}` — user preferences
- `session_{sessionId}` — session summaries
- `episodes_{actorId}/{sessionId}` — episodic memory

The agent reads them back via the `recall()` tool. There is no need for
the model to call `remember()` for routine facts — it only exists for
user-driven "please remember X" requests.

When Hindsight is enabled, the container ALSO registers
`hindsight_retain`, `hindsight_recall`, and `hindsight_reflect` tools that
route to the Hindsight service. `remember()` dual-writes to both backends
so explicit memories land in both systems.

## Usage

### Default — Hindsight canonical memory

```hcl
module "thinkwork" {
  source = "thinkwork-ai/thinkwork/aws"

  stage = "prod"
  # enable_hindsight defaults to true
}
```

The `terraform/modules/app/agentcore-memory` module is still instantiated, but
the active user/Space memory engine resolves to Hindsight.

### Low-cost/development AgentCore-only opt-out

```hcl
module "thinkwork" {
  source = "thinkwork-ai/thinkwork/aws"

  stage            = "prod"
  enable_hindsight = false
  memory_engine    = "agentcore"

  # This is not the full product memory path.
}
```

When `enable_hindsight = true`, Terraform creates:

- ECS Fargate cluster + service (ARM64, 2 vCPU, 4 GB)
- Application Load Balancer
- Security groups (ALB → Hindsight → Aurora ingress)
- CloudWatch log group

Cost: ~$75/mo (ARM64 Fargate + ALB hours).

## Turning Hindsight on/off

Toggling `enable_hindsight` and re-running `thinkwork deploy`:

- **false → true**: creates the ECS + ALB infra. Agents gain the three
  `hindsight_*` tools on their next invoke. The active memory engine resolves
  to Hindsight when `memory_engine` is empty.
- **true → false**: destroys the ECS + ALB infra. Agents lose the
  `hindsight_*` tools. This should be paired with `memory_engine = "agentcore"`
  for explicit low-cost/development deployments.

Memory data is not migrated between backends. Hindsight records and
AgentCore records live in separate stores.
