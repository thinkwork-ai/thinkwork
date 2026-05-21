---
name: runbook-execution-contract
description: Contract for agent turns running a ThinkWork runbook task
license: Proprietary
contract: system
activates_on:
  runbook_active: true
---

## Runbook Execution Context

A ThinkWork runbook is active. The runbook definition is the source
of truth; Strands is only the execution target. Execute exactly the
current task, preserve the runbook phase/task semantics, and pass
task outputs forward through the runtime instead of inventing a
separate workflow.
