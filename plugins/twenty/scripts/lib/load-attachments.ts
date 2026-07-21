/**
 * CRM attachment migration (plan U6, KTD6): query the Attachment record by
 * sourceId BEFORE uploading (never re-upload orphaned binaries on re-runs);
 * on a miss, fetch the binary from LastMile's S3 bucket, upload via Twenty's
 * multipart `uploadFile` mutation, then create the Attachment record with the
 * file reference and the direct target*Id FK. Missing binaries migrate
 * nothing for that file and are listed in the report.
 *
 * Only a handful of LastMile attachments target CRM records (the 2026-07-09
 * schema read found the other ~12.5k attach to dispatch bills-of-lading and
 * loadsheets, which do not migrate).
 */

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { LastmileCrmAttachment } from "./lastmile-reader";
import { fetchExistingBySourceIds, type EntityCounters } from "./load-records";
import { sourceId as makeSourceId } from "./mappers";
import { TwentyClient, TwentyGraphqlError } from "./twenty-client";

/**
 * TEI's Twenty exposes no file-upload mutation to a workspace API key
 * (`uploadFile` and the `Upload` scalar are absent; `/rest/files` is object
 * CRUD). Same root cause as the missing auth schema. Four LastMile attachments
 * hang off CRM records and one of those binaries is already gone from S3, so
 * this is reported as a capability gap rather than a per-record failure —
 * otherwise every future delta run would exit non-zero on the same files.
 */
export function isUploadUnsupported(error: unknown): boolean {
  const message =
    error instanceof TwentyGraphqlError
      ? error.errors.map((entry) => entry.message).join(" ")
      : error instanceof Error
        ? error.message
        : "";
  return (
    /Unknown type "Upload"/i.test(message) ||
    /Cannot query field "uploadFile"/i.test(message)
  );
}

const ATTACHMENT_ENTITY = {
  singular: "attachment",
  plural: "attachments",
  capSingular: "Attachment",
  capPlural: "Attachments",
};

export interface AttachmentUploadDeps {
  /** Fetches the binary; null when the object is missing. Defaults to S3. */
  fetchBinary?: (
    attachment: LastmileCrmAttachment,
  ) => Promise<Uint8Array | null>;
  fetchImpl?: typeof fetch;
}

export async function loadCrmAttachments(options: {
  client: TwentyClient;
  authToken: string;
  baseUrl: string;
  attachments: LastmileCrmAttachment[];
  /** target sourceId ("lead:…" or "opportunity:…") → Twenty opportunity id. */
  targetIdBySourceId: ReadonlyMap<string, string>;
  dryRun: boolean;
  counters: EntityCounters;
  deps?: AttachmentUploadDeps;
}): Promise<void> {
  const { client, attachments, targetIdBySourceId, dryRun, counters } = options;
  counters.sourceTotal += attachments.length;
  const fetchBinary = options.deps?.fetchBinary ?? makeS3BinaryFetcher();
  const fetchImpl = options.deps?.fetchImpl ?? fetch;

  const bySourceId = new Map(
    attachments.map((attachment) => [
      makeSourceId("task_attachment", attachment.id),
      attachment,
    ]),
  );
  const existing = await fetchExistingBySourceIds(client, ATTACHMENT_ENTITY, [
    ...bySourceId.keys(),
  ]);

  for (const [attachmentSourceId, attachment] of bySourceId) {
    if (existing.has(attachmentSourceId)) {
      counters.skipped += 1; // Crash-healing: record exists → no re-upload.
      continue;
    }
    const targetSourceId = makeSourceId(
      attachment.entityType,
      attachment.entityId,
    );
    const targetId = targetIdBySourceId.get(targetSourceId);
    if (!targetId) {
      counters.skipped += 1;
      counters.gaps.push(
        `attachment ${attachmentSourceId}: target ${targetSourceId} not migrated`,
      );
      continue;
    }
    if (dryRun) {
      counters.created += 1;
      counters.plannedMutations.push(
        `upload+create attachment ${attachmentSourceId} → ${targetSourceId}`,
      );
      continue;
    }

    try {
      const binary = await fetchBinary(attachment);
      if (!binary) {
        counters.gaps.push(
          `attachment ${attachmentSourceId}: binary missing (${attachment.bucketName ?? "?"}/${attachment.filePath ?? "?"})`,
        );
        continue;
      }
      const fileId = await uploadBinary({
        baseUrl: options.baseUrl,
        authToken: options.authToken,
        filename: attachment.filename ?? "attachment",
        contentType: attachment.fileType ?? "application/octet-stream",
        binary,
        fetchImpl,
        retries: 1, // Upload failure retries once, then reports and continues (U6).
      });
      await client.requestOnce(
        "/graphql",
        `mutation MigrationCreateAttachments($data: [AttachmentCreateInput!]!) {
          createAttachments(data: $data) { id }
        }`,
        {
          data: [
            {
              name: attachment.filename ?? "attachment",
              file: { fileId, label: attachment.filename ?? "attachment" },
              targetOpportunityId: targetId,
              sourceId: attachmentSourceId,
            },
          ],
        },
      );
      counters.created += 1;
    } catch (error) {
      if (isUploadUnsupported(error)) {
        counters.skipped += 1;
        counters.gaps.push(
          `attachment ${attachmentSourceId} (${attachment.filename ?? "?"}): ` +
            "Twenty exposes no file-upload API to this credential — upload by hand",
        );
        continue;
      }
      counters.failed += 1;
      counters.gaps.push(
        `attachment ${attachmentSourceId} failed: ${
          error instanceof Error ? error.message.slice(0, 300) : String(error)
        }`,
      );
    }
  }
}

