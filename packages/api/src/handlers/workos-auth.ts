import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  WorkosAuthError,
  completeWorkosCallback,
  createDefaultWorkosAuthDeps,
  createWorkosAuthorizeRedirect,
} from "../lib/workos-auth.js";
import { handleCors, json } from "../lib/response.js";

export function createWorkosAuthHandler(
  deps = createDefaultWorkosAuthDeps(),
) {
  return async function workosAuthHandler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const preflight = handleCors(event);
    if (preflight) return preflight;

    if (event.requestContext.http.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    try {
      if (event.rawPath === "/api/auth/workos/authorize") {
        const query = event.queryStringParameters ?? {};
        const redirect = await createWorkosAuthorizeRedirect({
          trustedDomainName: event.requestContext.domainName,
          redirectUri: query.redirect_uri,
          returnTo: query.return_to ?? query.next,
          provider: query.provider,
          prompt: query.prompt ?? "select_account",
          deps,
        });
        return redirectResponse(redirect);
      }

      if (event.rawPath === "/api/auth/workos/callback") {
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
          deps,
        });
        return redirectResponse(redirect);
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      const statusCode = error instanceof WorkosAuthError ? error.statusCode : 500;
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
