#!/usr/bin/env bash
# Build the AppSync subscription-only schema fragment from the canonical GraphQL source.
#
# The canonical schema lives in packages/database-pg/graphql/.
# This script extracts ONLY the subscription-related types (Subscription + notification
# Mutations + event payload types) into terraform/schema.graphql for the AppSync module.
#
# Decision 9: AppSync is subscription fan-out only. The full product schema stays in
# database-pg/graphql/ and is consumed by graphql-http Lambda + codegen.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/packages/database-pg/graphql"
DST="$REPO_ROOT/terraform/schema.graphql"

echo "Building AppSync subscription schema → $DST"

# Start with the base schema (scalars + root types)
cat "$SRC/schema.graphql" > "$DST"
echo "" >> "$DST"

# Append only the subscriptions type file (contains event types + notify mutations + subscriptions)
cat "$SRC/types/subscriptions.graphql" >> "$DST"

echo "Done — $(wc -l < "$DST" | tr -d ' ') lines written"
