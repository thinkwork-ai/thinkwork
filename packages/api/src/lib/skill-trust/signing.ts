import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "@thinkwork/runtime-config";
import type { SkillTrustInputFile } from "./catalog-report.js";
import {
  computeSignedPayloadHash,
  type SkillTrustSigner,
} from "./evidence-fixes.js";

const SIGNATURE_VERSION = 1;
const SIGNATURE_ALGORITHM = "HMAC-SHA256";
const UNSIGNED_APPROVAL_ALGORITHM = "UNSIGNED-APPROVAL";

interface SkillSignatureEnvelope {
  version: number;
  algorithm: typeof SIGNATURE_ALGORITHM | typeof UNSIGNED_APPROVAL_ALGORITHM;
  slug: string;
  signedPayloadHash: string;
  signature?: string;
}

export function createConfiguredSkillTrustSigner(): SkillTrustSigner | null {
  const secret =
    getConfig("SKILL_TRUST_SIGNING_SECRET") ||
    process.env.SKILL_TRUST_SIGNING_SECRET ||
    "";
  if (!secret.trim()) return null;

  return {
    async sign({ slug, signedPayloadHash }) {
      const signature = signPayload(secret, slug, signedPayloadHash);
      return Buffer.from(
        `${JSON.stringify(
          {
            version: SIGNATURE_VERSION,
            algorithm: SIGNATURE_ALGORITHM,
            slug,
            signedPayloadHash,
            signature,
          } satisfies SkillSignatureEnvelope,
          null,
          2,
        )}\n`,
        "utf8",
      );
    },
    async verify({ slug, signedPayloadHash, signature }) {
      const parsed = parseSkillSignature(signature);
      if (!parsed) return false;
      if (parsed.slug !== slug) return false;
      if (parsed.signedPayloadHash !== signedPayloadHash) return false;
      if (parsed.algorithm !== SIGNATURE_ALGORITHM || !parsed.signature) {
        return false;
      }
      const expected = signPayload(secret, slug, signedPayloadHash);
      return timingSafeEqualHex(parsed.signature, expected);
    },
  };
}

export async function signatureStatusForFiles(input: {
  slug: string;
  files: SkillTrustInputFile[];
  signer: SkillTrustSigner | null;
}): Promise<
  | {
      status: "verified" | "present_unverified" | "stale" | "invalid";
      signedPayloadHash?: string;
    }
  | undefined
> {
  const signatureFile = input.files.find(
    (file) => file.path.toLowerCase() === "skill.oms.sig",
  );
  if (!signatureFile) return undefined;

  const currentPayloadHash = computeSignedPayloadHash(input.files);
  const parsed = parseSkillSignature(signatureFile.content);
  if (!input.signer) {
    return {
      status: "present_unverified",
      ...(parsed?.signedPayloadHash
        ? { signedPayloadHash: parsed.signedPayloadHash }
        : {}),
    };
  }
  if (!parsed) {
    return { status: "invalid", signedPayloadHash: currentPayloadHash };
  }
  if (parsed.signedPayloadHash !== currentPayloadHash) {
    return { status: "stale", signedPayloadHash: currentPayloadHash };
  }
  if (parsed.algorithm !== SIGNATURE_ALGORITHM) {
    return {
      status: "present_unverified",
      signedPayloadHash: currentPayloadHash,
    };
  }

  const verified = await input.signer.verify({
    slug: input.slug,
    signedPayloadHash: currentPayloadHash,
    signature: signatureFile.content,
    files: input.files,
  });
  return {
    status: verified ? "verified" : "invalid",
    signedPayloadHash: currentPayloadHash,
  };
}

export function signedPayloadHashForFiles(files: SkillTrustInputFile[]) {
  return computeSignedPayloadHash(files);
}

function signPayload(secret: string, slug: string, signedPayloadHash: string) {
  return createHmac("sha256", secret)
    .update(`${slug}\0${signedPayloadHash}`)
    .digest("hex");
}

function parseSkillSignature(signature: Buffer): SkillSignatureEnvelope | null {
  try {
    const parsed = JSON.parse(signature.toString("utf8")) as Partial<{
      version: unknown;
      algorithm: unknown;
      slug: unknown;
      signedPayloadHash: unknown;
      signature: unknown;
    }>;
    if (parsed.version !== SIGNATURE_VERSION) return null;
    if (
      parsed.algorithm !== SIGNATURE_ALGORITHM &&
      parsed.algorithm !== UNSIGNED_APPROVAL_ALGORITHM
    ) {
      return null;
    }
    if (typeof parsed.slug !== "string" || !parsed.slug) return null;
    if (
      typeof parsed.signedPayloadHash !== "string" ||
      !/^[a-f0-9]{64}$/i.test(parsed.signedPayloadHash)
    ) {
      return null;
    }
    if (
      parsed.algorithm === SIGNATURE_ALGORITHM &&
      (typeof parsed.signature !== "string" ||
        !/^[a-f0-9]{64}$/i.test(parsed.signature))
    ) {
      return null;
    }
    return {
      version: SIGNATURE_VERSION,
      algorithm: parsed.algorithm,
      slug: parsed.slug,
      signedPayloadHash: parsed.signedPayloadHash.toLowerCase(),
      ...(typeof parsed.signature === "string"
        ? { signature: parsed.signature.toLowerCase() }
        : {}),
    };
  } catch {
    return null;
  }
}

function timingSafeEqualHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.byteLength === rightBuffer.byteLength &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
