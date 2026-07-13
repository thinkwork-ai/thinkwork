/**
 * U4 client-side cutover gate for the federated search palette (THINK-263).
 *
 * When `false`, Cmd+K renders exactly the legacy thread-only search dialog for
 * every query. When `true`, an empty query still shows today's pinned + recent
 * view, but a typed query fans out to the broker's Threads / Wiki / Entities
 * rails and exposes the "Ask …" escalation row.
 *
 * One-line revert: set this to `false` to restore the pre-U4 thread-only palette
 * with zero other changes (don't-cutover-before-proven).
 */
export const SEARCH_PALETTE_RAILS_ENABLED = true;
