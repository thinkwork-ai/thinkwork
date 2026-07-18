#!/usr/bin/env bash
set -euo pipefail

for required in AWS_REGION GATEWAY_NAME GATEWAY_ROLE_ARN GATEWAY_DISCOVERY_URL \
  GATEWAY_AUDIENCE TARGET_NAME TARGET_BASE_URL OAUTH_CREDENTIAL_PROVIDER_ARN \
  OAUTH_RETURN_URL POLICY_ENGINE_NAME POLICY_NAME PROOF_OWNER_ALLOWLIST; do
  [[ -n "${!required:-}" ]] || { printf '%s is required\n' "$required" >&2; exit 1; }
done

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

# API Gateway routes and Lambdas are reconciled in a sibling Terraform module.
# The URL string alone does not create an apply-time dependency on those route
# instances, so wait for the public discovery document before asking AgentCore
# to validate CUSTOM_JWT. This keeps parallel applies deterministic.
discovery_ready=false
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error --max-time 5 \
    "$GATEWAY_DISCOVERY_URL" \
    | jq -e --arg issuer "${GATEWAY_DISCOVERY_URL%/.well-known/openid-configuration}" \
      '.issuer == $issuer and (.jwks_uri | type == "string")' >/dev/null; then
    discovery_ready=true
    break
  fi
  sleep 5
done
[[ "$discovery_ready" == "true" ]] || {
  printf 'Gateway discovery document did not become ready within five minutes\n' >&2
  exit 1
}

list_id_by_name() {
  local command="$1" collection="$2" id_key="$3" name="$4"
  aws bedrock-agentcore-control "$command" --region "$AWS_REGION" --output json \
    | jq -r --arg collection "$collection" --arg id_key "$id_key" --arg name "$name" \
      '(.[$collection] // .items // [])[] | select(.name == $name) | .[$id_key]' \
    | head -n 1
}

wait_status() {
  local command="$1" id_flag="$2" id="$3" success="$4"
  local status="" attempts=0
  while (( attempts < 90 )); do
    status="$(aws bedrock-agentcore-control "$command" --region "$AWS_REGION" \
      "$id_flag" "$id" --query status --output text 2>/dev/null || true)"
    [[ "$status" == "$success" ]] && return 0
    case "$status" in
      FAILED|CREATE_FAILED|UPDATE_UNSUCCESSFUL|SYNCHRONIZE_UNSUCCESSFUL)
        printf '%s %s entered terminal status %s\n' "$command" "$id" "$status" >&2
        return 1
        ;;
    esac
    sleep 2
    attempts=$((attempts + 1))
  done
  printf '%s %s did not reach %s (last=%s)\n' "$command" "$id" "$success" "$status" >&2
  return 1
}

wait_policy_status() {
  local engine_id="$1" policy_id="$2" status="" attempts=0
  while (( attempts < 90 )); do
    status="$(aws bedrock-agentcore-control get-policy --region "$AWS_REGION" \
      --policy-engine-id "$engine_id" --policy-id "$policy_id" \
      --query status --output text 2>/dev/null || true)"
    [[ "$status" == "ACTIVE" ]] && return 0
    case "$status" in
      CREATE_FAILED|UPDATE_FAILED|FAILED)
        printf 'policy %s entered terminal status %s\n' "$policy_id" "$status" >&2
        return 1
        ;;
    esac
    sleep 2
    attempts=$((attempts + 1))
  done
  printf 'policy %s did not reach ACTIVE (last=%s)\n' "$policy_id" "$status" >&2
  return 1
}

policy_engine_id="$(list_id_by_name list-policy-engines policyEngines policyEngineId "$POLICY_ENGINE_NAME")"
if [[ -z "$policy_engine_id" ]]; then
  policy_engine_id="$(aws bedrock-agentcore-control create-policy-engine \
    --region "$AWS_REGION" \
    --name "$POLICY_ENGINE_NAME" \
    --description "THINK-316 exact-user Gateway proof policy" \
    --tags '{"purpose":"think-316-proof","managed-by":"terraform"}' \
    --query policyEngineId --output text)"
fi
wait_status get-policy-engine --policy-engine-id "$policy_engine_id" ACTIVE
policy_engine_arn="$(aws bedrock-agentcore-control get-policy-engine \
  --region "$AWS_REGION" --policy-engine-id "$policy_engine_id" \
  --query policyEngineArn --output text)"

