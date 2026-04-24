/**
 * Knowledge Base Document API client.
 * Communicates with the KB files Lambda for list/delete and gets presigned URLs for upload.
 */

import { apiFetch, ApiError } from "@/lib/api-fetch";

async function kbFilesApi(body: Record<string, unknown>) {
  // Preserve the legacy error shape (`KB Files API <status>: <text>`) so
  // consumers that string-match on the message keep working.
  try {
    return await apiFetch<any>("/api/knowledge-bases/files", {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof ApiError) {
      const text =
        typeof err.body === "string"
          ? err.body
          : err.body != null
            ? JSON.stringify(err.body)
            : "";
      throw new Error(`KB Files API ${err.status}: ${text}`);
    }
    throw err;
  }
}

export interface KbDocument {
  name: string;
  size: number;
  lastModified: string;
}

export async function listDocuments(kbId: string): Promise<KbDocument[]> {
  const data = await kbFilesApi({ action: "list", kbId });
  return data.files ?? [];
}

export async function uploadDocument(kbId: string, file: File): Promise<void> {
  // Step 1: Get presigned URL from Lambda
  const data = await kbFilesApi({
    action: "getUploadUrl",
    kbId,
    filename: file.name,
    contentType: file.type || "application/octet-stream",
  });

  if (!data.uploadUrl) {
    throw new Error("Failed to get upload URL");
  }

  // Step 2: Upload directly to S3 via presigned URL
  const uploadRes = await fetch(data.uploadUrl, {
    method: "PUT",
    body: file,
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
  });

  if (!uploadRes.ok) {
    throw new Error(`S3 upload failed: ${uploadRes.status}`);
  }
}

export async function deleteDocument(kbId: string, filename: string): Promise<void> {
  await kbFilesApi({ action: "delete", kbId, filename });
}
