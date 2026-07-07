/**
 * Public artifact share route (THINK-208 U4): GET /share/{token}.
 *
 * Unauthenticated by design — the HMAC-signed token is the access grant
 * (KTD-1/KTD-3). The handler does exactly: verify token signature → load the
 * active share row → load the artifact and confirm document kind → read the
 * compiled render from S3 → inject the attribution footer + noindex → return
 * HTML. Every miss at every step collapses to the same 404 so revoked,
 * deleted, non-document, and never-existed links are indistinguishable (R9,
 * R10). This is a dedicated narrow handler, never a widening of shared auth
 * (service-endpoint-vs-widening learning); the render still flows through an
 * access-gated code path, not a presigned URL.
 *
 * The renders are DocSpector-validated scriptless single-file documents, but
 * this footer injection sits outside that validation boundary — every
 * artifact-derived string is HTML-entity-escaped before interpolation.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and, isNull } from "drizzle-orm";
import { artifacts, artifactShares } from "@thinkwork/database-pg/schema";
import { db } from "../lib/db.js";
import { verifyShareToken } from "../lib/artifacts/share-tokens.js";
import { isDocumentMetadata } from "../lib/artifacts/document-emission.js";
import {
  artifactRenderKey,
  readArtifactPayloadFromS3,
} from "../lib/artifacts/payload-storage.js";

export interface ShareRow {
  id: string;
  tenant_id: string;
  artifact_id: string;
}

export interface ShareArtifactRow {
  id: string;
  tenant_id: string;
  title: string;
  metadata: unknown;
}

export interface ArtifactShareHandlerDeps {
  verifyToken?: (token: string) => string | null;
  loadActiveShare?: (shareId: string) => Promise<ShareRow | null>;
  loadArtifact?: (artifactId: string) => Promise<ShareArtifactRow | null>;
  readRender?: (input: {
    tenantId: string;
    artifactId: string;
  }) => Promise<string>;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NOT_FOUND: APIGatewayProxyStructuredResultV2 = {
  statusCode: 404,
  headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  },
  body: "Not found",
};

const ROBOTS_META = '<meta name="robots" content="noindex">';

function footerFragment(title: string): string {
  const safeTitle = escapeHtml(title);
  return (
    '<footer style="position:sticky;bottom:0;display:flex;align-items:center;' +
    "justify-content:space-between;gap:1rem;padding:0.5rem 1rem;" +
    "font:13px/1.4 system-ui,sans-serif;background:rgba(127,127,127,0.08);" +
    'border-top:1px solid rgba(127,127,127,0.25);backdrop-filter:blur(4px)">' +
    `<span>${safeTitle}</span>` +
    "<span>Shared via ThinkWork</span>" +
    "</footer>"
  );
}

/**
 * Compose the public page: robots meta into <head>, footer before </body>.
 * The renders are single-file documents, so last-index-of insertion is
 * reliable; missing markers degrade to append-at-end.
 */
export function composeSharePage(render: string, title: string): string {
  let page = render;

  const headClose = page.indexOf("</head>");
  if (headClose >= 0) {
    page = page.slice(0, headClose) + ROBOTS_META + page.slice(headClose);
  } else {
    page = ROBOTS_META + page;
  }

  const footer = footerFragment(title);
  const bodyClose = page.lastIndexOf("</body>");
  if (bodyClose >= 0) {
    page = page.slice(0, bodyClose) + footer + page.slice(bodyClose);
  } else {
    page = page + footer;
  }
  return page;
}

function defaultDeps(): Required<ArtifactShareHandlerDeps> {
  return {
    verifyToken: verifyShareToken,
    loadActiveShare: async (shareId) => {
      const [row] = await db
        .select({
          id: artifactShares.id,
          tenant_id: artifactShares.tenant_id,
          artifact_id: artifactShares.artifact_id,
        })
        .from(artifactShares)
        .where(
          and(
            eq(artifactShares.id, shareId),
            isNull(artifactShares.revoked_at),
          ),
        );
      return row ?? null;
    },
    loadArtifact: async (artifactId) => {
      const [row] = await db
        .select({
          id: artifacts.id,
          tenant_id: artifacts.tenant_id,
          title: artifacts.title,
          metadata: artifacts.metadata,
        })
        .from(artifacts)
        .where(eq(artifacts.id, artifactId));
      return row ?? null;
    },
    readRender: async ({ tenantId, artifactId }) =>
      readArtifactPayloadFromS3({
        tenantId,
        key: artifactRenderKey({ tenantId, artifactId }),
      }),
  };
}

export function createArtifactShareHandler(
  overrides: ArtifactShareHandlerDeps = {},
) {
  return async function artifactShareHandler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const deps = { ...defaultDeps(), ...overrides };
    try {
      if (event.requestContext.http.method !== "GET") return NOT_FOUND;

      const token =
        event.pathParameters?.token ??
        decodeURIComponent(event.rawPath.replace(/^\/share\//, ""));
      if (!token) return NOT_FOUND;

      const shareId = deps.verifyToken(token);
      if (!shareId) return NOT_FOUND;

      const share = await deps.loadActiveShare(shareId);
      if (!share) return NOT_FOUND;

      const artifact = await deps.loadArtifact(share.artifact_id);
      // Defense in depth: cascade delete should have removed the share row,
      // and only document artifacts are ever shared — both misses 404.
      if (!artifact || !isDocumentMetadata(artifact.metadata)) {
        return NOT_FOUND;
      }

      let render: string;
      try {
        render = await deps.readRender({
          tenantId: share.tenant_id,
          artifactId: share.artifact_id,
        });
      } catch {
        // Missing/unreadable render: same uniform 404 — never leak key or
        // tenant detail to an anonymous caller.
        return NOT_FOUND;
      }

      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          // The token is a bearer credential in the URL: without no-referrer,
          // browsers leak it in Referer to any origin the document links to.
          "Referrer-Policy": "no-referrer",
          "X-Robots-Tag": "noindex, nofollow",
          "Cache-Control": "no-store",
        },
        body: composeSharePage(render, artifact.title),
      };
    } catch {
      return NOT_FOUND;
    }
  };
}

export const handler = createArtifactShareHandler();
