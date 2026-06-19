---
name: n8n--workflow-operator
description: Work with the tenant n8n instance through ThinkWork's managed n8n MCP tools. Use when a request names n8n, workflows, executions, Code node packages, workflow migration, or automation drafts.
---

# n8n workflow operator

Use n8n as a shared tenant automation runtime. Read the current workflow state,
make draft-safe changes, test with disposable inputs when requested, and leave
production activation to the shared native n8n operator.

## Activation and scope

1. Use the n8n MCP tools provided by the installed ThinkWork n8n plugin. The
   plugin uses a tenant service credential, not per-user n8n activation.
2. If n8n tools are missing, report that the operator must install the n8n
   plugin, deploy the managed app, enable instance-level MCP in n8n, and enable
   MCP access on the workflow, project, or folder.
3. Treat the native n8n UI as the final production activation surface in v1.
   Do not publish, unpublish, activate, or deactivate production workflows
   unless the human is explicitly operating the shared n8n operator account in
   the native UI.

## Read and identify

1. Resolve workflow id, name, active state, project or folder, tags, trigger
   nodes, credential references, and recent executions before proposing changes.
2. Return both workflow id and workflow name in every workflow handoff or
   verification summary.
3. Confirm whether the workflow, project, or folder has MCP access enabled
   before assuming agents can inspect or edit it.
4. If multiple workflows match, stop and ask for the exact workflow id or URL
   before making changes.

## Draft and test safely

1. Prefer draft workflows, disabled copies, or disposable test workflows for
   agent-authored changes.
2. For Code nodes, use only packages declared in the Plugin Detail n8n custom
   package settings. Do not import undeclared packages or rely on private npm
   registries.
3. When asked to create or update a workflow, keep it inactive unless the
   human explicitly completes activation in the native n8n UI.
4. Run only low-risk reads or test executions that the human has allowed. Never
   trigger a production webhook, production schedule, or destructive external
   side effect as a smoke test.

## Handoff

1. Summarize the workflow id, workflow name, draft/test status, package
   requirements, credential assumptions, and MCP access state.
2. Include the native n8n UI handoff: which shared operator should review the
   workflow and what they need to activate or leave disabled.
3. Record evidence links or execution ids for successful test runs, and record
   exact failure messages for blocked tests.
4. If a production activation, unpublish, credential rotation, or package image
   change is required, hand it to the operator instead of trying to complete it
   through MCP.
