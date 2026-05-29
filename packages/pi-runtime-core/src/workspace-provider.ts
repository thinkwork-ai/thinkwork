/**
 * WorkspaceProvider — the host-supplied seam for reading and materializing the
 * agent's rendered workspace (the per-tenant/agent file tree the runtime reads
 * at turn start).
 *
 * Inert in this unit: the core defines the contract; no host implements it yet
 * (cloud bootstrap wiring lands in U7). The contract is small on purpose —
 * `read` / `list` / `sync` — so a host can back it with S3, the local
 * filesystem (desktop), or an in-memory stub (eval/tests) without the core
 * knowing which.
 *
 * Credential discipline: any implementation that reaches AWS/S3 must use
 * credentials/identity snapshotted at loop entry, never re-read from
 * `process.env` mid-turn (see feedback_completion_callback_snapshot_pattern).
 *
 * Path convention: all paths are workspace-relative (e.g. `AGENTS.md`,
 * `skills/foo/CONTEXT.md`) — never absolute and never including the
 * tenant/agent S3 prefix, which the implementation owns and enforces.
 */

/** Outcome of materializing the workspace into the runtime's working tree. */
export interface WorkspaceSyncResult {
  /** Number of files materialized. */
  fileCount: number;
  /** The workspace-relative prefix that was synced (empty string for the root). */
  prefix: string;
}

export interface WorkspaceProvider {
  /**
   * Read a single workspace file's contents, or `null` when it does not exist.
   * The path is workspace-relative.
   */
  read(path: string): Promise<string | null>;

  /**
   * List workspace-relative file paths, optionally restricted to those under a
   * prefix. An absent or empty prefix lists the whole workspace.
   */
  list(prefix?: string): Promise<string[]>;

  /**
   * Materialize the workspace (or the subtree under `prefix`) into the runtime's
   * working tree so tools can read it from disk. Returns a summary of what was
   * synced.
   */
  sync(prefix?: string): Promise<WorkspaceSyncResult>;
}
