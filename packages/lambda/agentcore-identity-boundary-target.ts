import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { randomUUID } from "node:crypto";
import {
  proofOwnerAllowlistFromEnv,
  verifyProofProviderAccessToken,
} from "./agentcore-proof-oauth-provider.js";
import {
  projectIdentityBoundaryResult,
  projectMixedIdentityBoundaryResult,
} from "./lib/agentcore-identity-boundary/disclosure.js";

export interface IdentityBoundaryTargetDeps {
  issuer: string;
  audience: string;
  clientSecret: string;
  allowedOwners?: ReadonlySet<string>;
  nowSeconds(): number;
}

export function createIdentityBoundaryTargetHandler(
  deps: IdentityBoundaryTargetDeps,
) {
  return async function identityBoundaryTarget(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    if (
      event.requestContext.http.method !== "GET" ||
      (event.rawPath !== "/agentcore-proof/target/owner" &&
        event.rawPath !== "/agentcore-proof/target/mixed")
    ) {
      return json(404, { error: "not_found" });
    }
    // No caller-provided identity material participates in the decision. Its
    // presence is treated as an attempted boundary override and fails closed.
    if (
      event.headers["x-proof-owner"] ||
      event.headers["x-thinkwork-user-id"] ||
      event.headers["x-thinkwork-tenant-id"]
    ) {
      return json(400, { error: "identity_override_rejected" });
    }
    const authorization =
      event.headers.authorization ?? event.headers.Authorization ?? "";
    if (!authorization.startsWith("Bearer ")) {
      return json(401, { error: "provider_token_required" });
    }
    try {
      const claims = verifyProofProviderAccessToken(authorization.slice(7), {
        issuer: deps.issuer,
        audience: deps.audience,
        secret: deps.clientSecret,
        nowSeconds: deps.nowSeconds(),
        allowedOwners: deps.allowedOwners,
      });
      const requestedOwner =
        event.queryStringParameters?.requested_owner?.trim().toLowerCase() ??
        "";
      if (!requestedOwner || requestedOwner !== claims.sub) {
        // The target independently enforces the same owner binding as Cedar.
        // This keeps a policy/configuration mistake from turning an Alice-only
        // operation into a confused-deputy credential handoff.
        return json(403, { error: "owner_mismatch" });
      }
      if (
        event.rawPath === "/agentcore-proof/target/mixed" &&
        deps.allowedOwners &&
        [...deps.allowedOwners][0] !== claims.sub
      ) {
        return json(403, { error: "mixed_operation_not_allowed" });
      }
      // The private fields model data that must never traverse Gateway or
      // Harness. Only the disclosure projector's structural allowlist leaves.
      const raw = {
        owner_alias: claims.sub,
        harmless_value: `fixture-${claims.sub}`,
        task_field: `approved-summary-${claims.sub}`,
        private_note: `private-${claims.sub}`,
        secret_sentinel: `SECRET_SENTINEL_${claims.sub.toUpperCase()}`,
      };
      const projected =
        event.rawPath === "/agentcore-proof/target/mixed"
          ? projectMixedIdentityBoundaryResult(
              raw,
              requestedOwner,
              randomUUID(),
            )
          : projectIdentityBoundaryResult(raw, requestedOwner);
      return json(200, projected);
    } catch {
      return json(401, { error: "provider_token_invalid" });
    }
  };
}

function json(
  statusCode: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      pragma: "no-cache",
    },
    body: JSON.stringify(body),
  };
}

export async function handler(event: APIGatewayProxyEventV2) {
  // Resolve deployment configuration at invocation time so dependency-
  // injected tests can import this module without weakening the live path.
  const issuer = requiredEnv("AGENTCORE_PROOF_OAUTH_ISSUER");
  return createIdentityBoundaryTargetHandler({
    issuer,
    audience: `${issuer.replace(/\/+$/, "")}/target`,
    clientSecret: requiredEnv("AGENTCORE_PROOF_OAUTH_CLIENT_SECRET"),
    allowedOwners: proofOwnerAllowlistFromEnv(),
    nowSeconds: () => Math.floor(Date.now() / 1000),
  })(event);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
