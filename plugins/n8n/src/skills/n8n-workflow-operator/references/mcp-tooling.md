# MCP Tooling

Use live n8n MCP tools as the source of truth for tool names, argument shapes,
node schemas, and current `typeVersion` values.

## Tool Selection

1. Search for nodes before configuring them.
2. Read the node schema before setting parameters. Standard detail is enough for
   most nodes; use deeper docs only when the required field is unclear.
3. Validate nodes or workflows as soon as the tool surface supports it.
4. Prefer partial workflow updates for edits to existing workflows. Include a
   short intent when the tool accepts one.
5. Fetch the workflow after create/update and inspect `connections`.

## Node Type Formats

Use the form expected by the tool being called:

1. Node discovery and node validation tools use short forms, for example
   `nodes-base.httpRequest`.
2. Workflow JSON uses full forms, for example
   `n8n-nodes-base.httpRequest`.
3. If a tool returns both forms, carry both forward instead of reconstructing
   from memory.

## Credentials And Secrets

1. Never emit fake credential ids such as `REPLACE_ME`.
2. If the real credential id is unknown, omit the `credentials` block so the
   native UI can show a usable selector.
3. Never put tokens, API keys, or passwords in Set nodes, Code nodes,
   expressions, or plain text fields. Use the n8n credential system.
4. The ThinkWork agent-step bridge credential is separate from the n8n MCP
   service credential.

## Shortened Tool Names

The ThinkWork runtime may expose long MCP tool names in shortened form. Choose
tools by descriptions and parameter schemas, not memorized exact names.
