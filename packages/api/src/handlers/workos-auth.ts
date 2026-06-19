import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  WorkosAuthError,
  type WorkosAuthDeps,
  completeWorkosCallback,
  createDefaultWorkosAuthDeps,
  createWorkosAuthorizeRedirect,
} from "../lib/workos-auth.js";
import {
  WorkosBridgeError,
  createDefaultWorkosCognitoBridgeDeps,
  exchangeWorkosBridgeForCognitoTokens,
  type WorkosCognitoBridgeDeps,
} from "../lib/workos-cognito-bridge.js";
import {
  WorkosLogoutError,
  createDefaultWorkosLogoutDeps,
  createWorkosLogoutRedirect,
  type WorkosLogoutDeps,
} from "../lib/workos-auth-session.js";
import { handleCors, json } from "../lib/response.js";

export interface WorkosAuthHandlerDeps {
  workosAuthDeps?: WorkosAuthDeps;
  bridgeDeps?: WorkosCognitoBridgeDeps;
  logoutDeps?: WorkosLogoutDeps;
}

export function createWorkosAuthHandler(deps: WorkosAuthHandlerDeps = {}) {
  const workosAuthDeps = deps.workosAuthDeps ?? createDefaultWorkosAuthDeps();
  const bridgeDeps = deps.bridgeDeps ?? createDefaultWorkosCognitoBridgeDeps();
  const logoutDeps = deps.logoutDeps ?? createDefaultWorkosLogoutDeps();

  return async function workosAuthHandler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const preflight = handleCors(event);
    if (preflight) return preflight;

    try {
      const method = event.requestContext.http.method;
      if (event.rawPath === "/api/auth/workos/authorize" && method === "GET") {
        const query = event.queryStringParameters ?? {};
        const redirect = await createWorkosAuthorizeRedirect({
          trustedDomainName: event.requestContext.domainName,
          redirectUri: query.redirect_uri,
          returnTo: query.return_to ?? query.next,
          provider: query.provider,
          prompt: query.prompt ?? "select_account",
          deps: workosAuthDeps,
        });
        return redirectResponse(redirect);
      }

      if (event.rawPath === "/api/auth/workos/callback" && method === "GET") {
        const query = event.queryStringParameters ?? {};
        if (query.error) {
          throw new WorkosAuthError("WorkOS provider returned an error", 400);
        }
        const redirect = await completeWorkosCallback({
          trustedDomainName: event.requestContext.domainName,
          code: query.code,
          state: query.state,
          ipAddress: event.requestContext.http.sourceIp,
          userAgent: event.requestContext.http.userAgent,
          deps: workosAuthDeps,
        });
        return redirectResponse(redirect);
      }

      if (event.rawPath === "/api/auth/workos/bridge" && method === "POST") {
        const body = parseJsonBody(event);
        const tokens = await exchangeWorkosBridgeForCognitoTokens({
          bridgeCode:
            stringBodyField(body, "bridge_code") ??
            stringBodyField(body, "workos_bridge"),
          deps: bridgeDeps,
        });
        return json(tokens);
      }

      if (event.rawPath === "/api/auth/workos/logout" && method === "POST") {
        const body = parseJsonBody(event);
        const result = await createWorkosLogoutRedirect({
          headers: event.headers as Record<string, string | undefined>,
          returnTo:
            stringBodyField(body, "return_to") ??
            stringBodyField(body, "returnTo"),
          deps: logoutDeps,
        });
        return json(result);
      }

      if (
        event.rawPath === "/api/auth/workos/authorize" ||
        event.rawPath === "/api/auth/workos/callback" ||
        event.rawPath === "/api/auth/workos/bridge" ||
        event.rawPath === "/api/auth/workos/logout"
      ) {
        return json({ error: "Method not allowed" }, 405);
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      const statusCode =
        error instanceof WorkosAuthError ||
        error instanceof WorkosBridgeError ||
        error instanceof WorkosLogoutError
          ? error.statusCode
          : 500;
      console.error("[workos-auth] failed:", {
        statusCode,
        message: error instanceof Error ? error.message : String(error),
      });
      return json({ error: "WorkOS authentication failed" }, statusCode);
    }
  };
}

export const handler = createWorkosAuthHandler();

function redirectResponse(location: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store, max-age=0",
    },
    body: "",
  };
}

function parseJsonBody(event: APIGatewayProxyEventV2): Record<string, unknown> {
  const raw = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body
    : "{}";
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new WorkosBridgeError("request body is not valid JSON", 400);
  }
}

function stringBodyField(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}
