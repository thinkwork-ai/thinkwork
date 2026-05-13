import { createHash } from "node:crypto";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { assertCanPromoteDraftApplet } from "../../../lib/applets/access.js";
import {
  buildDraftAppletSourceDigest,
  verifyDraftAppletPromotionProof,
} from "../../../lib/applets/draft-promotion.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { saveAppletInner, type SaveAppletPayload } from "./applet.shared.js";

export interface PromoteDraftAppletInput {
  draftId: string;
  computerId: string;
  threadId: string;
  name: string;
  files: unknown;
  metadata?: unknown;
  sourceDigest: string;
  promotionProof: string;
  promotionProofExpiresAt: string;
}

export async function promoteDraftApplet(
  _parent: any,
  args: { input: PromoteDraftAppletInput },
  ctx: GraphQLContext,
): Promise<SaveAppletPayload> {
  const caller = await resolveCaller(ctx);
  const tenantId = caller.tenantId;
  if (!tenantId) {
    return failure(
      "FORBIDDEN",
      "Draft applet promotion requires a tenant caller.",
    );
  }

  try {
    assertCanPromoteDraftApplet(ctx, tenantId, caller);
  } catch (err) {
    return failureFromError(err);
  }

  const normalized = normalizePromotionInput(args.input);
  if (!normalized.ok) return failure(normalized.code, normalized.message);

  const computedDigest = buildDraftAppletSourceDigest(normalized.files);
  if (computedDigest !== normalized.sourceDigest) {
    return failure(
      "BAD_USER_INPUT",
      "Draft applet source digest does not match submitted files.",
    );
  }

  const proofValid = verifyDraftAppletPromotionProof({
    tenantId,
    computerId: normalized.computerId,
    threadId: normalized.threadId,
    draftId: normalized.draftId,
    sourceDigest: normalized.sourceDigest,
    expiresAt: normalized.promotionProofExpiresAt,
    promotionProof: normalized.promotionProof,
  });
  if (!proofValid) {
    return failure(
      "FORBIDDEN",
      "Draft applet promotion proof is invalid or expired.",
    );
  }

  return saveAppletInner({
    ctx,
    tenantId,
    promotionCaller: caller,
    regenerate: false,
    writeMode: "draft_promotion",
    input: {
      appId: appIdFromDraftId({
        tenantId,
        threadId: normalized.threadId,
        draftId: normalized.draftId,
      }),
      name: normalized.name,
      files: normalized.files,
      metadata: {
        ...normalized.metadata,
        threadId: normalized.threadId,
        sourceDigest: normalized.sourceDigest,
        draftPreview: {
          draftId: normalized.draftId,
          sourceDigest: normalized.sourceDigest,
          promotedAt: new Date().toISOString(),
          promotionProofExpiresAt: normalized.promotionProofExpiresAt,
        },
      },
    },
  });
}

function normalizePromotionInput(input: PromoteDraftAppletInput):
  | {
      ok: true;
      draftId: string;
      computerId: string;
      threadId: string;
      name: string;
      files: Record<string, string>;
      metadata: Record<string, unknown>;
      sourceDigest: string;
      promotionProof: string;
      promotionProofExpiresAt: string;
    }
  | { ok: false; code: string; message: string } {
  const files = parseFiles(input.files);
  if (!files) {
    return {
      ok: false,
      code: "BAD_USER_INPUT",
      message: "Draft applet promotion requires source files.",
    };
  }
  const metadata = parseObject(input.metadata) ?? {};
  if (
    typeof metadata.threadId === "string" &&
    metadata.threadId.trim() &&
    metadata.threadId !== input.threadId
  ) {
    return {
      ok: false,
      code: "BAD_USER_INPUT",
      message: "Draft applet metadata threadId does not match promotion input.",
    };
  }

  for (const [field, value] of Object.entries({
    draftId: input.draftId,
    computerId: input.computerId,
    threadId: input.threadId,
    name: input.name,
    sourceDigest: input.sourceDigest,
    promotionProof: input.promotionProof,
    promotionProofExpiresAt: input.promotionProofExpiresAt,
  })) {
    if (typeof value !== "string" || !value.trim()) {
      return {
        ok: false,
        code: "BAD_USER_INPUT",
        message: `Draft applet promotion ${field} is required.`,
      };
    }
  }

  return {
    ok: true,
    draftId: input.draftId.trim(),
    computerId: input.computerId.trim(),
    threadId: input.threadId.trim(),
    name: input.name.trim(),
    files,
    metadata,
    sourceDigest: input.sourceDigest.trim(),
    promotionProof: input.promotionProof.trim(),
    promotionProofExpiresAt: input.promotionProofExpiresAt.trim(),
  };
}

function parseFiles(input: unknown): Record<string, string> | null {
  const files = parseObject(input);
  if (!files) return null;
  const entries = Object.entries(files);
  if (!entries.length) return null;
  const parsed: Record<string, string> = {};
  for (const [name, source] of entries) {
    if (typeof source !== "string") return null;
    parsed[name] = source;
  }
  return typeof parsed["App.tsx"] === "string" && parsed["App.tsx"].trim()
    ? parsed
    : null;
}

function parseObject(input: unknown): Record<string, unknown> | null {
  if (!input) return null;
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

function appIdFromDraftId(input: {
  tenantId: string;
  threadId: string;
  draftId: string;
}) {
  const bytes = createHash("sha256")
    .update(`${input.tenantId}\n${input.threadId}\n${input.draftId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function failureFromError(err: unknown): SaveAppletPayload {
  if (err instanceof GraphQLError) {
    return failure(
      String(err.extensions.code ?? "BAD_USER_INPUT"),
      err.message,
    );
  }
  return failure(
    "BAD_USER_INPUT",
    err instanceof Error ? err.message : String(err),
  );
}

function failure(code: string, message: string): SaveAppletPayload {
  return {
    ok: false,
    appId: null,
    version: null,
    validated: false,
    persisted: false,
    errors: [{ code, message }],
  };
}
