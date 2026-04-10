/**
 * Knowledge Base Document API client.
 * Communicates with the KB files Lambda for list/delete and gets presigned URLs for upload.
 */

const API_URL = import.meta.env.VITE_API_URL || "";
const API_AUTH_SECRET = import.meta.env.VITE_API_AUTH_SECRET || "";

async function kbFilesApi(body: Record<string, unknown>) {
  const res = await fetch(`${API_URL}/api/knowledge-bases/files`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_AUTH_SECRET ? { Authorization: `Bearer ${API_AUTH_SECRET}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`KB Files API ${res.status}: ${text}`);
  }
  return res.json();
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
