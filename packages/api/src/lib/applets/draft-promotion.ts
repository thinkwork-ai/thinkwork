import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function buildDraftAppletSourceDigest(files: Record<string, string>) {
  const canonical = JSON.stringify(
    Object.keys(files)
      .sort()
      .map((name) => [name, files[name]]),
  );
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function verifyDraftAppletPromotionProof(input: {
  tenantId: string;
  computerId: string;
  threadId: string;
  draftId: string;
  sourceDigest: string;
  expiresAt: string;
  promotionProof: string;
  secret?: string | null;
  now?: Date;
}) {
  const secret =
    input.secret ??
    process.env.API_AUTH_SECRET ??
    process.env.THINKWORK_API_SECRET ??
    "";
  if (!secret) return false;
  const expiresAt = new Date(input.expiresAt);
  if (!Number.isFinite(expiresAt.getTime())) return false;
  if (expiresAt.getTime() < (input.now ?? new Date()).getTime()) return false;

  const expected = draftAppletPromotionProof({
    tenantId: input.tenantId,
    computerId: input.computerId,
    threadId: input.threadId,
    draftId: input.draftId,
    sourceDigest: input.sourceDigest,
    expiresAt: input.expiresAt,
    secret,
  });
  return timingSafeStringEqual(input.promotionProof, expected);
}

function draftAppletPromotionProof(input: {
  tenantId: string;
  computerId: string;
  threadId: string;
  draftId: string;
  sourceDigest: string;
  expiresAt: string;
  secret: string;
}) {
  const payload = [
    "draft-app-preview-v1",
    input.tenantId,
    input.computerId,
    input.threadId,
    input.draftId,
    input.sourceDigest,
    input.expiresAt,
  ].join("\n");
  const signature = createHmac("sha256", input.secret)
    .update(payload)
    .digest("hex");
  return `draft-app-preview-v1:${signature}`;
}

function timingSafeStringEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}
