/**
 * Read-only KB Documents API client. apps/computer surfaces tenant
 * knowledge bases for the logged-in user; uploads/deletes belong to
 * the operator console (`apps/admin`).
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
  const data = await kbFilesApi<ListDocumentsResponse>({ action: "list", kbId });
  return data.files ?? [];
}
