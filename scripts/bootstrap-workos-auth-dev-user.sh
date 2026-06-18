#!/usr/bin/env bash
set -euo pipefail

# Dev-only helper for THNK-43 WorkOS Auth validation.
#
# It repairs the common manual setup gap where Cognito/WorkOS login succeeds,
# but /api/auth/me returns user_not_bootstrapped because the signed-in Cognito
# subject has no users + tenant_members rows in the dev database.

STAGE="${STAGE:-dev}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AUTH_ME_FUNCTION_NAME="${AUTH_ME_FUNCTION_NAME:-thinkwork-${STAGE}-api-auth-me}"
COGNITO_USER_POOL_NAME="${COGNITO_USER_POOL_NAME:-thinkwork-${STAGE}-user-pool}"
WORKOS_PUBLIC_HOST="${WORKOS_PUBLIC_HOST:-localhost:5180}"

EMAIL="${WORKOS_TEST_EMAIL:-${1:-}}"
TENANT_ID="${WORKOS_TEST_TENANT_ID:-${2:-}}"
USER_POOL_ID="${COGNITO_USER_POOL_ID:-}"

usage() {
  cat <<USAGE >&2
Usage:
  WORKOS_TEST_EMAIL=user@example.com $0 [tenant-id]

Environment:
  STAGE                     Deployment stage. Default: dev.
  AWS_REGION                AWS region. Default: us-east-1.
  AUTH_ME_FUNCTION_NAME     Lambda used to read DATABASE_URL.
  COGNITO_USER_POOL_ID      Optional explicit Cognito user pool id.
  COGNITO_USER_POOL_NAME    Name used to discover the pool when id is omitted.
  WORKOS_PUBLIC_HOST        Host used to discover the WorkOS-enabled tenant.
  WORKOS_TEST_TENANT_ID     Optional explicit tenant id.
USAGE
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

if [[ -z "$EMAIL" ]]; then
  usage
  exit 2
fi

require_cmd aws
require_cmd jq
require_cmd psql

EMAIL_LC="$(printf '%s' "$EMAIL" | tr '[:upper:]' '[:lower:]')"

lambda_env="$(
  AWS_REGION="$AWS_REGION" aws lambda get-function-configuration \
    --function-name "$AUTH_ME_FUNCTION_NAME" \
    --query 'Environment.Variables' \
    --output json
)"

DB_URL="$(printf '%s' "$lambda_env" | jq -r '.DATABASE_URL // empty')"
if [[ -z "$DB_URL" || "$DB_URL" == "None" ]]; then
  echo "Could not resolve DATABASE_URL from Lambda $AUTH_ME_FUNCTION_NAME" >&2
  exit 1
fi

# The Node postgres client accepts sslmode=no-verify; psql does not.
DB_URL="${DB_URL/sslmode=no-verify/sslmode=require}"

if [[ -z "$USER_POOL_ID" ]]; then
  USER_POOL_ID="$(
    AWS_REGION="$AWS_REGION" aws cognito-idp list-user-pools \
      --max-results 60 \
      --query "UserPools[?Name=='${COGNITO_USER_POOL_NAME}'].Id | [0]" \
      --output text
  )"
fi

if [[ -z "$USER_POOL_ID" || "$USER_POOL_ID" == "None" ]]; then
  echo "Could not resolve Cognito user pool id for ${COGNITO_USER_POOL_NAME}" >&2
  exit 1
fi

user_json="$(
  AWS_REGION="$AWS_REGION" aws cognito-idp list-users \
    --user-pool-id "$USER_POOL_ID" \
    --filter "email = \"$EMAIL_LC\"" \
    --output json
)"

COGNITO_USERNAME="$(
  printf '%s' "$user_json" | jq -r --arg email "$EMAIL_LC" '
    [.Users[]
      | select((.Attributes[]? | select(.Name == "email") | .Value | ascii_downcase) == $email)
    ][0].Username // empty
  '
)"

COGNITO_SUB="$(
  printf '%s' "$user_json" | jq -r --arg username "$COGNITO_USERNAME" '
    .Users[]
    | select(.Username == $username)
    | (.Attributes[]? | select(.Name == "sub") | .Value) // empty
  '
)"

DISPLAY_NAME="$(
  printf '%s' "$user_json" | jq -r --arg username "$COGNITO_USERNAME" --arg email "$EMAIL_LC" '
    (
      .Users[]
      | select(.Username == $username)
      | (.Attributes[]? | select(.Name == "name") | .Value)
    ) // ($email | split("@")[0])
  '
)"

if [[ -z "$COGNITO_USERNAME" || -z "$COGNITO_SUB" ]]; then
  echo "No Cognito user with email ${EMAIL_LC} exists in ${USER_POOL_ID}." >&2
  echo "Sign in through WorkOS once, then rerun this helper." >&2
  exit 1
fi

if [[ -z "$TENANT_ID" ]]; then
  tenant_matches="$(
    psql "$DB_URL" -v ON_ERROR_STOP=1 -P pager=off -At \
      -v host="$WORKOS_PUBLIC_HOST" <<'SQL'
SELECT ref.tenant_id::text
FROM public.tenant_auth_provider_references ref
JOIN public.auth_provider_resources res
  ON res.id = ref.auth_provider_resource_id
JOIN public.plugin_installs installs
  ON installs.id = ref.plugin_install_id