jq -n \
  --arg name "$GATEWAY_NAME" \
  --arg roleArn "$GATEWAY_ROLE_ARN" \
  --arg discoveryUrl "$GATEWAY_DISCOVERY_URL" \
  --arg audience "$GATEWAY_AUDIENCE" \
  --arg policyArn "$policy_engine_arn" \
  '{
    name: $name,
    description: "THINK-316 exact-user multiplayer proof Gateway",
    exceptionLevel: "DEBUG",
    roleArn: $roleArn,
    protocolType: "MCP",
    protocolConfiguration: {mcp: {
      supportedVersions: ["2025-03-26", "2025-11-25"],
      sessionConfiguration: {sessionTimeoutInSeconds: 900},
      streamingConfiguration: {enableResponseStreaming: true}
    }},
    authorizerType: "CUSTOM_JWT",
    authorizerConfiguration: {customJWTAuthorizer: {
      discoveryUrl: $discoveryUrl,
      allowedAudience: [$audience],
      allowedScopes: ["gateway:invoke"]
    }},
    policyEngineConfiguration: {arn: $policyArn, mode: "ENFORCE"}
  }' >"$tmp_dir/gateway.json"

gateway_id="$(list_id_by_name list-gateways items gatewayId "$GATEWAY_NAME")"
if [[ -z "$gateway_id" ]]; then
  gateway_id="$(aws bedrock-agentcore-control create-gateway \
    --region "$AWS_REGION" --cli-input-json "file://$tmp_dir/gateway.json" \
    --query gatewayId --output text)"
else
  jq --arg id "$gateway_id" '. + {gatewayIdentifier: $id}' \
    "$tmp_dir/gateway.json" >"$tmp_dir/gateway-update.json"
  aws bedrock-agentcore-control update-gateway --region "$AWS_REGION" \
    --cli-input-json "file://$tmp_dir/gateway-update.json" >/dev/null
fi
wait_status get-gateway --gateway-identifier "$gateway_id" READY
gateway_arn="$(aws bedrock-agentcore-control get-gateway --region "$AWS_REGION" \
  --gateway-identifier "$gateway_id" --query gatewayArn --output text)"

# Gateway creates a service-managed workload identity named after its concrete
# gateway id. OAuth 3LO fails internally unless the selected return URL is also
# allowlisted on that managed identity; target configuration alone is not
# sufficient.
aws bedrock-agentcore-control update-workload-identity \
  --region "$AWS_REGION" \
  --name "$gateway_id" \
  --allowed-resource-oauth2-return-urls "$OAUTH_RETURN_URL" >/dev/null

