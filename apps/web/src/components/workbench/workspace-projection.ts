/**
 * Read-side parser for the per-turn workspace projection snapshot stored at
 * `ThreadTurn.contextSnapshot.workspace_projection` (plan 2026-06-12-002).
 *
 * The snapshot is written server-side by
 * `packages/api/src/lib/workspace-projection-snapshot.ts`: dispatch writes the
 * render fields, the fetch tool appends `fetches`, finalize merges
 * `reconcile`. Crashed turns keep a partial snapshot and pre-feature turns
 * have no `workspace_projection` key at all, so every field here is optional
 * and the parser never throws — `null` means "no panel".
 */

export interface ProjectedWorkspaceSource {
  owner: string | null;
  prefix: string | null;
  etagSummary: string | null;
}

export interface ProjectedWorkspaceFetch {
  /** Fetch target, e.g. kind "space" / "user" + slug. */
  kind: string | null;
  slug: string | null;
  /** "success" | "partial" | "denied" | "error" (open vocabulary read-side). */
  outcome: string | null;
  fileCount: number | null;
  totalBytes: number | null;
  /** Present when outcome is "denied", e.g. "not_authorized" | "revoked". */
  deniedReason: string | null;
  /** ISO-8601 timestamp of the fetch attempt. */
  at: string | null;
}

export interface ProjectedWorkspaceReconcileRejection {
  path: string;
  code: string;
}

export interface ProjectedWorkspaceReconcile {
  rejectedCount: number;
  /** Capped server-side (first 20); `rejectedCount` is the true total. */
  rejections: ProjectedWorkspaceReconcileRejection[];
  updatedAt: string | null;
}

export interface ProjectedWorkspace {
  renderedPrefix: string | null;
  sources: ProjectedWorkspaceSource[];
  /** S3 key of the rendered AGENTS.md for this exact render. */
  agentsMdKey: string | null;
  /** S3 ETag of the rendered AGENTS.md for this exact render (optional). */
  agentsMdEtag: string | null;
  /**
   * Write-once, content-addressed S3 key holding this exact turn's rendered
   * AGENTS.md (`${renderedPrefix}.agents-md-history/<sha>.md`). Immune to
   * later re-renders, so the panel can show the EXACT historical content for
   * an older turn. Null on pre-fix turns (or manifests with no generated
   * AGENTS.md entry), in which case the panel falls back to the current render.
   */
  agentsMdHistoryKey: string | null;
  /** Prompt files actually injected into the system prompt. */
  injectedFiles: string[];
  generatedAt: string | null;
  fetches: ProjectedWorkspaceFetch[];
  reconcile: ProjectedWorkspaceReconcile | null;
}

/**
 * The thread-target workspace-files reader maps a path RELATIVE to the
 * thread's rendered prefix, but `agentsMdHistoryKey` is a FULL S3 key
 * (`${renderedPrefix}.agents-md-history/<sha>.md`). Strip the snapshot's
 * `renderedPrefix` to get the path the reader expects
 * (`.agents-md-history/<sha>.md`). Returns null when the projection lacks a
 * history key, so the panel can fall back to the current AGENTS.md. If the key
 * doesn't begin with the prefix (defensive — shouldn't happen), returns the
 * full key unchanged; a bad read then 404s and the panel falls back.
 */