JOIN public.plugin_components components
  ON components.plugin_install_id = installs.id
 AND components.component_type = 'auth-provider'
WHERE ref.status = 'enabled'
  AND installs.state IN ('installed', 'partially_installed')
  AND components.state = 'provisioned'
  AND components.handler_ref->>'status' = 'valid'
  AND components.handler_ref->>'publicOptionsPublished' = 'true'
  AND res.provider_key = 'workos'
  AND res.validation_status IN ('valid', 'partially_valid')
  AND res.public_options_published = true
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(ref.hostnames) AS hostnames(hostname)
    WHERE lower(hostnames.hostname) = lower(:'host')
  )
ORDER BY ref.created_at DESC;
SQL
  )"

  tenant_count="$(printf '%s\n' "$tenant_matches" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')"
  if [[ "$tenant_count" != "1" ]]; then
    echo "Expected exactly one WorkOS-enabled tenant for ${WORKOS_PUBLIC_HOST}; found ${tenant_count}." >&2
    echo "Pass WORKOS_TEST_TENANT_ID explicitly to choose a tenant." >&2
    exit 1
  fi
  TENANT_ID="$(printf '%s\n' "$tenant_matches" | sed '/^[[:space:]]*$/d' | head -n 1)"
fi

psql "$DB_URL" -q -v ON_ERROR_STOP=1 -P pager=off \
  -v tenant_id="$TENANT_ID" \
  -v email="$EMAIL_LC" \
  -v cognito_sub="$COGNITO_SUB" \
  -v display_name="$DISPLAY_NAME" <<'SQL'
BEGIN;

WITH updated AS (
  UPDATE public.users
  SET tenant_id = :'tenant_id'::uuid,
      email = lower(:'email'),
      name = COALESCE(public.users.name, :'display_name'),
      email_verified_at = COALESCE(public.users.email_verified_at, now()),
      cognito_sub = :'cognito_sub',
      workspace_folder_name = COALESCE(
        public.users.workspace_folder_name,
        concat(
          regexp_replace(lower(split_part(:'email', '@', 1)), '[^a-z0-9]+', '-', 'g'),
          '-workos-',
          left(replace(:'cognito_sub', '-', ''), 8)
        )
      ),
      updated_at = now()
  WHERE public.users.id = :'cognito_sub'::uuid
     OR public.users.cognito_sub = :'cognito_sub'
     OR lower(public.users.email) = lower(:'email')
  RETURNING id, tenant_id
),
inserted AS (
  INSERT INTO public.users (
    id,
    tenant_id,
    email,
    name,
    email_verified_at,
    cognito_sub,
    workspace_folder_name
  )
  SELECT
    :'cognito_sub'::uuid,
    :'tenant_id'::uuid,
    lower(:'email'),
    :'display_name',
    now(),
    :'cognito_sub',
    concat(
      regexp_replace(lower(split_part(:'email', '@', 1)), '[^a-z0-9]+', '-', 'g'),
      '-workos-',
      left(replace(:'cognito_sub', '-', ''), 8)
    )
  WHERE NOT EXISTS (SELECT 1 FROM updated)
  ON CONFLICT (email) DO UPDATE
  SET tenant_id = EXCLUDED.tenant_id,
      name = COALESCE(public.users.name, EXCLUDED.name),
      email_verified_at = COALESCE(public.users.email_verified_at, EXCLUDED.email_verified_at),
      cognito_sub = EXCLUDED.cognito_sub,
      workspace_folder_name = COALESCE(public.users.workspace_folder_name, EXCLUDED.workspace_folder_name),
      updated_at = now()
  RETURNING id, tenant_id
),
chosen AS (
  SELECT id, tenant_id FROM updated
  UNION ALL
  SELECT id, tenant_id FROM inserted
  LIMIT 1
),
member_upsert AS (
  INSERT INTO public.tenant_members (tenant_id, principal_type, principal_id, role, status)
  SELECT tenant_id, 'user', id, 'owner', 'active'
  FROM chosen
  ON CONFLICT (tenant_id, principal_type, principal_id) DO UPDATE
  SET role = EXCLUDED.role,
      status = EXCLUDED.status,
      updated_at = now()
  RETURNING principal_id
)
INSERT INTO public.space_members (tenant_id, space_id, user_id, role, notification_preference)
SELECT s.tenant_id, s.id, chosen.id, 'owner', 'subscribed'
FROM public.spaces s
CROSS JOIN chosen
WHERE s.tenant_id = chosen.tenant_id
  AND s.access_mode = 'public'
ON CONFLICT (tenant_id, space_id, user_id) DO UPDATE
SET role = EXCLUDED.role,
    notification_preference = EXCLUDED.notification_preference,
    updated_at = now();

COMMIT;
SQL

AWS_REGION="$AWS_REGION" aws cognito-idp admin-update-user-attributes \
  --user-pool-id "$USER_POOL_ID" \
  --username "$COGNITO_USERNAME" \
  --user-attributes \
    Name=custom:tenant_id,Value="$TENANT_ID" \
    Name=email_verified,Value=true >/dev/null

echo "Bootstrapped ${EMAIL_LC} into tenant ${TENANT_ID} for WorkOS dev auth."
echo "Reload localhost, or sign out and back in if the old ID token is cached."
