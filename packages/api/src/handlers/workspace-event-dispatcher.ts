import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  canonicalizeWorkspaceEvent,
  type CanonicalWorkspaceEventDraft,
  workspaceEventIdempotencyKey,
} from "../lib/workspace-events/canonicalize.js";
import { parseWorkspaceEventKey } from "../lib/workspace-events/key-parser.js";
import {
  persistWorkspaceEvent,
  type WorkspaceEventProcessResult,
} from "../lib/workspace-events/processor.js";

interface SqsEvent {
  Records?: Array<{ messageId: string; body: string }>;
}

interface BatchResponse {
  batchItemFailures: Array<{ itemIdentifier: string }>;
}

interface EventBridgeS3Event {
  "detail-type"?: string;
  detail?: {
    bucket?: { name?: string };
    object?: {
      key?: string;
      etag?: string;
      "version-id"?: string;
      sequencer?: string;
    };
  };
}

const s3 = new S3Client({
  region:
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

export const WORKSPACE_EVENT_PREFIX_PATTERNS = [
  "tenants/*/agents/*/workspace/work/inbox/*.md",
  "tenants/*/agents/*/workspace/*/work/inbox/*.md",
  "tenants/*/agents/*/workspace/work/runs/*/events/*.json",
  "tenants/*/agents/*/workspace/*/work/runs/*/events/*.json",
  "tenants/*/agents/*/workspace/work/outbox/*",
  "tenants/*/agents/*/workspace/*/work/outbox/*",
  "tenants/*/agents/*/workspace/memory/*",
  "tenants/*/agents/*/workspace/*/memory/*",
  "tenants/*/agents/*/workspace/review/*",
  "tenants/*/agents/*/workspace/*/review/*",
  "tenants/*/agents/*/workspace/errors/*",
  "tenants/*/agents/*/workspace/*/errors/*",
  "tenants/*/agents/*/workspace/events/intents/*.json",
  "tenants/*/agents/*/workspace/*/events/intents/*.json",
  "tenants/*/agents/*/workspace/events/audit/*",
] as const;

export async function handler(event: SqsEvent): Promise<BatchResponse> {
  const failures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records ?? []) {
    try {
      await processRecord(record.body);
    } catch (err) {
      console.error("[workspace-event-dispatcher] record_failed", {
        messageId: record.messageId,
        error: err instanceof Error ? err.message : String(err),
      });
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
}

export async function processRecord(
  body: string,
): Promise<WorkspaceEventProcessResult | null> {
  const parsedBody = JSON.parse(body) as EventBridgeS3Event;
  const bucket = parsedBody.detail?.bucket?.name;
  const key = parsedBody.detail?.object?.key;
  const sequencer = parsedBody.detail?.object?.sequencer;
  if (!bucket || !key || !sequencer) {
    console.warn("[workspace-event-dispatcher] ignored_malformed_event");
    return null;
  }

  const decodedKey = decodeURIComponent(key.replace(/\+/g, " "));
  const parsedKey = parseWorkspaceEventKey(decodedKey);
  if (!parsedKey) {
    console.warn("[workspace-event-dispatcher] ignored_non_eventful_key", {
      key: decodedKey,
    });
    return null;
  }

  let objectEtag = parsedBody.detail?.object?.etag;
  let objectVersionId = parsedBody.detail?.object?.["version-id"];
  if (parsedBody["detail-type"] !== "Object Deleted") {
    const head = await s3.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: decodedKey,
      }),
    );
    objectEtag = head.ETag ?? objectEtag;
    objectVersionId = head.VersionId ?? objectVersionId;
    const suppress = head.Metadata?.["thinkwork-suppress-event"];
    if (suppress === "true") {
      console.log("[workspace-event-dispatcher] suppressed_event", {
        key: decodedKey,
      });
      return null;
    }
  }

  if (parsedBody["detail-type"] === "Object Deleted") {
    const draft: CanonicalWorkspaceEventDraft = {
      eventType: "event.rejected",
      idempotencyKey: workspaceEventIdempotencyKey(decodedKey, sequencer),
      reason:
        parsedKey.eventfulKind === "review"
          ? "review_deleted_directly"
          : "source_object_deleted",
      payload: {
        targetPath: parsedKey.targetPath,
        workspaceRelativePath: parsedKey.workspaceRelativePath,
        fileName: parsedKey.fileName,
      },
    };
    console.log("[workspace-event-dispatcher] canonical_delete_candidate", {
      key: decodedKey,
      reason: draft.reason,
    });
    return persistWorkspaceEvent(
      parsedKey,
      draft,
      {
        bucket,
        sourceObjectKey: decodedKey,
        sequencer,
        detailType: parsedBody["detail-type"] ?? "Object Deleted",
        objectEtag,
        objectVersionId,
      },
      { s3 },
    );
  }

  const draft = canonicalizeWorkspaceEvent(parsedKey, decodedKey, sequencer);
  console.log("[workspace-event-dispatcher] canonical_event_candidate", {
    eventType: draft.eventType,
    key: decodedKey,
    targetPath: parsedKey.targetPath,
  });
  return persistWorkspaceEvent(
    parsedKey,
    draft,
    {
      bucket,
      sourceObjectKey: decodedKey,
      sequencer,
      detailType: parsedBody["detail-type"] ?? "Object Created",
      objectEtag,
      objectVersionId,
    },
    { s3 },
  );
}
