#!/usr/bin/env bash
# Build Lambda deployment artifacts using esbuild.
#
# Bundles each handler from packages/api and packages/lambda into individual
# zip files at dist/lambdas/<name>.zip. Each zip contains a single index.mjs
# file that can be deployed directly to AWS Lambda (Node.js 20.x, ESM).
#
# Usage:
#   bash scripts/build-lambdas.sh           # Build all handlers
#   bash scripts/build-lambdas.sh graphql-http  # Build single handler

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$REPO_ROOT/dist/lambdas"

mkdir -p "$DIST"

# esbuild common flags
ESBUILD_FLAGS=(
  --bundle
  --platform=node
  --target=node20
  --format=esm
  --minify
  --sourcemap
  --external:@aws-sdk/*
  --external:aws-sdk
)

# graphql-http, memory-retain, mcp-user-memory, mcp-context-engine,
# eval-runner, and wiki-compile use AWS Bedrock SDKs
# (@aws-sdk/client-bedrock-agentcore for memory adapter commands;
# @aws-sdk/client-bedrock-runtime for eval-runner's Converse judge and
# wiki-compile's InvokeModel planner/section-writer) that aren't in the default
# Lambda Node 20 runtime's built-in SDK, or are newer than what ships there.
# Bundle them inline so the pinned node_modules version is used.
BUNDLED_AGENTCORE_ESBUILD_FLAGS=(
  --bundle
  --platform=node
  --target=node20
  --format=esm
  --minify
  --sourcemap
  --external:@aws-sdk/client-bedrock
  --external:@aws-sdk/client-cloudwatch-logs
  --external:@aws-sdk/client-lambda
  --external:@aws-sdk/client-s3
  --external:@aws-sdk/client-secrets-manager
  --external:@aws-sdk/client-ses
  --external:@aws-sdk/client-sns
  --external:@aws-sdk/client-ssm
  --external:@aws-sdk/client-bedrock-agent
  --external:@aws-sdk/client-dynamodb
  --external:@aws-sdk/lib-dynamodb
  --external:@aws-sdk/client-sts
  --external:@aws-sdk/credential-providers
  --external:aws-sdk
)

build_handler() {
  local name="$1"
  local entry="$2"
  local out_dir="$DIST/$name"

  if [ ! -f "$entry" ]; then
    echo "  SKIP $name — entry not found: $entry"
    return
  fi

  mkdir -p "$out_dir"
  local flags_ref="ESBUILD_FLAGS[@]"
  if [ "$name" = "graphql-http" ] || [ "$name" = "memory-retain" ] || [ "$name" = "mcp-user-memory" ] || [ "$name" = "mcp-context-engine" ] || [ "$name" = "eval-runner" ] || [ "$name" = "wiki-compile" ] || [ "$name" = "wiki-bootstrap-import" ] || [ "$name" = "routine-task-python" ] || [ "$name" = "compliance-export-runner" ]; then
    flags_ref="BUNDLED_AGENTCORE_ESBUILD_FLAGS[@]"
  fi
  npx esbuild "$entry" \
    "${!flags_ref}" \
    --outfile="$out_dir/index.mjs" \
    --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);" \
    2>/dev/null

  # For graphql-http: include assets loaded at runtime via readFileSync.
  if [ "$name" = "graphql-http" ]; then
    mkdir -p "$out_dir/packages/database-pg/graphql/types"
    cp "$REPO_ROOT/packages/database-pg/graphql/schema.graphql" "$out_dir/packages/database-pg/graphql/"
    cp "$REPO_ROOT/packages/database-pg/graphql/types/"*.graphql "$out_dir/packages/database-pg/graphql/types/"

    # Runbook-capable Agent Skills resolve from the skill catalog at runtime.
    # Place those skill directories at /var/task/skill-catalog in the zip.
    rm -rf "$out_dir/skill-catalog"
    mkdir -p "$out_dir/skill-catalog"
    for skill_dir in "$REPO_ROOT/packages/skill-catalog"/*; do
      [ -d "$skill_dir" ] || continue
      [ -f "$skill_dir/SKILL.md" ] || continue
      cp -R "$skill_dir" "$out_dir/skill-catalog/"
    done
  fi

  # Build a byte-identical zip when contents are byte-identical so
  # terraform's filebase64sha256 on source_code_hash no-ops unchanged
  # Lambdas. Without this every push reuploaded all 89 handlers because
  # esbuild stamps current-time mtimes and `zip` embeds them.
  #   touch -t : pin every entry's mtime to a fixed 1980-01-01 epoch
  #   sort     : entry order independent of filesystem traversal
  #   zip -X   : drop OS-specific extra fields (mac/linux differ)
  find "$out_dir" -exec touch -t 198001010000 {} +
  (cd "$out_dir" && find . -type f \
    ! -name '*.map' \
    ! -path './__MACOSX/*' \
    -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 zip -qX "$DIST/$name.zip")
  rm -rf "$out_dir"

  echo "  ✓ $name"
}

FILTER="${1:-}"

echo "Building Lambda artifacts → $DIST"
echo ""

# ---------------------------------------------------------------------------
# P0: Critical — sign-up + GraphQL
# ---------------------------------------------------------------------------
echo "P0: Core API"

build_handler "graphql-http" \
  "$REPO_ROOT/packages/api/src/handlers/graphql-http.ts"

build_handler "cognito-pre-signup" \
  "$REPO_ROOT/packages/api/src/handlers/cognito-pre-signup.ts"

# ---------------------------------------------------------------------------
# P1: Agent invoke + thread management
# ---------------------------------------------------------------------------
echo ""
echo "P1: Agent invoke + scheduling"

build_handler "agentcore-invoke" \
  "$REPO_ROOT/packages/api/agentcore-invoke.ts"

build_handler "chat-agent-invoke" \
  "$REPO_ROOT/packages/api/src/handlers/chat-agent-invoke.ts"

build_handler "wakeup-processor" \
  "$REPO_ROOT/packages/api/src/handlers/wakeup-processor.ts"

build_handler "workspace-event-dispatcher" \
  "$REPO_ROOT/packages/api/src/handlers/workspace-event-dispatcher.ts"

build_handler "job-trigger" \
  "$REPO_ROOT/packages/lambda/job-trigger.ts"

build_handler "job-schedule-manager" \
  "$REPO_ROOT/packages/lambda/job-schedule-manager.ts"

build_handler "scheduled-jobs" \
  "$REPO_ROOT/packages/api/src/handlers/scheduled-jobs.ts"

build_handler "connector-poller" \
  "$REPO_ROOT/packages/api/src/handlers/connector-poller.ts"

build_handler "compliance-outbox-drainer" \
  "$REPO_ROOT/packages/lambda/compliance-outbox-drainer.ts"

# Phase 3 U6: cross-runtime compliance emit endpoint (Strands Python
# client posts here). Bearer API_AUTH_SECRET; idempotency on
# client-supplied UUIDv7 event_id.
build_handler "compliance-events" \
  "$REPO_ROOT/packages/api/src/handlers/compliance.ts"

# Phase 3 U8b: periodic Merkle-anchor Lambda + watchdog. LIVE — anchor
# does real S3 PutObject with Object Lock retention; watchdog does
# ListObjectsV2 + emits ComplianceAnchorGap.
build_handler "compliance-anchor" \
  "$REPO_ROOT/packages/lambda/compliance-anchor.ts"

build_handler "compliance-anchor-watchdog" \
  "$REPO_ROOT/packages/lambda/compliance-anchor-watchdog.ts"

# Phase 3 U11.U2 (INERT): SQS-triggered async export runner. Stub body
# throws — U11.U3 ships the live runner that streams CSV/NDJSON to S3.
build_handler "compliance-export-runner" \
  "$REPO_ROOT/packages/lambda/compliance-export-runner.ts"

# ---------------------------------------------------------------------------
# P1: REST handlers (agents, messages, connections, oauth)
# ---------------------------------------------------------------------------
echo ""
echo "P1: REST handlers"

build_handler "agents" \
  "$REPO_ROOT/packages/api/src/handlers/agents.ts"

build_handler "agent-actions" \
  "$REPO_ROOT/packages/api/src/handlers/agent-actions.ts"

build_handler "messages" \
  "$REPO_ROOT/packages/api/src/handlers/messages.ts"

build_handler "connections" \
  "$REPO_ROOT/packages/api/src/handlers/connections.ts"

build_handler "oauth-authorize" \
  "$REPO_ROOT/packages/api/src/handlers/oauth-authorize.ts"

build_handler "oauth-callback" \
  "$REPO_ROOT/packages/api/src/handlers/oauth-callback.ts"

build_handler "stripe-checkout" \
  "$REPO_ROOT/packages/api/src/handlers/stripe-checkout.ts"

build_handler "stripe-webhook" \
  "$REPO_ROOT/packages/api/src/handlers/stripe-webhook.ts"

build_handler "stripe-portal" \
  "$REPO_ROOT/packages/api/src/handlers/stripe-portal.ts"

build_handler "stripe-subscription" \
  "$REPO_ROOT/packages/api/src/handlers/stripe-subscription.ts"

build_handler "auth-me" \
  "$REPO_ROOT/packages/api/src/handlers/auth-me.ts"

build_handler "teams" \
  "$REPO_ROOT/packages/api/src/handlers/teams.ts"

build_handler "team-members" \
  "$REPO_ROOT/packages/api/src/handlers/team-members.ts"

build_handler "tenants" \
  "$REPO_ROOT/packages/api/src/handlers/tenants.ts"

build_handler "users" \
  "$REPO_ROOT/packages/api/src/handlers/users.ts"

build_handler "invites" \
  "$REPO_ROOT/packages/api/src/handlers/invites.ts"

build_handler "skills" \
  "$REPO_ROOT/packages/api/src/handlers/skills.ts"

build_handler "mcp-oauth" \
  "$REPO_ROOT/packages/api/src/handlers/mcp-oauth.ts"

build_handler "mcp-user-memory" \
  "$REPO_ROOT/packages/api/src/handlers/mcp-user-memory.ts"

build_handler "mcp-context-engine" \
  "$REPO_ROOT/packages/api/src/handlers/mcp-context-engine.ts"

build_handler "brain-agent-write" \
  "$REPO_ROOT/packages/api/src/handlers/brain-agent-write.ts"

# Service-auth REST endpoint the Strands agent container calls during
# kind=run_skill dispatch to fetch the agent's runtime config (template,
# skills, MCP, memory, guardrail). Plan 2026-04-24-008 §U1 added the
# handler + Terraform route but missed this build entry, so the Lambda
# zip wasn't produced and terraform-apply failed with
# "filebase64sha256: no such file" on agents-runtime-config.zip,
# blocking every deploy after PR #552 merged.
build_handler "agents-runtime-config" \
  "$REPO_ROOT/packages/api/src/handlers/agents-runtime-config.ts"

build_handler "computer-runtime" \
  "$REPO_ROOT/packages/api/src/handlers/computer-runtime.ts"

build_handler "computer-manager" \
  "$REPO_ROOT/packages/api/src/handlers/computer-manager.ts"

build_handler "computer-runtime-reconciler" \
  "$REPO_ROOT/packages/api/src/handlers/computer-runtime-reconciler.ts"

# Plugin upload handler (V1 agent-architecture plan §U10). Four routes:
#   POST /api/plugins/presign    → presigned PUT URL for the zip
#   POST /api/plugins/upload     → validator + three-phase install saga
#   GET  /api/plugins            → list recent uploads for the tenant
#   GET  /api/plugins/:uploadId  → detail for a single upload
build_handler "plugin-upload" \
  "$REPO_ROOT/packages/api/src/handlers/plugin-upload.ts"

build_handler "folder-bundle-import" \
  "$REPO_ROOT/packages/api/src/handlers/folder-bundle-import.ts"

# Hourly sweeper — reaps orphan S3 staging (> 1h) from failed or interrupted
# plugin upload sagas (plan §U10). Triggered by EventBridge.
build_handler "plugin-staging-sweeper" \
  "$REPO_ROOT/packages/api/src/handlers/plugin-staging-sweeper.ts"

build_handler "activity" \
  "$REPO_ROOT/packages/api/src/handlers/activity.ts"

build_handler "routines" \
  "$REPO_ROOT/packages/api/src/handlers/routines.ts"

build_handler "budgets" \
  "$REPO_ROOT/packages/api/src/handlers/budgets.ts"

build_handler "sandbox-quota-check" \
  "$REPO_ROOT/packages/api/src/handlers/sandbox-quota-check.ts"

build_handler "sandbox-invocation-log" \
  "$REPO_ROOT/packages/api/src/handlers/sandbox-invocation-log.ts"

# Routines Step Functions ASL validator (plan 2026-05-01-004 §U5).
# Server-side AWS ValidateStateMachineDefinition + recipe-aware linter.
# Bearer API_AUTH_SECRET; called by the chat builder + publish flow.
build_handler "routine-asl-validator" \
  "$REPO_ROOT/packages/api/src/handlers/routine-asl-validator.ts"

# Routines Step Functions Task wrappers (plan 2026-05-01-005 §U6).
# routine-task-python: invoked by SFN for every `python` recipe state.
# Wraps StartCodeInterpreterSession + InvokeCodeInterpreter +
# StopCodeInterpreterSession; offloads stdout/stderr to the per-stage
# routine-output S3 bucket. Uses BUNDLED_AGENTCORE_ESBUILD_FLAGS because
# @aws-sdk/client-bedrock-agentcore is newer than the Node 20 Lambda
# runtime's bundled SDK set.
build_handler "routine-task-python" \
  "$REPO_ROOT/packages/lambda/routine-task-python.ts"

# routine-resume: invoked by routine-approval-bridge (U8) after a HITL
# decision lands. Calls SendTaskSuccess/SendTaskFailure; idempotent on
# already-consumed tokens.
build_handler "routine-resume" \
  "$REPO_ROOT/packages/lambda/routine-resume.ts"

# routine-approval-callback: SFN's inbox_approval Task hits this Lambda
# directly via .waitForTaskToken (plan 2026-05-01-005 §U8). Creates the
# inbox_items row + persists the task token in routine_approval_tokens.
# The operator's later decideInboxItem decision flows through
# routine-approval-bridge.ts which conditional-UPDATEs the token row +
# invokes routine-resume.
build_handler "routine-approval-callback" \
  "$REPO_ROOT/packages/api/src/handlers/routine-approval-callback.ts"

# Routines step-event + execution-event REST ingest (plan 2026-05-01-005 §U9).
# Task wrappers POST step events to /api/routines/step; an EventBridge rule
# routes SFN execution-state-change events to /api/routines/execution. Both
# Bearer API_AUTH_SECRET; idempotent under double-delivery.
build_handler "routine-step-callback" \
  "$REPO_ROOT/packages/api/src/handlers/routine-step-callback.ts"
build_handler "routine-execution-callback" \
  "$REPO_ROOT/packages/api/src/handlers/routine-execution-callback.ts"
build_handler "routine-task-weather-email" \
  "$REPO_ROOT/packages/api/src/handlers/routine-task-weather-email.ts"

build_handler "guardrails" \
  "$REPO_ROOT/packages/api/src/handlers/guardrails-handler.ts"

# ---------------------------------------------------------------------------
# P2: Async + webhooks + email + KB + workspace
# ---------------------------------------------------------------------------
echo ""
echo "P2: Async + integrations"

build_handler "email-inbound" \
  "$REPO_ROOT/packages/api/src/handlers/email-inbound.ts"

build_handler "email-send" \
  "$REPO_ROOT/packages/api/src/handlers/email-send.ts"

build_handler "webhooks" \
  "$REPO_ROOT/packages/api/src/handlers/webhooks.ts"

build_handler "webhooks-admin" \
  "$REPO_ROOT/packages/api/src/handlers/webhooks-admin.ts"

build_handler "webhook-deliveries-cleanup" \
  "$REPO_ROOT/packages/api/src/handlers/webhook-deliveries-cleanup.ts"

build_handler "skill-runs-reconciler" \
  "$REPO_ROOT/packages/api/src/handlers/skill-runs-reconciler.ts"

# Unit 8 — composable-skills webhook ingress pattern. Each integration
# has a thin handler under handlers/webhooks/; the shared helper
# (_shared.ts) owns HMAC + bootstrap + dispatch.
build_handler "webhook-crm-opportunity" \
  "$REPO_ROOT/packages/api/src/handlers/webhooks/crm-opportunity.ts"

build_handler "webhook-task-event" \
  "$REPO_ROOT/packages/api/src/handlers/webhooks/task-event.ts"

build_handler "github-app" \
  "$REPO_ROOT/packages/api/src/handlers/github-app.ts"

build_handler "github-repos" \
  "$REPO_ROOT/packages/api/src/handlers/github-repos.ts"

build_handler "github-app-webhook" \
  "$REPO_ROOT/packages/api/github-app-webhook.ts"

build_handler "github-app-callback" \
  "$REPO_ROOT/packages/api/github-app-callback.ts"

build_handler "knowledge-base-manager" \
  "$REPO_ROOT/packages/api/knowledge-base-manager.ts"

build_handler "knowledge-base-files" \
  "$REPO_ROOT/packages/api/knowledge-base-files.ts"

build_handler "workspace-files" \
  "$REPO_ROOT/packages/api/workspace-files.ts"

build_handler "agent-skills-list" \
  "$REPO_ROOT/packages/api/agent-skills-list.ts"

build_handler "memory" \
  "$REPO_ROOT/packages/api/memory.ts"

build_handler "memory-retain" \
  "$REPO_ROOT/packages/api/src/handlers/memory-retain.ts"

build_handler "wiki-compile" \
  "$REPO_ROOT/packages/api/src/handlers/wiki-compile.ts"

build_handler "wiki-lint" \
  "$REPO_ROOT/packages/api/src/handlers/wiki-lint.ts"

build_handler "wiki-export" \
  "$REPO_ROOT/packages/api/src/handlers/wiki-export.ts"

build_handler "wiki-bootstrap-import" \
  "$REPO_ROOT/packages/api/src/handlers/wiki-bootstrap-import.ts"

build_handler "artifact-deliver" \
  "$REPO_ROOT/packages/api/src/handlers/artifact-deliver.ts"

build_handler "recipe-refresh" \
  "$REPO_ROOT/packages/api/src/handlers/recipe-refresh.ts"

build_handler "code-factory" \
  "$REPO_ROOT/packages/api/src/handlers/code-factory.ts"

build_handler "bootstrap-workspaces" \
  "$REPO_ROOT/packages/api/src/handlers/bootstrap-workspaces.ts"

build_handler "migrate-agents-to-computers" \
  "$REPO_ROOT/packages/api/src/handlers/migrate-agents-to-computers.ts"

build_handler "agentcore-admin" \
  "$REPO_ROOT/packages/lambda/agentcore-admin.ts"

build_handler "admin-ops-mcp" \
  "$REPO_ROOT/packages/lambda/admin-ops-mcp.ts"

build_handler "mcp-admin-keys" \
  "$REPO_ROOT/packages/api/src/handlers/mcp-admin-keys.ts"

build_handler "mcp-admin-provision" \
  "$REPO_ROOT/packages/api/src/handlers/mcp-admin-provision.ts"

# Runtime → API manifest-log endpoint (plan §U15). The Strands container
# POSTs one row per agent session start. Shared API_AUTH_SECRET; no tenant
# OAuth. Ships inert — U15 part 2 wires the Python capture path.
build_handler "manifest-log" \
  "$REPO_ROOT/packages/api/src/handlers/manifest-log.ts"

# Runtime → API capability-catalog list (plan §U15 pt 3/3, SI-7). GET
# /api/runtime/capability-catalog?type=tool&source=builtin returns the
# allowed slug set the Strands runtime uses to enforce "a tool that
# isn't in the catalog can't register." Gated behind RCM_ENFORCE=true
# on the container side.
build_handler "capability-catalog-list" \
  "$REPO_ROOT/packages/api/src/handlers/capability-catalog-list.ts"

# Admin approve/reject for plugin-installed MCP servers (plan §U11, SI-5).
#   POST /api/tenants/:tenantId/mcp-servers/:serverId/approve
#   POST /api/tenants/:tenantId/mcp-servers/:serverId/reject
build_handler "mcp-approval" \
  "$REPO_ROOT/packages/api/src/handlers/mcp-approval.ts"

# Daily TTL sweeper — auto-rejects pending MCP servers older than 30 days.
# Triggered by EventBridge (see terraform/modules/app/lambda-api/schedules.tf).
build_handler "mcp-approval-sweeper" \
  "$REPO_ROOT/packages/api/src/handlers/mcp-approval-sweeper.ts"

build_handler "github-workspace" \
  "$REPO_ROOT/packages/lambda/github-workspace.ts"

build_handler "sandbox-log-scrubber" \
  "$REPO_ROOT/packages/lambda/sandbox-log-scrubber.ts"

build_handler "eval-runner" \
  "$REPO_ROOT/packages/api/src/handlers/eval-runner.ts"

# ---------------------------------------------------------------------------
# P2: Cron handlers
# ---------------------------------------------------------------------------
echo ""
echo "P2: Cron handlers"

for cron in budget-reset check-agent-health check-gateways cleanup-pending-connections \
            email-triage-scheduler expire-email-tokens expire-stale-invitations \
            mark-offline-agents recover-stale-checkouts retry-dispatcher \
            span-enrichment stall-monitor; do
  build_handler "cron-$cron" \
    "$REPO_ROOT/packages/api/src/handlers/crons/$cron.ts"
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Done — $(ls "$DIST"/*.zip 2>/dev/null | wc -l | tr -d ' ') artifacts built"
ls -lh "$DIST"/*.zip 2>/dev/null | awk '{print "  " $5 "\t" $NF}'