function makeS3BinaryFetcher(): (
  attachment: LastmileCrmAttachment,
) => Promise<Uint8Array | null> {
  const s3 = new S3Client({});
  return async (attachment) => {
    if (!attachment.bucketName || !attachment.filePath) return null;
    try {
      const result = await s3.send(
        new GetObjectCommand({
          Bucket: attachment.bucketName,
          Key: attachment.filePath,
        }),
      );
      const bytes = await result.Body?.transformToByteArray();
      return bytes ?? null;
    } catch {
      return null;
    }
  };
}

/**
 * GraphQL multipart upload (graphql-multipart-request-spec) of a single file
 * via Twenty's `uploadFile` mutation. Returns the file id for FileItemInput.
 */
async function uploadBinary(options: {
  baseUrl: string;
  authToken: string;
  filename: string;
  contentType: string;
  binary: Uint8Array;
  fetchImpl: typeof fetch;
  retries: number;
}): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const form = new FormData();
      form.append(
        "operations",
        JSON.stringify({
          query: `mutation MigrationUpload($file: Upload!) {
            uploadFile(file: $file, fileFolder: Attachment) { path token }
          }`,
          variables: { file: null },
        }),
      );
      form.append("map", JSON.stringify({ "0": ["variables.file"] }));
      form.append(
        "0",
        new Blob([options.binary as BlobPart], { type: options.contentType }),
        options.filename,
      );
      const response = await options.fetchImpl(`${options.baseUrl}/graphql`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.authToken}`,
          "apollo-require-preflight": "true",
        },
        body: form,
      });
      const body = (await response.json()) as {
        data?: { uploadFile?: { path?: string; token?: string } };
        errors?: Array<{ message: string }>;
      };
      if (body.errors?.length) {
        throw new TwentyGraphqlError(
          `uploadFile failed: ${JSON.stringify(body.errors)}`,
          {
            errors: body.errors,
          },
        );
      }
      const path = body.data?.uploadFile?.path;
      if (!path) throw new Error("uploadFile returned no path");
      // Twenty file paths embed the file id as the first path segment under
      // the folder: e.g. "attachment/<uuid>/original/<name>". Extract the uuid.
      const match = path.match(
        /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
      );
      if (!match)
        throw new Error(`could not extract file id from upload path: ${path}`);
      return match[1];
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
