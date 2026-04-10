# Memory Engine Module

Thinkwork supports pluggable long-term memory for agents. Choose the engine that fits your stage and requirements.

## Engines

| Engine | `memory_engine` value | Best for | Extra infra | Cost |
|--------|----------------------|----------|-------------|------|
| **AgentCore Managed** | `managed` (default) | All stages. Production-ready, zero-config. | None | $0 additional |
| **Hindsight** | `hindsight` | Advanced recall/reflect with entity graph, cross-encoder reranking. | ECS Fargate + ALB | ~$75/mo (ARM64) |

Both engines provide agents with memory tools. The Strands runtime reads `MEMORY_ENGINE` and loads the right tool set:

- **Managed**: `remember()`, `recall()`, `forget()` — backed by AgentCore Memory API with 4 strategies (semantic facts, user preferences, session summaries, episodic).
- **Hindsight**: `hindsight_retain()`, `hindsight_recall()`, `hindsight_reflect()` — backed by the Hindsight service with semantic + BM25 + entity graph + temporal retrieval and cross-encoder reranking.

## What's pluggable

Only **Layer 3 (long-term cross-thread memory)** is pluggable. The other memory layers are core infrastructure:

- **Layer 1** — Workspace files on S3 (per-agent scratchpad). Always available.
- **Layer 2** — Thread history in Aurora (conversation memory). Always available.
- **Layer 3** — Long-term cross-thread recall. **This is what `memory_engine` controls.**

## Usage

### Managed (default — no extra config needed)

```hcl
module "thinkwork" {
  source = "thinkwork-ai/thinkwork/aws"

  stage      = "prod"
  # memory_engine defaults to "managed" — nothing to set
}
```

### Hindsight (opt-in)

```hcl
module "thinkwork" {
  source = "thinkwork-ai/thinkwork/aws"

  stage         = "prod"
  memory_engine = "hindsight"

  # Optional: pin the Hindsight image version
  # hindsight_image_tag = "0.4.22"
}
```

When `memory_engine = "hindsight"`, Terraform creates:
- ECS Fargate cluster + service (ARM64, 2 vCPU, 4 GB)
- Application Load Balancer
- Security groups (ALB → Hindsight → Aurora ingress)
- CloudWatch log group

When `memory_engine = "managed"`, none of the above is created.

## Switching engines

Changing `memory_engine` and running `thinkwork deploy` will:
- **managed → hindsight**: Create the ECS/ALB infrastructure. Agents start using Hindsight tools on next invoke.
- **hindsight → managed**: Destroy the ECS/ALB infrastructure. Agents fall back to AgentCore memory tools.

Memory data is not migrated between engines. Each engine has its own storage backend.
