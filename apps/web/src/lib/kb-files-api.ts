/**
 * KB Documents API client. Backs both the end-user read-only browse and the
 * operator console (list/upload/delete) in Spaces. Uploads/deletes are
 * operator-gated at the UI and re-authorized server-side.
 */

import { apiFetch, ApiError } from "@/lib/api-fetch";

async function kbFilesApi<T>(body: Record<string, unknown>): Promise<T> {
  try {
    return await apiFetch<T>("/api/knowledge-bases/files", {
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

interface ListDocumentsResponse {
  files?: KbDocument[];
}

export async function listDocuments(kbId: string): Promise<KbDocument[]> {
  const data = await kbFilesApi<ListDocumentsResponse>({
    action: "list",
    kbId,
  });
  return data.files ?? [];
}

interface UploadUrlResponse {
  uploadUrl?: string;
}

export async function uploadDocument(kbId: string, file: File): Promise<void> {
  // Step 1: presigned PUT URL from the Lambda.
  const data = await kbFilesApi<UploadUrlResponse>({
    action: "getUploadUrl",
    kbId,
    filename: file.name,
    contentType: file.type || "application/octet-stream",
  });
  if (!data.uploadUrl) throw new Error("Failed to get upload URL");

  // Step 2: upload the bytes straight to S3.
  const uploadRes = await fetch(data.uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  if (!uploadRes.ok) throw new Error(`S3 upload failed: ${uploadRes.status}`);
}

export async function deleteDocument(
  kbId: string,
  filename: string,
): Promise<void> {
  await kbFilesApi({ action: "delete", kbId, filename });
}

/** One manifest row: a document indexed (or in flight) in the KB, across
 * managed uploads and connected external buckets alike. */
export interface KbManifestDocument {
  id: string;
  documentKey: string;
  name: string;
  status: string;
  sourceKind: string;
  updatedAt: string | null;
}

interface ListManifestResponse {
  documents?: KbManifestDocument[];
  total?: number;
}

export async function listManifestDocuments(
  kbId: string,
  limit: number,
  offset: number,
): Promise<{ documents: KbManifestDocument[]; total: number }> {
  const data = await kbFilesApi<ListManifestResponse>({
    action: "listManifest",
    kbId,
    limit,
    offset,
  });
  return { documents: data.documents ?? [], total: data.total ?? 0 };
}

interface ViewUrlResponse {
  viewUrl?: string;
}

export async function getDocumentViewUrl(
  kbId: string,
  documentId: string,
): Promise<string> {
  const data = await kbFilesApi<ViewUrlResponse>({
    action: "getViewUrl",
    kbId,
    documentId,
  });
  if (!data.viewUrl) throw new Error("Failed to get view URL");
  return data.viewUrl;
}

export async function getDocumentViewUrlByKey(
  documentKey: string,
): Promise<string> {
  const data = await kbFilesApi<ViewUrlResponse>({
    action: "getViewUrlByKey",
    documentKey,
  });
  if (!data.viewUrl) throw new Error("Failed to get view URL");
  return data.viewUrl;
}
