/**
 * THINK-208 U4 test scenarios: valid-token render with footer + anti-discovery
 * headers, uniform 404s for every miss class, XSS-safe footer interpolation,
 * and marker-less render fallback.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

vi.mock("../lib/db.js", () => ({ db: {} }));
vi.mock("../lib/artifacts/document-emission.js", () => ({
  isDocumentMetadata: (metadata: unknown) =>
    !!metadata &&
    typeof metadata === "object" &&
    (metadata as { kind?: unknown }).kind === "document",
}));

import {
  createArtifactShareHandler,
  composeSharePage,
  escapeHtml,
} from "./artifact-share.js";
import {
  signShareToken,
  verifyShareToken,
} from "../lib/artifacts/share-tokens.js";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const ARTIFACT_ID = "77777777-7777-7777-7777-777777777777";
const SHARE_ID = "88888888-8888-8888-8888-888888888888";

const RENDER =
  "<!doctype html><html><head><title>Doc</title></head>" +
  "<body><h1>Q2 numbers</h1></body></html>";

function gatewayEvent(token: string, method = "GET"): APIGatewayProxyEventV2 {
  return {
    rawPath: `/share/${token}`,
    pathParameters: { token },
    requestContext: { http: { method } },
  } as unknown as APIGatewayProxyEventV2;
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    verifyToken: verifyShareToken,
    loadActiveShare: vi.fn(async (shareId: string) =>
      shareId === SHARE_ID
        ? { id: SHARE_ID, tenant_id: TENANT_ID, artifact_id: ARTIFACT_ID }
        : null,
    ),
    loadArtifact: vi.fn(async () => ({
      id: ARTIFACT_ID,
      tenant_id: TENANT_ID,
      title: "Q2 Review",
      metadata: { kind: "document" },
    })),
    readRender: vi.fn(async () => RENDER),
    ...overrides,
  };
}

beforeEach(() => {
  process.env.API_AUTH_SECRET = "test-share-secret";
});

describe("artifact-share handler", () => {
  it("serves the render with footer and anti-discovery headers (F2/AE1)", async () => {
    const handler = createArtifactShareHandler(makeDeps());
    const res = await handler(gatewayEvent(signShareToken(SHARE_ID)));

    expect(res.statusCode).toBe(200);
    expect(res.headers?.["Content-Type"]).toContain("text/html");
    expect(res.headers?.["X-Robots-Tag"]).toBe("noindex, nofollow");
    expect(res.headers?.["Referrer-Policy"]).toBe("no-referrer");
    expect(res.headers?.["Cache-Control"]).toBe("no-store");
    expect(res.body).toContain("Q2 numbers");
    expect(res.body).toContain("Shared via ThinkWork");
    expect(res.body).toContain('<meta name="robots" content="noindex">');
  });

  it("returns identical 404s for unknown id, revoked, bad signature, malformed (AE2)", async () => {
    const deps = makeDeps({ loadActiveShare: vi.fn(async () => null) });
    const handler = createArtifactShareHandler(deps);

    const revokedOrUnknown = await handler(
      gatewayEvent(signShareToken(SHARE_ID)),
    );
    const otherId = await handler(
      gatewayEvent(signShareToken("99999999-9999-9999-9999-999999999999")),
    );
    const badSig = await handler(
      gatewayEvent(
        `${Buffer.from(SHARE_ID).toString("base64url")}.forged-signature`,
      ),
    );
    const malformed = await handler(gatewayEvent("garbage"));

    for (const res of [revokedOrUnknown, otherId, badSig, malformed]) {
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe("Not found");
      expect(res.headers).toEqual(revokedOrUnknown.headers);
    }
  });

  it("404s when the artifact is gone (cascade-deleted share target, AE5)", async () => {
    const handler = createArtifactShareHandler(
      makeDeps({ loadArtifact: vi.fn(async () => null) }),
    );
    const res = await handler(gatewayEvent(signShareToken(SHARE_ID)));
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe("Not found");
  });

  it("404s for a non-document artifact (defense in depth)", async () => {
    const handler = createArtifactShareHandler(
      makeDeps({
        loadArtifact: vi.fn(async () => ({
          id: ARTIFACT_ID,
          tenant_id: TENANT_ID,
          title: "Canvas",
          metadata: { kind: "json_render_canvas" },
        })),
      }),
    );
    const res = await handler(gatewayEvent(signShareToken(SHARE_ID)));
    expect(res.statusCode).toBe(404);
  });

  it("escapes a hostile document title in the footer", async () => {
    const hostile = `<script>alert(1)</script>"><img src=x onerror=alert(2)>`;
    const handler = createArtifactShareHandler(
      makeDeps({
        loadArtifact: vi.fn(async () => ({
          id: ARTIFACT_ID,
          tenant_id: TENANT_ID,
          title: hostile,
          metadata: { kind: "document" },
        })),
      }),
    );
    const res = await handler(gatewayEvent(signShareToken(SHARE_ID)));
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("<script>alert(1)");
    expect(res.body).not.toContain("<img src=x");
    expect(res.body).toContain(escapeHtml(hostile));
  });

  it("appends the footer at end when the render has no </body>", async () => {
    const handler = createArtifactShareHandler(
      makeDeps({ readRender: vi.fn(async () => "<h1>bare fragment</h1>") }),
    );
    const res = await handler(gatewayEvent(signShareToken(SHARE_ID)));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("bare fragment");
    expect(res.body?.endsWith("</footer>")).toBe(true);
  });

  it("404s on S3 read failure without leaking key or tenant detail", async () => {
    const handler = createArtifactShareHandler(
      makeDeps({
        readRender: vi.fn(async () => {
          throw new Error(
            `NoSuchKey: tenants/${TENANT_ID}/artifact-payloads/...`,
          );
        }),
      }),
    );
    const res = await handler(gatewayEvent(signShareToken(SHARE_ID)));
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe("Not found");
    expect(res.body).not.toContain(TENANT_ID);
  });

  it("rejects non-GET methods with the same 404", async () => {
    const handler = createArtifactShareHandler(makeDeps());
    const res = await handler(gatewayEvent(signShareToken(SHARE_ID), "POST"));
    expect(res.statusCode).toBe(404);
  });
});

describe("composeSharePage", () => {
  it("inserts robots meta before </head> and footer before </body>", () => {
    const page = composeSharePage(RENDER, "Title");
    expect(page.indexOf('<meta name="robots"')).toBeLessThan(
      page.indexOf("</head>"),
    );
    expect(page.indexOf("<footer")).toBeLessThan(page.indexOf("</body>"));
    expect(page.indexOf("<footer")).toBeGreaterThan(page.indexOf("<h1"));
  });
});
