/**
 * Header-label helpers for thread rows.
 *
 * External-task threads previously rendered a provider-specific label in the
 * nav header (read from `metadata.external.latestEnvelope`). That ingestion
 * surface has been retired, so `getExternalProviderLabel` now always returns
 * null — preserved as a stub so callers don't have to change shape — and
 * `getThreadHeaderLabel` falls through to the thread's own title.
 */

interface ThreadLike {
  title?: string | null;
  metadata?: unknown;
}

export function getExternalProviderLabel(_thread: ThreadLike | null | undefined): string | null {
  return null;
}

/**
 * The label to show in the nav header for a thread — the external provider
 * label when applicable, falling back to the thread's own title.
 */
export function getThreadHeaderLabel(thread: ThreadLike | null | undefined): string {
  return getExternalProviderLabel(thread) ?? thread?.title ?? "";
}
