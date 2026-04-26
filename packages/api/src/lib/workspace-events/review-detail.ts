import { GetObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import {
  agentWorkspaceEvents,
  agentWorkspaceRuns,
  and,
  db as defaultDb,
  desc,
  eq,
  snakeToCamel,
  threadTurns,
} from "../../graphql/utils.js";

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";

export interface WorkspaceReviewProposedChange {
  path?: string | null;
  kind: string;
  summary: string;
  diff?: string | null;
  before?: string | null;
  after?: string | null;
}

interface WorkspaceRunRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  target_path: string;
  status: string;
  source_object_key: string | null;
  request_object_key: string | null;
  current_wakeup_request_id: string | null;
  current_thread_turn_id: string | null;
  parent_run_id: string | null;
  depth: number;
  inbox_write_count: number;
  wakeup_retry_count: number;
  last_event_at: Date;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface WorkspaceEventRow {
  id: number;
  tenant_id: string;
  agent_id: string | null;
  run_id: string | null;
  event_type: string;
  bucket: string;
  source_object_key: string;
  audit_object_key: string | null;
  object_etag: string | null;
  object_version_id: string | null;
  sequencer: string;
  mirror_status: string;
  reason: string | null;
  payload: unknown;
  actor_type: string | null;
  actor_id: string | null;
  parent_event_id: number | null;
  created_at: Date;
}

export interface WorkspaceReviewObjectRead {
  body: string | null;
  etag: string | null;
  missing: boolean;
}

export interface WorkspaceReviewDetailStore {
  findRunById(runId: string): Promise<WorkspaceRunRow | null>;
  findThreadIdForTurn?(
    tenantId: string,
    threadTurnId: string,
  ): Promise<string | null>;
  listEvents(
    runId: string,
    tenantId: string,
    limit: number,
  ): Promise<WorkspaceEventRow[]>;
  readReviewObject(
    event: WorkspaceEventRow,
  ): Promise<WorkspaceReviewObjectRead>;
}

export interface WorkspaceReviewDetailResult {
  run: Record<string, unknown>;
  latestEvent: Record<string, unknown> | null;
  threadId: string | null;
  reviewObjectKey: string | null;
  targetPath: string;
  requestedAt: string;
  reason: string | null;
  payload: string | null;
  reviewBody: string | null;
  reviewEtag: string | null;
  reviewMissing: boolean;
  proposedChanges: WorkspaceReviewProposedChange[];
  events: Record<string, unknown>[];
  decisionEvents: Record<string, unknown>[];
}

export async function loadWorkspaceReviewDetail(
  runId: string,
  deps: {
    store?: WorkspaceReviewDetailStore;
    authorizeRun?: (run: WorkspaceRunRow) => Promise<void>;
  } = {},
): Promise<{
  run: WorkspaceRunRow;
  detail: WorkspaceReviewDetailResult;
} | null> {
  const store = deps.store ?? createDrizzleWorkspaceReviewDetailStore();
  const run = await store.findRunById(runId);
  if (!run) return null;
  await deps.authorizeRun?.(run);

  const events = await store.listEvents(run.id, run.tenant_id, 100);
  const latestReviewEvent =
    events.find((event) => event.event_type === "review.requested") ?? null;
  const reviewObject = latestReviewEvent
    ? await store.readReviewObject(latestReviewEvent)
    : { body: null, etag: null, missing: true };
  const payload = objectPayload(latestReviewEvent?.payload);
  const threadId =
    run.current_thread_turn_id && store.findThreadIdForTurn
      ? await store.findThreadIdForTurn(run.tenant_id, run.current_thread_turn_id)
      : null;

  return {
    run,
    detail: {
      run: snakeToCamel(run as unknown as Record<string, unknown>),
      latestEvent: latestReviewEvent
        ? snakeToCamel(latestReviewEvent as unknown as Record<string, unknown>)
        : null,
      threadId,
      reviewObjectKey: latestReviewEvent?.source_object_key ?? null,
      targetPath: run.target_path,
      requestedAt: (
        latestReviewEvent?.created_at ?? run.last_event_at
      ).toISOString(),
      reason: latestReviewEvent?.reason ?? null,
      payload: payload ? JSON.stringify(payload) : null,
      reviewBody: reviewObject.body,
      reviewEtag: reviewObject.etag,
      reviewMissing: reviewObject.missing,
      proposedChanges: parseWorkspaceReviewProposedChanges(
        reviewObject.body,
        payload,
      ),
      events: events.map((event) =>
        snakeToCamel(event as unknown as Record<string, unknown>),
      ),
      decisionEvents: events
        .filter(
          (event) =>
            event.event_type === "review.responded" ||
            (event.event_type === "run.failed" &&
              event.reason === "review_cancelled"),
        )
        .map((event) =>
          snakeToCamel(event as unknown as Record<string, unknown>),
        ),
    },
  };
}

export function parseWorkspaceReviewProposedChanges(
  body: string | null,
  payload: Record<string, unknown> | null,
): WorkspaceReviewProposedChange[] {
  const payloadChanges = changesFromPayload(payload);
  if (payloadChanges.length > 0) return payloadChanges;

  const diffBlocks = [...(body ?? "").matchAll(/```diff\n([\s\S]*?)```/g)];
  if (diffBlocks.length > 0) {
    return diffBlocks.map((match, index) => ({
      kind: "diff",
      summary:
        diffBlocks.length === 1
          ? "Review includes proposed diff"
          : `Review includes proposed diff ${index + 1}`,
      diff: match[1]?.trim() ?? "",
    }));
  }

  return [];
}

export function createDrizzleWorkspaceReviewDetailStore(
  database = defaultDb,
  s3 = new S3Client({ region: REGION }),
): WorkspaceReviewDetailStore {
  return {
    async findRunById(runId) {
      const [run] = await database
        .select()
        .from(agentWorkspaceRuns)
        .where(eq(agentWorkspaceRuns.id, runId))
        .limit(1);
      return (run as WorkspaceRunRow | undefined) ?? null;
    },
    async findThreadIdForTurn(tenantId, threadTurnId) {
      const [turn] = await database
        .select({ threadId: threadTurns.thread_id })
        .from(threadTurns)
        .where(
          and(
            eq(threadTurns.tenant_id, tenantId),
            eq(threadTurns.id, threadTurnId),
          ),
        )
        .limit(1);
      return turn?.threadId ?? null;
    },
    async listEvents(runId, tenantId, limit) {
      return (await database
        .select()
        .from(agentWorkspaceEvents)
        .where(
          and(
            eq(agentWorkspaceEvents.tenant_id, tenantId),
            eq(agentWorkspaceEvents.run_id, runId),
          ),
        )
        .orderBy(desc(agentWorkspaceEvents.created_at))
        .limit(limit)) as WorkspaceEventRow[];
    },
    async readReviewObject(event) {
      try {
        const response = await s3.send(
          new GetObjectCommand({
            Bucket: event.bucket,
            Key: event.source_object_key,
          }),
        );
        return {
          body: (await response.Body?.transformToString("utf-8")) ?? "",
          etag: response.ETag ?? event.object_etag,
          missing: false,
        };
      } catch (err) {
        if (isNoSuchKey(err)) {
          return { body: null, etag: null, missing: true };
        }
        throw err;
      }
    },
  };
}

function changesFromPayload(
  payload: Record<string, unknown> | null,
): WorkspaceReviewProposedChange[] {
  const rawChanges = firstArray(payload?.proposedChanges, payload?.changes);
  if (!rawChanges) return [];

  return rawChanges
    .map((raw) => normalizePayloadChange(raw))
    .filter((change): change is WorkspaceReviewProposedChange => !!change);
}

function firstArray(...values: unknown[]): unknown[] | null {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return null;
}

function normalizePayloadChange(
  raw: unknown,
): WorkspaceReviewProposedChange | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const path = stringValue(record.path ?? record.file ?? record.objectKey);
  const kind =
    stringValue(record.kind ?? record.type ?? record.action) ?? "change";
  const summary =
    stringValue(record.summary ?? record.title ?? record.description) ??
    path ??
    kind;
  return {
    path,
    kind,
    summary,
    diff: stringValue(record.diff),
    before: stringValue(record.before),
    after: stringValue(record.after),
  };
}

function objectPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isNoSuchKey(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return (
    err instanceof NoSuchKey || name === "NoSuchKey" || name === "NotFound"
  );
}
