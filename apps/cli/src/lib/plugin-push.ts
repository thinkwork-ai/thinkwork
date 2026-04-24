/**
 * Push a built plugin zip to the deployed U10 REST surface.
 *
 * Three-step flow mirrors the admin SPA:
 *   1. POST /api/plugins/presign   → { uploadUrl, s3Key }
 *   2. PUT  <uploadUrl>           → browser-equivalent upload straight to S3
 *   3. POST /api/plugins/upload    → validator + three-phase install saga
 *
 * The push helper is CLI-driven, so failures bubble as thrown errors
 * with clean messages — the command wrapper catches them and exits 1.
 */

export interface PushPluginInput {
  apiUrl: string;
  headers: Record<string, string>;
  zipBuffer: Buffer;
  fileName: string;
}

export interface PushPluginInstalled {
  status: "installed";
  uploadId: string;
  plugin: {
    name: string;
    skills: Array<{ slug: string; version?: string | null }>;
    mcpServers: Array<{ name: string; url: string }>;
  };
  warnings: string[];
}

export interface PushPluginFailed {
  status: "failed";
  uploadId: string;
  phase?: string;
  errorMessage: string;
}

export interface PushPluginValidationFailed {
  status: "validation-failed";
  errors: string[];
  warnings: string[];
}

export type PushPluginResult =
  | PushPluginInstalled
  | PushPluginFailed
  | PushPluginValidationFailed;

/** Throws on network/auth errors; returns a discriminated result on content errors. */
export async function pushPluginZip(
  input: PushPluginInput,
): Promise<PushPluginResult> {
  const base = input.apiUrl.replace(/\/+$/, "");

  // 1. Presign.
  const presignRes = await fetch(`${base}/api/plugins/presign`, {
    method: "POST",
    headers: withJson(input.headers),
    body: JSON.stringify({ fileName: input.fileName }),
  });
  if (!presignRes.ok) {
    throw new Error(`presign failed: ${await describeHttpError(presignRes)}`);
  }
  const presign = (await presignRes.json()) as {
    uploadUrl: string;
    s3Key: string;
  };
  if (!presign.uploadUrl || !presign.s3Key) {
    throw new Error(
      `presign returned invalid response: ${JSON.stringify(presign)}`,
    );
  }

  // 2. PUT the zip directly to S3. The presigned URL carries its own
  // signature; adding our own auth header would invalidate it.
  // Buffer coerces to a Uint8Array view for undici's body types.
  const putRes = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/zip" },
    body: new Uint8Array(input.zipBuffer),
  });
  if (!putRes.ok) {
    throw new Error(`S3 PUT failed: HTTP ${putRes.status}`);
  }

  // 3. Trigger the three-phase install saga.
  const installRes = await fetch(`${base}/api/plugins/upload`, {
    method: "POST",
    headers: withJson(input.headers),
    body: JSON.stringify({ s3Key: presign.s3Key }),
  });
  const installBody = (await installRes.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  // Structured validation error from U9 — server returns HTTP 400 with
  // a `{valid: false, errors, warnings}` envelope.
  if (
    installRes.status === 400 &&
    installBody &&
    (installBody as { valid?: unknown }).valid === false
  ) {
    return {
      status: "validation-failed",
      errors: (installBody.errors as string[]) ?? [],
      warnings: (installBody.warnings as string[]) ?? [],
    };
  }

  // Saga failure — server returns HTTP 500 with a populated upload row.
  if (!installRes.ok) {
    const uploadId =
      typeof installBody.uploadId === "string" ? installBody.uploadId : "";
    return {
      status: "failed",
      uploadId,
      phase:
        typeof installBody.phase === "string" ? installBody.phase : undefined,
      errorMessage:
        (typeof installBody.errorMessage === "string" &&
          installBody.errorMessage) ||
        (typeof (installBody as { error?: unknown }).error === "string" &&
          ((installBody as { error?: string }).error as string)) ||
        `HTTP ${installRes.status}`,
    };
  }

  const plugin = installBody.plugin as
    | {
        name: string;
        skills: Array<{ slug: string; version?: string | null }>;
        mcpServers: Array<{ name: string; url: string }>;
      }
    | undefined;
  if (!plugin || typeof installBody.uploadId !== "string") {
    throw new Error(
      `install response missing uploadId/plugin: ${JSON.stringify(installBody)}`,
    );
  }

  return {
    status: "installed",
    uploadId: installBody.uploadId,
    plugin,
    warnings: Array.isArray(installBody.warnings)
      ? (installBody.warnings as string[])
      : [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withJson(headers: Record<string, string>): Record<string, string> {
  return { "Content-Type": "application/json", ...headers };
}

async function describeHttpError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `HTTP ${res.status} ${text.slice(0, 200)}`;
}
