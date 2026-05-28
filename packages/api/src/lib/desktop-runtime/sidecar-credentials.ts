import { createHash, randomBytes, timingSafeEqual } from "crypto";

export const DESKTOP_FINALIZE_TOKEN_PREFIX = "dps_";
export const DEFAULT_DESKTOP_SESSION_TTL_MS = 60 * 60 * 1000;

export interface DesktopSidecarCredentials {
  mode: "desktop-sidecar-session";
  expiresAt: string;
  workspace: {
    bucket: string | null;
    renderedPrefix: string | null;
  };
  aws: {
    mode: "server-brokered";
    accessKeyId: null;
    secretAccessKey: null;
    sessionToken: null;
  };
  hindsight: {
    endpoint: string | null;
  };
  finalizer: {
    authScheme: "bearer";
    tokenType: "desktop-finalize-token";
    expiresAt: string;
  };
}

export interface BuildDesktopSidecarCredentialsInput {
  now?: Date;
  ttlMs?: number;
  workspaceBucket?: string;
  renderedWorkspacePrefix?: string;
  hindsightEndpoint?: string;
}

export function createDesktopFinalizeToken(): string {
  return `${DESKTOP_FINALIZE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashDesktopFinalizeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function constantTimeHexEqual(a: string, b: string): boolean {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b)) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyDesktopFinalizeToken(
  token: string,
  expectedHash: string,
): boolean {
  if (!token.startsWith(DESKTOP_FINALIZE_TOKEN_PREFIX)) return false;
  return constantTimeHexEqual(hashDesktopFinalizeToken(token), expectedHash);
}

export function buildDesktopSidecarCredentials(
  input: BuildDesktopSidecarCredentialsInput,
): DesktopSidecarCredentials {
  const now = input.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + (input.ttlMs ?? DEFAULT_DESKTOP_SESSION_TTL_MS),
  ).toISOString();

  return {
    mode: "desktop-sidecar-session",
    expiresAt,
    workspace: {
      bucket: input.workspaceBucket || null,
      renderedPrefix: input.renderedWorkspacePrefix || null,
    },
    aws: {
      mode: "server-brokered",
      accessKeyId: null,
      secretAccessKey: null,
      sessionToken: null,
    },
    hindsight: {
      endpoint: input.hindsightEndpoint || null,
    },
    finalizer: {
      authScheme: "bearer",
      tokenType: "desktop-finalize-token",
      expiresAt,
    },
  };
}

export function assertNoStaticServiceSecrets(value: unknown): void {
  for (const marker of [
    "THINKWORK_API_SECRET",
    "API_AUTH_SECRET",
    "GRAPHQL_API_KEY",
  ]) {
    if (JSON.stringify(value).includes(marker)) {
      throw new Error(`desktop credential envelope leaked ${marker}`);
    }
  }
  if (
    value &&
    typeof value === "object" &&
    "aws" in value &&
    value.aws &&
    typeof value.aws === "object" &&
    "secretAccessKey" in value.aws &&
    value.aws.secretAccessKey
  ) {
    throw new Error("desktop credential envelope leaked AWS secret access key");
  }
}