openapi_payload="$(jq -nc --arg server "$TARGET_BASE_URL" '{
  openapi: "3.0.3",
  info: {title: "ThinkWork identity boundary proof", version: "1.0.0"},
  servers: [{url: $server}],
  paths: {
    "/agentcore-proof/target/owner": {get: {
      operationId: "owner_probe",
      summary: "Return a structurally sanitized owner fixture",
      parameters: [{
        name: "requested_owner", in: "query", required: true,
        schema: {type: "string"}
      }],
      responses: {"200": {description: "Sanitized owner projection"}}
    }},
    "/agentcore-proof/target/mixed": {get: {
      operationId: "mixed_disclosure",
      summary: "Return an allowlisted task field and a withholding decision",
      parameters: [{
        name: "requested_owner", in: "query", required: true,
        schema: {type: "string"}
      }],
      responses: {"200": {description: "Sanitized mixed-sensitivity projection"}}
    }},
    "/agentcore/capabilities/mcp/tools/list": {post: {
      operationId: "list_connector_tools",
      summary: "List the current participant authorized tools for one ThinkWork connector",
      requestBody: {required: true, content: {"application/json": {schema: {
        type: "object", additionalProperties: false, required: ["tenant_id", "connector", "query"],
        properties: {
          tenant_id: {type: "string", description: "Tenant UUID from the trusted turn context"},
          connector: {type: "string", description: "Connector name from the trusted turn context"},
          query: {type: "string", description: "The connector task, used to return only relevant direct tools"}
        }
      }}}},
      responses: {"200": {description: "Authorized connector tool definitions"}}
    }},
    "/agentcore/capabilities/mcp/tools/call": {post: {
      operationId: "call_connector_tool",
      summary: "Call one currently authorized ThinkWork connector tool as the exact turn participant",
      requestBody: {required: true, content: {"application/json": {schema: {
        type: "object", additionalProperties: false,
        required: ["tenant_id", "connector", "query", "tool", "arguments"],
        properties: {
          tenant_id: {type: "string", description: "Tenant UUID from the trusted turn context"},
          connector: {type: "string", description: "Connector name from the trusted turn context"},
          query: {type: "string", description: "The same user task passed to list_connector_tools"},
          tool: {type: "string", description: "Tool name returned by list_connector_tools"},
          arguments: {type: "object", additionalProperties: true}
        }
      }}}},
      responses: {"200": {description: "Connector tool result"}}
    }},
    "/agentcore/capabilities/sandbox/execute": {post: {
      operationId: "execute_code",
      summary: "Execute one bounded Python program in a short-lived internal-only sandbox",
      requestBody: {required: true, content: {"application/json": {schema: {
        type: "object", additionalProperties: false,
        required: ["tenant_id", "language", "code"],
        properties: {
          tenant_id: {type: "string", description: "Tenant UUID from the trusted turn context"},
          language: {type: "string", enum: ["python"]},
          code: {type: "string", maxLength: 16384},
          output_files: {
            type: "array", maxItems: 5,
            description: "Optional absolute files under /tmp/thinkwork/ to return as text",
            items: {type: "string", pattern: "^/tmp/thinkwork/[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$"}
          }
        }
      }}}},
      responses: {"200": {description: "Sanitized code result and declared files"}}
    }},
    "/agentcore/capabilities/web/search": {post: {
      operationId: "web_search",
      summary: "Search the current web through the tenant-configured governed provider",
      requestBody: {required: true, content: {"application/json": {schema: {
        type: "object", additionalProperties: false,
        required: ["tenant_id", "query"],
        properties: {
          tenant_id: {type: "string", description: "Tenant UUID from the trusted turn context"},
          query: {type: "string", minLength: 1, maxLength: 2000},
          limit: {type: "integer", minimum: 1, maximum: 10, default: 5}
        }
      }}}},
      responses: {"200": {description: "Sanitized current web search results"}}
    }},
    "/agentcore/capabilities/web/extract": {post: {
      operationId: "web_extract",
      summary: "Extract one known HTTPS page through the tenant-configured governed provider",
      requestBody: {required: true, content: {"application/json": {schema: {
        type: "object", additionalProperties: false,
        required: ["tenant_id", "url"],
        properties: {
          tenant_id: {type: "string", description: "Tenant UUID from the trusted turn context"},
          url: {type: "string", format: "uri", maxLength: 2048, pattern: "^https://"}
        }
      }}}},
      responses: {"200": {description: "Sanitized bounded page content"}}
    }},
    "/agentcore/capabilities/brain/query": {post: {
      operationId: "query_brain",
      summary: "Query permissioned ThinkWork Brain context as the exact turn participant",
      requestBody: {required: true, content: {"application/json": {schema: {
        type: "object", additionalProperties: false,
        required: ["tenant_id", "query"],
        properties: {
          tenant_id: {type: "string", description: "Tenant UUID from the trusted turn context"},
          query: {type: "string", minLength: 1, maxLength: 2000},
          mode: {type: "string", enum: ["results", "answer"], default: "results"},
          limit: {type: "integer", minimum: 1, maximum: 10, default: 8}
        }
      }}}},
      responses: {"200": {description: "Sanitized permissioned Brain context"}}
    }},
    "/agentcore/capabilities/workspace/skills/list": {post: {
      operationId: "list_workspace_skills",
      summary: "List the exact participant current authorized ThinkWork workspace skills",
      requestBody: {required: true, content: {"application/json": {schema: {
        type: "object", additionalProperties: false,
        required: ["tenant_id"],
        properties: {
          tenant_id: {type: "string", description: "Tenant UUID from the trusted turn context"}
        }
      }}}},
      responses: {"200": {description: "Current canonical authorized skill index"}}
    }},
    "/agentcore/capabilities/workspace/skills/load": {post: {
      operationId: "load_workspace_skill",
      summary: "Load one currently authorized ThinkWork SKILL.md as the exact turn participant",
      requestBody: {required: true, content: {"application/json": {schema: {
        type: "object", additionalProperties: false,
        required: ["tenant_id", "skill"],
        properties: {
          tenant_id: {type: "string", description: "Tenant UUID from the trusted turn context"},
          skill: {type: "string", pattern: "^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$"}
        }
      }}}},
      responses: {
        "200": {description: "Bounded authorized skill body"},
        "403": {description: "Skill is not currently authorized"}
      }
    }},
    "/agentcore/capabilities/email/send": {post: {
      operationId: "send_email",
      summary: "Send or request approval for one idempotent policy-governed email",
      requestBody: {required: true, content: {"application/json": {schema: {
        type: "object", additionalProperties: false,
        required: ["tenant_id", "to", "subject", "content"],
        properties: {
          tenant_id: {type: "string", description: "Tenant UUID from the trusted turn context"},
          to: {type: "array", minItems: 1, maxItems: 5, items: {type: "string", format: "email", maxLength: 320}},
          subject: {type: "string", minLength: 1, maxLength: 500},
          content: {type: "string", minLength: 1, maxLength: 60000, description: "Complete email message body"}
        }
      }}}},
      responses: {
        "200": {description: "Email sent or replayed safely"},
        "202": {description: "First-send human review requested"}
      }
    }}
  }
}')"

