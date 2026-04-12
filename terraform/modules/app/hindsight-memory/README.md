# Hindsight Memory Module (optional add-on)

Thinkwork has two long-term memory systems. **AgentCore managed memory is
always on** — every agent gets automatic per-turn retention out of the box
with zero configuration. **Hindsight is an optional add-on** you can layer
on top for advanced semantic + entity-graph retrieval.

## Memory layers

| Layer | Backend | Always on | What it stores |
|-------|---------|-----------|----------------|
| 1. Workspace files | S3 per-agent | Yes | Scratchpad, working files |
| 2. Thread history | Aurora `messages` table | Yes | Last 30 turns per thread |
| 3a. Managed long-term | AgentCore Memory | **Yes** | Semantic facts, preferences, summaries, episodes — extracted automatically from every turn |
| 3b. Hindsight long-term | Hindsight ECS service | **Optional** | Same purpose as 3a, plus entity graph + BM25 + cross-encoder reranking |

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

### Default — managed memory only (zero config)

```hcl
module "thinkwork" {
  source = "thinkwork-ai/thinkwork/aws"

  stage = "prod"
  # enable_hindsight defaults to false — nothing else to set
}
```

The `terraform/modules/app/agentcore-memory` module is always instantiated
and provisions the AgentCore Memory resource with the four strategies.

### With the Hindsight add-on

```hcl
module "thinkwork" {
  source = "thinkwork-ai/thinkwork/aws"

  stage            = "prod"
  enable_hindsight = true

  # Optional: pin the Hindsight image version
  # hindsight_image_tag = "0.5.0"
}
```

When `enable_hindsight = true`, Terraform creates:
- ECS Fargate cluster + service (ARM64, 2 vCPU, 4 GB)
- Application Load Balancer
- Security groups (ALB → Hindsight → Aurora ingress)
- CloudWatch log group

Cost: ~$75/mo (ARM64 Fargate + ALB hours).

## Turning the add-on on/off

Toggling `enable_hindsight` and re-running `thinkwork deploy`:

- **false → true**: creates the ECS + ALB infra. Agents gain the three
  `hindsight_*` tools on their next invoke. Managed retention continues
  running unchanged.
- **true → false**: destroys the ECS + ALB infra. Agents lose the
  `hindsight_*` tools. Managed memory keeps working as before.

Memory data is not migrated between backends. Hindsight records and
AgentCore records live in separate stores.
