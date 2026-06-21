# Validation And Handoff

Validation passing is necessary, not sufficient. A workflow can validate and
still have wrong wires, missing branches, or unsafe runtime behavior.

## Validation Loop

1. Validate configured nodes when available.
2. Create or update the inactive workflow.
3. Validate the complete workflow.
4. Fix one concrete error at a time, then validate again.
5. Treat warnings as context-sensitive. Production workflows should address
   missing error handling, retry, rate-limit, and credential warnings unless
   there is a clear reason to accept them.

## Verify After Write

After every create or update:

1. Fetch the workflow by id.
2. Confirm workflow id, name, active state, tags, project or folder, trigger
   nodes, credential references, and MCP access state.
3. Inspect `connections` directly. Confirm each expected branch, error output,
   and merge input is wired to the intended node.
4. If multiple workflows match, stop and ask for the exact workflow id or URL.

## Test Evidence

1. Ask before any test that can create records, call external APIs, send
   messages, or mutate production systems.
2. Prefer disposable inputs and read-only endpoints.
3. Record execution ids, failure messages, validation errors, and evidence
   links in the handoff.

## Handoff Checklist

Include workflow id, workflow name, draft/test status, package requirements,
credential assumptions, MCP access state, validation result, connection
verification result, test evidence, and the native n8n UI action required from
the shared operator.
