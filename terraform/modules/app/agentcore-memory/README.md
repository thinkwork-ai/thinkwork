# AgentCore Memory — App Module

Provisions an AWS Bedrock AgentCore Memory resource with the four strategies
the ThinkWork AgentCore runtime uses for automatic retention:

| Strategy    | Namespace template               | Purpose                              |
| ----------- | -------------------------------- | ------------------------------------ |
| semantic    | `assistant_{actorId}`            | Cross-thread facts about the user    |
| preferences | `preferences_{actorId}`          | User-stated preferences              |
| summaries   | `session_{sessionId}`            | Per-thread rolling summaries         |
| episodes    | `episodes_{actorId}/{sessionId}` | Episodic memory of past interactions |

Automatic retention is wired through the API's normalized memory layer:
every turn emits a `CreateEvent` (`AgentCoreAdapter.retainTurn`, actor =
the user UUID), and AgentCore's background strategies extract facts into
the namespaces above. Agents read them back via the `recall()` tool, which
fans out over `assistant_{actorId}`, `preferences_{actorId}` and
`user_{actorId}`. There is no need for the model to call `remember()`
explicitly — it only exists for user-driven "please remember X" requests,
and writes direct records into `user_{actorId}`.

**The namespace templates above are a contract**, not an implementation
detail. Readers that must stay in sync:

- `packages/api/src/lib/memory/adapters/agentcore-adapter.ts` (`ACTOR_NAMESPACES`)
- `packages/agentcore-pi/agent-container/src/tools/memory.ts` (`recallNamespaces`)

Changing a template here without changing those makes extraction write
where nothing reads — silent, and invisible until someone notices the
agent has amnesia.

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

- **Ensure**: `data "external"` runs `scripts/create_or_find_memory.sh` on
  every plan and apply. It pages through `list-memories` for candidates
  matching the logical name, probes each one with `get-memory`, and uses the
  first that is ACTIVE (waiting out a `CREATING` one). Safe to re-run.
- **Destroy**: a paired `terraform_data` resource has a destroy-time
  `local-exec` that calls `delete-memory` on the ID captured during create.

## Self-healing

The memory ID this module outputs comes from a **live lookup on every
plan**, never from stored state. If the memory resource is deleted
out-of-band — as happened to `dev` in THINK-404, where SSM still advertised
`AGENTCORE_MEMORY_ID` for a resource `GetMemory` returned
`ResourceNotFound` for — the next plan sees the ID no longer resolves and
the next apply creates a replacement with the same strategy set, waits for
it to reach `ACTIVE`, and rewires the runtime to it. No import, no state
surgery, no manual `create-memory`.

Two invariants keep that safe:

- **The ensure path never deletes.** Candidates in `DELETING` or `FAILED`
  are skipped, not cleaned up. Deletion happens only through the
  destroy-time provisioner.
- **Healing is not a replacement.** The destroy provisioner's
  `triggers_replace` is keyed on the memory name and region, not the ID, so
  recovering a new ID for the same logical memory can't fire a delete.

The cost of healing is the records: a recreated memory starts empty.
Extraction refills it from subsequent conversations; nothing recovers the
old records, because AgentCore has no export of a deleted memory.

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