jq -n \
  --arg name "$TARGET_NAME" \
  --arg schema "$openapi_payload" \
  --arg providerArn "$OAUTH_CREDENTIAL_PROVIDER_ARN" \
  --arg returnUrl "$OAUTH_RETURN_URL" \
  '{
    name: $name,
    description: "THINK-316 OAuth owner-isolation target",
    targetConfiguration: {mcp: {openApiSchema: {inlinePayload: $schema}}},
    credentialProviderConfigurations: [{
      credentialProviderType: "OAUTH",
      credentialProvider: {oauthCredentialProvider: {
        providerArn: $providerArn,
        scopes: ["owner.read"],
        grantType: "TOKEN_EXCHANGE"
      }}
    }]
  }' >"$tmp_dir/target.json"

target_id="$(aws bedrock-agentcore-control list-gateway-targets \
  --region "$AWS_REGION" --gateway-identifier "$gateway_id" --output json \
  | jq -r --arg name "$TARGET_NAME" '(.items // .targets // [])[] | select(.name == $name) | .targetId' \
  | head -n 1)"
if [[ -z "$target_id" ]]; then
  target_id="$(jq --arg gateway "$gateway_id" '. + {gatewayIdentifier: $gateway}' \
    "$tmp_dir/target.json" >"$tmp_dir/target-create.json" && \
    aws bedrock-agentcore-control create-gateway-target --region "$AWS_REGION" \
      --cli-input-json "file://$tmp_dir/target-create.json" --query targetId --output text)"
else
  jq --arg gateway "$gateway_id" --arg target "$target_id" \
    '. + {gatewayIdentifier: $gateway, targetId: $target}' \
    "$tmp_dir/target.json" >"$tmp_dir/target-update.json"
  aws bedrock-agentcore-control update-gateway-target --region "$AWS_REGION" \
    --cli-input-json "file://$tmp_dir/target-update.json" >/dev/null
fi

target_status=""
for _ in $(seq 1 90); do
  target_status="$(aws bedrock-agentcore-control get-gateway-target \
    --region "$AWS_REGION" --gateway-identifier "$gateway_id" --target-id "$target_id" \
    --query status --output text 2>/dev/null || true)"
  [[ "$target_status" == "READY" || "$target_status" == "CREATE_PENDING_AUTH" || "$target_status" == "UPDATE_PENDING_AUTH" ]] && break
  [[ "$target_status" == "FAILED" || "$target_status" == "UPDATE_UNSUCCESSFUL" ]] && {
    printf 'target %s entered terminal status %s\n' "$target_id" "$target_status" >&2; exit 1;
  }
  sleep 2
done
[[ "$target_status" == "READY" || "$target_status" == "CREATE_PENDING_AUTH" || "$target_status" == "UPDATE_PENDING_AUTH" ]] || {
  printf 'target %s never reached a usable authorization state (last=%s)\n' "$target_id" "$target_status" >&2; exit 1;
}

# Explicit OAuthUser principal branches make the owner match mechanically
# reviewable and let Cedar reject cross-owner requests before AgentCore resolves
# a target credential. AgentCore maps JWT `sub` to the principal entity id (not
# a tag) and accepts one Cedar statement per policy definition. Connector and
# tool assignments are mutable ThinkWork state, so Cedar provides authenticated
# tenant admission while the target re-authorizes the live turn, connector, and
# tool assignment before resolving credentials or invoking the provider.
IFS=',' read -r -a proof_owners <<<"$PROOF_OWNER_ALLOWLIST"
owner_conditions=""
first_owner=""
for raw_owner in "${proof_owners[@]}"; do
  owner="$(tr '[:upper:]' '[:lower:]' <<<"$raw_owner" | xargs)"
  [[ "$owner" =~ ^[a-z0-9-]{1,128}$ ]] || {
    printf 'invalid proof owner subject\n' >&2
    exit 1
  }
  branch="(principal == AgentCore::OAuthUser::\"${owner}\" && context.input.requested_owner == \"${owner}\")"
  [[ -z "$owner_conditions" ]] || owner_conditions+=$' ||\n    '
  owner_conditions+="$branch"
  [[ -n "$first_owner" ]] || first_owner="$owner"
