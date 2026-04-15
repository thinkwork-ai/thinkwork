/**
 * Header-label helpers for thread/task rows.
 *
 * External-task threads (LastMile etc.) show the provider label in the nav
 * header (e.g. "LastMile Task") instead of the actual task title — the title
 * lives in the pinned task card inside the page. Regular threads keep their
 * own title.
 *
 * Used by list-row press handlers to pre-fill the `title` route param so the
 * detail page's header has no load-shift, and by the detail page itself to
 * compute the same label once the thread query resolves.
 */

interface ThreadLike {
  title?: string | null;
  metadata?: unknown;
}

export function getExternalProviderLabel(thread: ThreadLike | null | undefined): string | null {
  if (!thread) return null;
  const meta = (thread.metadata ?? {}) as Record<string, unknown>;
  const external = meta.external as
    | { latestEnvelope?: { item?: { core?: { provider?: string } } } }
    | undefined;
  const envelope = external?.latestEnvelope;
  if (!envelope) return null;
  const provider = envelope.item?.core?.provider;
  if (provider === "lastmile") return "LastMile Task";
  if (typeof provider === "string" && provider.length > 0) {
    return `${provider.charAt(0).toUpperCase()}${provider.slice(1)} Task`;
  }
  return "External Task";
}

/**
 * The label to show in the nav header for a thread — the external provider
 * label when applicable, falling back to the thread's own title.
 */
export function getThreadHeaderLabel(thread: ThreadLike | null | undefined): string {
  return getExternalProviderLabel(thread) ?? thread?.title ?? "";
}
