/**
 * CanvasProvider — the host-supplied seam for Living Artifacts agent parity
 * (THINK-145 U9 / KTD8).
 *
 * Mirrors the {@link KnowledgeGraphProvider} seam shape: a narrow
 * request/response contract; the host supplies transport + identity. The
 * `artifacts` extension (`save_canvas` / `load_canvas` / `refresh_canvas_data`
 * / `list_canvases`) reaches the platform ONLY through this interface — it
 * never builds a GraphQL/HTTP client of its own — so the extension is identical
 * on the cloud and desktop hosts.
 *
 * Identity discipline (KTD8): tenant/user/thread identity is NOT part of this
 * contract. The host closes over the acting user's id + thread id when it
 * constructs the provider (snapshot-at-entry, never re-read from env mid-turn),
 * and the platform mutations assert R15 space-membership against THAT user —
 * never against the service principal alone. A prompt-injected turn therefore
 * cannot flip user/thread/space by tool parameter.
 *
 * The `createLambdaCallbackFetch`/service-secret transport carries no verified
 * user principal, so the concrete provider asserts the acting user via the
 * `x-principal-id` header (the trusted-infra impersonation path). The server
 * resolves that header to a user and runs the same membership gate the web
 * `saveCanvas`/`checkoutCanvas`/`refreshCanvasData` mutations run — there is no
 * second write path.
 */

/** One saved (or, for the current thread, draft) canvas summary. */
export interface CanvasSummaryItem {
  /** The artifact id (stable across versions). */
  artifactId: string;
  /** Display title. Empty string when the canvas has no title yet. */
  title: string;
  /** ISO timestamp of the last head update, when known. */
  updatedAt: string | null;
  /** Version-chain head pointer (0 until the canvas has been pinned/checked in). */
  headVersion: number;
  /** Artifact status — "draft" | "final" | "superseded". */
  status: string;
}

/** A space the acting user may save a canvas into (member-or-above). */
export interface CanvasWritableSpace {
  spaceId: string;
  name: string;
}

/** The canvas context for the current thread, resolved server-side. */
export interface CanvasThreadContext {
  /** The thread's home space id, when the thread belongs to a space. */
  spaceId: string | null;
  /** The thread's home space name, when resolvable. */
  spaceName: string | null;
  /**
   * The most-recent canvas part materialized in THIS thread (draft or
   * checked-out head) — the target of `save_canvas` when no explicit
   * artifact/part is named. Null when the thread has emitted no canvas.
   */
  currentCanvas: CanvasSummaryItem | null;
  /**
   * SAVED (non-draft) canvases in the thread's space, most-recent first.
   * Drafts are excluded (R19). This is the resolution set for `load_canvas`
   * and `refresh_canvas_data`, and the truth behind `list_canvases`.
   */
  savedCanvases: CanvasSummaryItem[];
  /**
   * Spaces the acting user may save into (member-or-above). Lets the extension
   * resolve an explicit `spaceName` argument to a `spaceId` without a second
   * round-trip; when empty or unmatched, save defaults to the thread's space.
   */
  writableSpaces: CanvasWritableSpace[];
}

/** Arguments for a canvas save (status flip + naming + space assignment). */
export interface CanvasSaveRequest {
  artifactId: string;
  title: string;
  spaceId: string;
}

export interface CanvasSaveResult {
  artifactId: string;
  title: string;
  spaceId: string | null;
  headVersion: number;
}

export interface CanvasCheckoutResult {
  artifactId: string;
  title: string;
}

/** Per-binding outcome of a headless data-refresh (mirrors R8 quality states). */
export interface CanvasRefreshBindingOutcome {
  bindingId: string;
  partId: string;
  elementId: string;
  /** Refresh outcome (e.g. REFRESHED, UNCHANGED, SKIPPED, FAILED). */
  outcome: string;
  /** Resulting freshness quality (e.g. GOOD, STALE, BAD). */
  quality: string;
  /** Human-readable reason for a non-GOOD outcome (e.g. "refresh needs you"). */
  reason: string | null;
}

export interface CanvasRefreshResult {
  artifactId: string;
  /** False when the refresh Lambda rejected or errored before running. */
  dispatched: boolean;
  errorMessage: string | null;
  bindings: CanvasRefreshBindingOutcome[];
}

export interface CanvasProvider {
  /**
   * Resolve the current thread's canvas context: its home space, the current
   * (most-recent) canvas part for saving, and the saved canvases in the space
   * for name resolution + listing. Identity (acting user + thread) is closed
   * over by the host; the server derives and gates on it.
   */
  context(signal?: AbortSignal): Promise<CanvasThreadContext>;

  /**
   * Save a draft canvas (status flip + naming + space assignment) or re-save a
   * saved canvas (auto-pins the prior head as a version). Wraps the web
   * `saveCanvas` mutation — same write path, same R15 membership gate.
   */
  save(
    request: CanvasSaveRequest,
    signal?: AbortSignal,
  ): Promise<CanvasSaveResult>;

  /**
   * Check a saved canvas out into the current thread under its original stable
   * part id (the agent-side twin of R13). Wraps `checkoutCanvas`; the thread id
   * is closed over by the host. Cross-space check-out is rejected server-side.
   */
  checkout(
    artifactId: string,
    signal?: AbortSignal,
  ): Promise<CanvasCheckoutResult>;

  /**
   * Trigger the headless data-refresh for a checked-out canvas (R18). Wraps
   * `refreshCanvasData`; the R9 per-user-OAuth exclusion is enforced inside the
   * refresh Lambda and surfaced through the per-binding outcomes.
   */
  refresh(
    artifactId: string,
    partId?: string | null,
    signal?: AbortSignal,
  ): Promise<CanvasRefreshResult>;
}