done
[[ "${#proof_owners[@]}" -ge 2 ]] || {
  printf 'at least two proof owners are required\n' >&2
  exit 1
}
cedar_statement="$(cat <<CEDAR
permit(
  principal,
  action in [
    AgentCore::Action::"${TARGET_NAME}___owner_probe",
    AgentCore::Action::"${TARGET_NAME}___mixed_disclosure",
    AgentCore::Action::"${TARGET_NAME}___list_connector_tools",
    AgentCore::Action::"${TARGET_NAME}___call_connector_tool",
    AgentCore::Action::"${TARGET_NAME}___execute_code",
    AgentCore::Action::"${TARGET_NAME}___web_search",
    AgentCore::Action::"${TARGET_NAME}___web_extract",
    AgentCore::Action::"${TARGET_NAME}___query_brain",
    AgentCore::Action::"${TARGET_NAME}___list_workspace_skills",
    AgentCore::Action::"${TARGET_NAME}___load_workspace_skill",
    AgentCore::Action::"${TARGET_NAME}___send_email"
  ],
  resource == AgentCore::Gateway::"${gateway_arn}"
)
when {
  principal.hasTag("tenant_id") &&
  principal.hasTag("purpose") &&
  principal.getTag("purpose") == "gateway_operation" &&
  (
    (
      action == AgentCore::Action::"${TARGET_NAME}___owner_probe" &&
      (${owner_conditions})
    ) ||
    (
      action == AgentCore::Action::"${TARGET_NAME}___mixed_disclosure" &&
      principal == AgentCore::OAuthUser::"${first_owner}" &&
      context.input.requested_owner == "${first_owner}"
    ) ||
    (
      (
        action == AgentCore::Action::"${TARGET_NAME}___list_connector_tools" ||
        action == AgentCore::Action::"${TARGET_NAME}___call_connector_tool" ||
        action == AgentCore::Action::"${TARGET_NAME}___execute_code" ||
        action == AgentCore::Action::"${TARGET_NAME}___web_search" ||
        action == AgentCore::Action::"${TARGET_NAME}___web_extract" ||
        action == AgentCore::Action::"${TARGET_NAME}___query_brain" ||
        action == AgentCore::Action::"${TARGET_NAME}___list_workspace_skills" ||
        action == AgentCore::Action::"${TARGET_NAME}___load_workspace_skill" ||
        action == AgentCore::Action::"${TARGET_NAME}___send_email"
      ) &&
      context.input.tenant_id == principal.getTag("tenant_id")
    )
  )
};
CEDAR
)"

jq -n --arg name "$POLICY_NAME" --arg engine "$policy_engine_id" \
  --arg statement "$cedar_statement" '{
    name: $name,
    description: "THINK-316 exact-user admission; target owns dynamic capability authorization",
    definition: {cedar: {statement: $statement}},
    validationMode: "FAIL_ON_ANY_FINDINGS",
    policyEngineId: $engine
  }' >"$tmp_dir/policy.json"

policy_id="$(aws bedrock-agentcore-control list-policies --region "$AWS_REGION" \
  --policy-engine-id "$policy_engine_id" --output json \
  | jq -r --arg name "$POLICY_NAME" '(.policies // .items // [])[] | select(.name == $name) | .policyId' \
  | head -n 1)"
if [[ -z "$policy_id" ]]; then
  policy_id="$(aws bedrock-agentcore-control create-policy --region "$AWS_REGION" \
    --cli-input-json "file://$tmp_dir/policy.json" --query policyId --output text)"
else
  jq --arg id "$policy_id" '{
      policyEngineId, policyId: $id, description: {optionalValue: .description},
      definition, validationMode
    }' "$tmp_dir/policy.json" >"$tmp_dir/policy-update.json"
  aws bedrock-agentcore-control update-policy --region "$AWS_REGION" \
    --cli-input-json "file://$tmp_dir/policy-update.json" >/dev/null
fi
wait_policy_status "$policy_engine_id" "$policy_id"

printf 'AgentCore Gateway proof resources reconciled: gateway=%s target=%s engine=%s policy=%s\n' \
  "$gateway_id" "$target_id" "$policy_engine_id" "$policy_id"
