# Workflow Authoring

Build the smallest inactive draft that proves the requested automation shape,
then validate and verify it before handoff.

## Pattern Choice

1. Manual trigger: use for user-triggered smoke tests and safe demos.
2. Webhook: use when an external system pushes an event.
3. Schedule: use for recurring fetch, report, and maintenance workflows.
4. HTTP API integration: use for read/write calls to external REST APIs.
5. Database sync: use for ETL and record reconciliation.
6. AI agent: use when the workflow needs model reasoning or n8n agent tools.
7. Batch processing: use when item count, pagination, or rate limits matter.

## Construction Rules

1. Prefer HTTP Request nodes over Code nodes for ordinary GET/POST calls.
2. Prefer expressions in the consuming field for simple data mapping.
3. Use `{{ ... }}` expressions in n8n fields. Use direct JavaScript only inside
   Code nodes.
4. Avoid Set/Edit Fields nodes that feed a single consumer; inline the
   expression at the consuming field.
5. For webhook workflows, user payload fields are under `$json.body`, not at
   the root.
6. For branchy workflows, reference upstream nodes by name instead of relying on
   ambiguous `$json` at branch convergence.
7. Search for existing workflows or templates before creating a larger reusable
   workflow from scratch.

## Draft Safety

1. Keep created workflows inactive unless the human explicitly completes
   production activation in the native n8n UI.
2. Prefer disabled copies or disposable draft workflows for edits.
3. Run only read-only or low-risk test executions without additional
   confirmation.
4. Do not trigger a production webhook, schedule, message send, database write,
   or destructive external side effect as a smoke test.

## Code Nodes

Use Code nodes only for multi-item aggregation, allowlisted package use, or
logic that cannot be expressed in fields. For Code nodes, use only packages
declared in the Plugin Detail n8n custom package settings.
