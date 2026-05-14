import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { createHmac } from "node:crypto";
import { requireTenantMembership } from "../lib/tenant-membership.js";
import {
  error,
  forbidden,
  handleCors,
  notFound,
  unauthorized,
} from "../lib/response.js";

type ExtensionBackend = {
  baseUrl: string;
};

type ExtensionProxyConfig = Record<string, ExtensionBackend | string>;

type RequireTenantMembership = typeof requireTenantMembership;

export interface ExtensionProxyDeps {
  fetch: typeof fetch;
  requireTenantMembership: RequireTenantMembership;
  now: () => Date;
}

const EXTENSION_PATH_RE = /^\/api\/extensions\/([^/]+)(?:\/(.*))?$/;
const HOP_BY_HOP_HEADERS = new Set([
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-api-key",
  "x-tenant-id",
]);

export const handler = createExtensionProxyHandler();

export function createExtensionProxyHandler(
  deps: ExtensionProxyDeps = {
    fetch,
    requireTenantMembership,
    now: () => new Date(),
  },
) {
  return async function extensionProxyHandler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const cors = handleCors(event);
    if (cors) return cors;

    const match = event.rawPath.match(EXTENSION_PATH_RE);
    if (!match) return notFound("Extension route not found");

    const extensionId = match[1]!;
    const proxiedPath = `/${match[2] ?? ""}`;
    const backend = getConfiguredBackend(extensionId);
    if (!backend) return notFound("Extension is not enabled");

    if (!isSafeBackendUrl(backend.baseUrl)) {
      return forbidden("Extension backend is not allowlisted");
    }

    const tenantHeader = event.headers["x-tenant-id"];
    if (!tenantHeader) return error("Missing x-tenant-id header", 400);

    const membership = await deps.requireTenantMembership(event, tenantHeader, {
      requiredRoles: ["owner", "admin"],
    });
    if (!membership.ok) {
      if (membership.status === 401) return unauthorized(membership.reason);
      if (membership.status === 403) return forbidden(membership.reason);
      return notFound(membership.reason);
    }
    if (membership.auth.authType !== "cognito") {
      return forbidden(
        "Extension proxy requires first-party Admin authentication",
      );
    }

    const signingSecret = process.env.EXTENSION_PROXY_SIGNING_SECRET ?? "";
    if (!signingSecret) {
      return error("Extension proxy signing is not configured", 500);
    }

    const target = new URL(joinUrl(backend.baseUrl, proxiedPath));
    if (event.rawQueryString) target.search = event.rawQueryString;

    const context = buildContext({
      extensionId,
      tenantId: membership.tenantId,
      userId: membership.userId,
      role: membership.role,
      authType: membership.auth.authType,
      email: membership.auth.email,
      method: event.requestContext.http.method,
      path: proxiedPath,
      now: deps.now(),
    });
    const encodedContext = Buffer.from(JSON.stringify(context)).toString(
      "base64url",
    );
    const signature = createHmac("sha256", signingSecret)
      .update(encodedContext)
      .digest("base64url");

    const response = await deps.fetch(target, {
      method: event.requestContext.http.method,
      headers: {
        ...forwardableHeaders(event.headers),
        "x-thinkwork-extension-context": encodedContext,
        "x-thinkwork-extension-signature": `v1=${signature}`,
      },
      body: requestBody(event),
    });

    return proxyResponse(response);
  };
}

function getConfiguredBackend(extensionId: string): ExtensionBackend | null {
  const raw = process.env.EXTENSION_PROXY_BACKENDS_JSON ?? "{}";
  let parsed: ExtensionProxyConfig;
  try {
    parsed = JSON.parse(raw) as ExtensionProxyConfig;
  } catch {
    return null;
  }
  const entry = parsed[extensionId];
  if (!entry) return null;
  if (typeof entry === "string") return { baseUrl: entry };
  if (typeof entry.baseUrl === "string") return { baseUrl: entry.baseUrl };
  return null;
}

function isSafeBackendUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:") return isLocalhost(url);
    return true;
  } catch {
    return false;
  }
}

function isLocalhost(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
    process.env.NODE_ENV !== "production"
  );
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function requestBody(event: APIGatewayProxyEventV2): BodyInit | undefined {
  if (!event.body) return undefined;
  if (event.isBase64Encoded) return Buffer.from(event.body, "base64");
  return event.body;
}

function forwardableHeaders(headers: APIGatewayProxyEventV2["headers"]) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (!value || HOP_BY_HOP_HEADERS.has(lower)) continue;
    out[lower] = value;
  }
  return out;
}

function buildContext(args: {
  extensionId: string;
  tenantId: string;
  userId: string | null;
  role: string | null;
  authType: string;
  email: string | null;
  method: string;
  path: string;
  now: Date;
}) {
  return {
    extension_id: args.extensionId,
    tenant_id: args.tenantId,
    actor: {
      user_id: args.userId,
      email: args.email,
      role: args.role,
      auth_type: args.authType,
    },
    request: {
      method: args.method,
      path: args.path,
    },
    issued_at: args.now.toISOString(),
  };
}

async function proxyResponse(
  response: Response,
): Promise<APIGatewayProxyStructuredResultV2> {
  const contentType =
    response.headers.get("content-type") ?? "application/json";
  const body = await response.text();
  return {
    statusCode: response.status,
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, x-tenant-id, x-api-key",
    },
    body,
  };
}
