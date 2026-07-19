#!/usr/bin/env bash
# Build the AppSync subscription-only schema from the canonical GraphQL source.
#
# AppSync doesn't support `extend type` — we must merge all Query/Mutation/Subscription
# fields into single type blocks. This script extracts only the subscription-related
# types from packages/database-pg/graphql/types/subscriptions.graphql and builds
# a self-contained AppSync schema.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/packages/database-pg/graphql/types/subscriptions.graphql"
DST="$REPO_ROOT/terraform/schema.graphql"

echo "Building AppSync subscription schema → $DST"

# Extract event payload types (everything before "extend type")
EVENT_TYPES=$(sed -n '1,/^extend type/p' "$SRC" | sed '$d')

# Extract mutation fields (between "extend type Mutation {" and "}")
MUTATION_FIELDS=$(sed -n '/^extend type Mutation {$/,/^}$/p' "$SRC" | grep -v '^extend type\|^}$')

# Extract subscription fields (between "extend type Subscription {" and "}")
SUBSCRIPTION_FIELDS=$(sed -n '/^extend type Subscription {$/,/^}$/p' "$SRC" | grep -v '^extend type\|^}$')

cat > "$DST" <<SCHEMA
# Auto-generated AppSync subscription-only schema.
# DO NOT EDIT — regenerate with: pnpm schema:build
#
# Source: packages/database-pg/graphql/types/subscriptions.graphql

scalar AWSDateTime
scalar AWSJSON

schema {
  query: Query
  mutation: Mutation
  subscription: Subscription
}

type Query {
  _empty: String
}

$EVENT_TYPES

type Mutation {
  _empty: String
$MUTATION_FIELDS
}

type Subscription {
  _empty: String
$SUBSCRIPTION_FIELDS
}
SCHEMA

# Authorization is explicit in the canonical fragment. Notification and
# invalidation mutations carry @aws_iam. Subscription fields intentionally
# carry no auth directive so they inherit the API's default AWS_LAMBDA mode;
# adding an additional-mode directive here would bypass one-use admission.
# Shared event object types carry both @aws_iam and @aws_lambda because IAM
# publishers return them and Lambda-authorized subscribers select their fields.

echo "Done — $(wc -l < "$DST" | tr -d ' ') lines written"
