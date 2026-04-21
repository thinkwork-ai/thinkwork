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

# graphql-http, memory-retain, eval-runner, and wiki-compile use AWS Bedrock
# SDKs (@aws-sdk/client-bedrock-agentcore for the first three + memory adapter
# commands; @aws-sdk/client-bedrock-runtime for eval-runner's Converse judge
# and wiki-compile's InvokeModel planner/section-writer) that aren't in the
# default Lambda Node 20 runtime's built-in SDK, or are newer than what ships
# there. Bundle them inline so the pinned node_modules version is used.
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
  --external:@aws-sdk/client-bedrock-agent-runtime
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
  if [ "$name" = "graphql-http" ] || [ "$name" = "memory-retain" ] || [ "$name" = "eval-runner" ] || [ "$name" = "wiki-compile" ] || [ "$name" = "wiki-bootstrap-import" ]; then
    flags_ref="BUNDLED_AGENTCORE_ESBUILD_FLAGS[@]"
  fi
  npx esbuild "$entry" \
    "${!flags_ref}" \
    --outfile="$out_dir/index.mjs" \
    --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);" \
    2>/dev/null

  # For graphql-http: include the .graphql schema files (loaded at runtime via readFileSync)
  if [ "$name" = "graphql-http" ]; then
    mkdir -p "$out_dir/packages/database-pg/graphql/types"
    cp "$REPO_ROOT/packages/database-pg/graphql/schema.graphql" "$out_dir/packages/database-pg/graphql/"
    cp "$REPO_ROOT/packages/database-pg/graphql/types/"*.graphql "$out_dir/packages/database-pg/graphql/types/"
  fi

  # Create zip (exclude source maps to keep bundle small)
  (cd "$out_dir" && zip -qr "$DIST/$name.zip" . -x '*.map' -x '__MACOSX/*')
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

build_handler "job-trigger" \
  "$REPO_ROOT/packages/lambda/job-trigger.ts"

build_handler "job-schedule-manager" \
  "$REPO_ROOT/packages/lambda/job-schedule-manager.ts"

build_handler "scheduled-jobs" \
  "$REPO_ROOT/packages/api/src/handlers/scheduled-jobs.ts"

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

build_handler "activity" \
  "$REPO_ROOT/packages/api/src/handlers/activity.ts"

build_handler "routines" \
  "$REPO_ROOT/packages/api/src/handlers/routines.ts"

build_handler "budgets" \
  "$REPO_ROOT/packages/api/src/handlers/budgets.ts"

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

build_handler "agentcore-admin" \
  "$REPO_ROOT/packages/lambda/agentcore-admin.ts"

build_handler "github-workspace" \
  "$REPO_ROOT/packages/lambda/github-workspace.ts"

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