export function agentsMdHistoryRelativePath(
  projection: ProjectedWorkspace,
): string | null {
  const key = projection.agentsMdHistoryKey;
  if (!key) return null;
  const prefix = projection.renderedPrefix;
  if (prefix && key.startsWith(prefix)) {
    return key.slice(prefix.length);
  }
  return key;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseSource(value: unknown): ProjectedWorkspaceSource | null {
  const record = asRecord(value);
  if (!record) return null;
  const source: ProjectedWorkspaceSource = {
    owner: asString(record.owner),
    prefix: asString(record.prefix),
    etagSummary: asString(record.etagSummary),
  };
  return source.owner || source.prefix ? source : null;
}

function parseFetch(value: unknown): ProjectedWorkspaceFetch | null {
  const record = asRecord(value);
  if (!record) return null;
  const target = asRecord(record.target);
  return {
    kind: asString(target?.kind),
    slug: asString(target?.slug),
    outcome: asString(record.outcome),
    fileCount: asNumber(record.fileCount),
    totalBytes: asNumber(record.totalBytes),
    deniedReason: asString(record.deniedReason),
    at: asString(record.at),
  };
}

function parseReconcile(value: unknown): ProjectedWorkspaceReconcile | null {
  const record = asRecord(value);
  if (!record) return null;
  const rejections = Array.isArray(record.rejections)
    ? record.rejections.flatMap((entry) => {
        const rejection = asRecord(entry);
        if (!rejection) return [];
        const path = asString(rejection.path);
        if (!path) return [];
        return [{ path, code: asString(rejection.code) ?? "unknown" }];
      })
    : [];
  return {
    rejectedCount: asNumber(record.rejectedCount) ?? rejections.length,
    rejections,
    updatedAt: asString(record.updatedAt),
  };
}

/**
 * Parse `contextSnapshot` (object or AWSJSON string) into a tolerant
 * projection view-model. Returns `null` when there is no
 * `workspace_projection` key — pre-feature turns render no panel.
 */
export function parseWorkspaceProjection(
  contextSnapshot: unknown,
): ProjectedWorkspace | null {
  let snapshot = contextSnapshot;
  if (typeof snapshot === "string") {
    try {
      snapshot = JSON.parse(snapshot);
    } catch {
      return null;
    }
  }
  const raw = asRecord(asRecord(snapshot)?.workspace_projection);
  if (!raw) return null;

  return {
    renderedPrefix: asString(raw.renderedPrefix),
    sources: Array.isArray(raw.sources)
      ? raw.sources.flatMap((entry) => {
          const source = parseSource(entry);
          return source ? [source] : [];
        })
      : [],
    agentsMdKey: asString(raw.agentsMdKey),
    agentsMdEtag: asString(raw.agentsMdEtag),
    agentsMdHistoryKey: asString(raw.agentsMdHistoryKey),
    injectedFiles: Array.isArray(raw.injectedFiles)
      ? raw.injectedFiles.flatMap((entry) => {
          const file = asString(entry);
          return file ? [file] : [];
        })
      : [],
    generatedAt: asString(raw.generatedAt),
    fetches: Array.isArray(raw.fetches)
      ? raw.fetches.flatMap((entry) => {
          const fetchEvent = parseFetch(entry);
          return fetchEvent ? [fetchEvent] : [];
        })
      : [],
    reconcile: parseReconcile(raw.reconcile),
  };
}

export interface ProjectionTurnLike {
  id: string;
  contextSnapshot?: unknown;
}

export interface LatestProjectionRef {
  turnId: string;
  generatedAt: string | null;
  agentsMdKey: string | null;
  agentsMdEtag: string | null;
}

/**
 * The most recent projection across a thread's turns, by `generatedAt`
 * (missing/unparseable timestamps lose; on a full tie the earlier array entry
 * wins — the turns query returns newest-first). Used to decide whether an
 * older turn's AGENTS.md viewer shows "current content may differ": the
 * web can only read the CURRENT rendered AGENTS.md, which matches the
 * snapshot only for the latest render.
 */
export function selectLatestProjection(
  turns: ProjectionTurnLike[],
): LatestProjectionRef | null {
  let best: { ref: LatestProjectionRef; time: number } | null = null;
  for (const turn of turns) {
    const projection = parseWorkspaceProjection(turn.contextSnapshot);
    if (!projection) continue;
    const parsed = projection.generatedAt
      ? Date.parse(projection.generatedAt)
      : Number.NaN;
    const time = Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
    if (!best || time > best.time) {
      best = {
        ref: {
          turnId: turn.id,
          generatedAt: projection.generatedAt,
          agentsMdKey: projection.agentsMdKey,
          agentsMdEtag: projection.agentsMdEtag,
        },
        time,
      };
    }
  }
  return best?.ref ?? null;
}

/**
 * Whether the CURRENT rendered AGENTS.md content may differ from what this
 * turn's render contained. When both this turn's snapshot and the latest
 * projection carry an `agentsMdEtag`, etag inequality is a fact — equal
 * etags mean the bytes are identical even across re-renders. Without etags
 * on both sides, fall back to the heuristic: a later turn re-rendered the
 * workspace (different latest turn) or the latest render writes to a
 * different key.
 */
export function agentsMdContentMayDiffer(
  turnId: string,
  projection: ProjectedWorkspace,
  latest: LatestProjectionRef | null,
): boolean {
  if (!latest) return false;
  if (projection.agentsMdEtag && latest.agentsMdEtag) {
    return projection.agentsMdEtag !== latest.agentsMdEtag;
  }
  return (
    latest.turnId !== turnId || latest.agentsMdKey !== projection.agentsMdKey
  );
}
