# AgentCore Memory — App Module

Provisions an AWS Bedrock AgentCore Memory resource with the four strategies
the thinkwork Strands agent container uses for automatic retention:

| Strategy    | Namespace template           | Purpose                                  |
|-------------|------------------------------|------------------------------------------|
| semantic    | `assistant_{actorId}`        | Cross-thread facts about the user        |
| preferences | `preferences_{actorId}`      | User-stated preferences                  |
| summaries   | `session_{sessionId}`        | Per-thread rolling summaries             |
| episodes    | `episodes_{actorId}/{sessionId}` | Episodic memory of past interactions |

Automatic retention is wired in the agent container: every turn emits a
`CreateEvent` via `memory.store_turn_pair`, and AgentCore's background
strategies extract facts into the namespaces above. Agents can read them
back via the `recall()` tool (also always registered). There is no need for
the model to call `remember()` explicitly — it only exists for user-driven
"please remember X" requests.

## Usage

```hcl
module "agentcore_memory" {
  source = "../app/agentcore-memory"

  stage  = var.stage
  region = var.region
  # Optional: skip provisioning and reuse an existing memory resource
  # existing_memory_id = "my-pre-existing-memory-id"
}

module "agentcore" {
  source              = "../app/agentcore-runtime"
  # ...
  agentcore_memory_id = module.agentcore_memory.memory_id
}
```

## Why a shell script and not a first-class resource?

The AWS Terraform provider does not (yet) expose a
`aws_bedrockagentcore_memory` resource. Until it does, this module drives
the lifecycle through the `aws bedrock-agentcore-control` CLI:

- **Create/find**: `data "external"` runs `scripts/create_or_find_memory.sh`,
  which is idempotent — it looks up an existing memory by name before
  creating a new one. Safe to re-run.
- **Destroy**: a paired `terraform_data` resource has a destroy-time
  `local-exec` that calls `delete-memory` on the ID captured during create.

When the AWS provider adds a native resource, migrate by importing the
existing memory ID into the new resource and removing this module's
external data source.

## Requirements

- `aws` CLI v2 with `bedrock-agentcore-control` commands (recent versions)
- `jq` in PATH
- IAM permissions:
  - `bedrock-agentcore-control:ListMemories`
  - `bedrock-agentcore-control:CreateMemory`
  - `bedrock-agentcore-control:DeleteMemory`

## Cost

AgentCore Memory charges per CreateEvent and per memory record extracted.
With automatic retention enabled, cost scales roughly linearly with chat
volume. Budget accordingly before enabling in production.

## Migration notes

- **Strategies are immutable after creation.** If you need to change a
  namespace template, you must delete and recreate the memory (losing all
  records). Version the `name_prefix` or `stage` if you need to keep the
  old records around during migration.
- **BYO memory**: pass `existing_memory_id = "..."` to skip provisioning
  entirely. Useful for shared memory across multiple stages.
