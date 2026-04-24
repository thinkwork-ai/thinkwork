/**
 * Three-phase saga for installing a validated plugin bundle.
 *
 * Plan reference: `docs/plans/2026-04-23-007-feat-v1-agent-architecture-
 * final-call-plan.md` §U10.
 *
 * ## Why a saga?
 *
 * The install touches three stores — Aurora, S3, and back to Aurora — that
 * can't participate in a single transaction. A naive "insert, copy, insert"
 * ordering has four distinct partial-failure modes, every one of which
 * leaves the tenant's view of the world in a different inconsistent state.
 * The saga replaces that with a single state machine + durable audit trail:
 *
 *   Phase 1 (DB txn) — insert plugin_uploads status='staging'. This row
 *     is the audit record; it survives any later failure. COMMIT.
 *   Phase 2 (S3)     — copy the bundle from its staging prefix to the
 *     canonical tenant prefix. Content-addressed writes + an atomic-
 *     rename-style marker let us retry idempotently.
 *   Phase 3 (DB txn) — insert tenant_skills and tenant_mcp_servers
 *     (status='pending' for MCP), then UPDATE plugin_uploads
 *     status='installed'. COMMIT.
 *
 * Any phase failure: UPDATE plugin_uploads status='failed' with the
 * error_message, return the audit row's id to the handler so the admin
 * UI can render a specific reason. S3 orphans left by a failed phase 2
 * or 3 are reaped by a separate hourly sweeper (lands in its own PR).
 *
 * ## Dependency injection
 *
 * The saga function takes every external edge as a callable, not an
 * import. This keeps it pure enough to test without spinning up
 * DynamoDB-Local or localstack — the handler wires in the real AWS SDK
 * + Drizzle, tests wire in fakes. The surface is small: a DB runner,
 * an S3 copy, and an optional logger.
 *
 * ## Idempotency
 *
 * Re-uploading the same bundle (same sha256) is allowed and should
 * resolve to the existing `plugin_uploads` row rather than creating a
 * duplicate. U10's handler detects this by looking up prior rows for
 * the same (tenant_id, bundle_sha256) before kicking the saga; the
 * saga itself is a one-shot state machine.
 */

import { createHash } from "node:crypto";

import type { ValidatedPlugin } from "./plugin-validator.js";

export type PluginInstallStatus = "staging" | "installed" | "failed";

export interface PluginUploadRecord {
  id: string;
  tenantId: string;
  uploadedBy: string | null;
  uploadedAt: Date;
  bundleSha256: string;
  pluginName: string;
  pluginVersion: string | null;
  status: PluginInstallStatus;
  s3StagingPrefix: string | null;
  errorMessage: string | null;
}

/**
 * Minimal DB surface the saga needs. The handler wires these to Drizzle
 * calls against `plugin_uploads`, `tenant_skills`, `tenant_mcp_servers`.
 * Tests wire in-memory maps.
 *
 * All three DB methods treat failures as saga-fatal — the caller
 * catches, marks the row failed, and bubbles a structured error back
 * to the admin UI.
 */
export interface PluginInstallerDb {
  /** Phase 1. Returns the created row's id. */
  insertPluginUploadStaging(input: {
    tenantId: string;
    uploadedBy: string | null;
    bundleSha256: string;
    pluginName: string;
    pluginVersion: string | null;
    s3StagingPrefix: string;
  }): Promise<{ uploadId: string }>;

  /**
   * Phase 3. Single atomic step: insert every tenant_skills row and
   * tenant_mcp_servers row (with status='pending'), then update the
   * plugin_uploads row to status='installed'. The handler runs this
   * inside a Drizzle transaction; the in-memory test fake can treat
   * it as a single call.
   */
  completeInstall(input: {
    uploadId: string;
    tenantId: string;
    skills: Array<{ slug: string; version: string | null }>;
    mcpServers: Array<{
      name: string;
      url: string;
      auth: Record<string, unknown> | null;
      description: string | null;
    }>;
  }): Promise<void>;

  /**
   * Mark a staging or installed row as failed with an operator-
   * readable error message. Used on any phase-2 or phase-3 failure;
   * callers then return the error to the client.
   */
  markFailed(input: { uploadId: string; errorMessage: string }): Promise<void>;
}

/** S3 surface the saga needs. */
export interface PluginInstallerS3 {
  /**
   * Phase 2. Write every bundle file to its canonical location under
   * `canonicalPrefix`. The handler pre-extracts files during validation
   * so the saga doesn't re-parse the zip; it hands this a list of
   * `{relPath, body}` pairs and the impl PutObject's them in sequence.
   * The caller's implementation decides whether to parallelise.
   */
  writeBundle(input: {
    canonicalPrefix: string;
    files: Array<{ relPath: string; body: string }>;
  }): Promise<void>;
}

export interface PluginInstallerLogger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
}

export interface RunInstallInput {
  tenantId: string;
  uploadedBy: string | null;
  /** S3 key of the uploaded zip itself — stored on the audit row. */
  stagingPrefix: string;
  bundleSha256: string;
  plugin: ValidatedPlugin;
  /** Files to land at `canonicalPrefix`. Pre-extracted by the handler. */
  bundleFiles: Array<{ relPath: string; body: string }>;
  /** Canonical prefix formatter — handler knows the bucket convention. */
  canonicalPrefix: (tenantId: string, pluginName: string) => string;
}

export type RunInstallResult =
  | {
      status: "installed";
      uploadId: string;
      pluginName: string;
      skills: Array<{ slug: string }>;
      mcpServers: Array<{ name: string; url: string }>;
    }
  | {
      status: "failed";
      uploadId: string;
      errorMessage: string;
      phase: "phase-1" | "phase-2" | "phase-3";
    };

/**
 * Run the three-phase install saga. Always resolves — failures land
 * structured on the returned object, never thrown back to the handler.
 */
export async function runPluginInstallSaga(
  input: RunInstallInput,
  deps: {
    db: PluginInstallerDb;
    s3: PluginInstallerS3;
    logger?: PluginInstallerLogger;
  },
): Promise<RunInstallResult> {
  const { db, s3 } = deps;
  const log = deps.logger ?? {
    info: () => undefined,
    warn: () => undefined,
  };

  // ------------------------------------------------------------------
  // Phase 1 — durable audit row. No S3 side effect yet.
  // ------------------------------------------------------------------
  let uploadId: string;
  try {
    const row = await db.insertPluginUploadStaging({
      tenantId: input.tenantId,
      uploadedBy: input.uploadedBy,
      bundleSha256: input.bundleSha256,
      pluginName: input.plugin.name,
      pluginVersion: input.plugin.version ?? null,
      s3StagingPrefix: input.stagingPrefix,
    });
    uploadId = row.uploadId;
    log.info("plugin-saga phase-1 staged", {
      uploadId,
      tenantId: input.tenantId,
      pluginName: input.plugin.name,
    });
  } catch (e) {
    // Phase 1 failure means no audit row exists. The only durable
    // footprint is the S3 staging object the handler already PUT;
    // the sweeper reaps orphan staging > 1h.
    const msg = (e as Error).message || "phase-1 DB insert failed";
    log.warn("plugin-saga phase-1 failed", { error: msg });
    return {
      status: "failed",
      uploadId: "",
      errorMessage: msg,
      phase: "phase-1",
    };
  }

  // ------------------------------------------------------------------
  // Phase 2 — S3 copy from staging to canonical prefix.
  // ------------------------------------------------------------------
  const canonical = input.canonicalPrefix(input.tenantId, input.plugin.name);
  try {
    await s3.writeBundle({
      canonicalPrefix: canonical,
      files: input.bundleFiles,
    });
    log.info("plugin-saga phase-2 wrote bundle", {
      uploadId,
      canonicalPrefix: canonical,
      fileCount: input.bundleFiles.length,
    });
  } catch (e) {
    const msg = (e as Error).message || "phase-2 S3 write failed";
    log.warn("plugin-saga phase-2 failed", { uploadId, error: msg });
    await safeMarkFailed(db, uploadId, msg, log);
    return { status: "failed", uploadId, errorMessage: msg, phase: "phase-2" };
  }

  // ------------------------------------------------------------------
  // Phase 3 — insert tenant_skills + tenant_mcp_servers + mark installed.
  // ------------------------------------------------------------------
  try {
    await db.completeInstall({
      uploadId,
      tenantId: input.tenantId,
      skills: input.plugin.skills.map((s) => ({
        slug: s.name,
        version: input.plugin.version ?? null,
      })),
      mcpServers: input.plugin.mcpServers.map((m) => ({
        name: m.name,
        url: m.url,
        auth: m.auth ?? null,
        description: m.description ?? null,
      })),
    });
    log.info("plugin-saga phase-3 installed", {
      uploadId,
      skills: input.plugin.skills.length,
      mcpServers: input.plugin.mcpServers.length,
    });
  } catch (e) {
    const msg = (e as Error).message || "phase-3 DB insert failed";
    log.warn("plugin-saga phase-3 failed", { uploadId, error: msg });
    await safeMarkFailed(db, uploadId, msg, log);
    return { status: "failed", uploadId, errorMessage: msg, phase: "phase-3" };
  }

  return {
    status: "installed",
    uploadId,
    pluginName: input.plugin.name,
    skills: input.plugin.skills.map((s) => ({ slug: s.name })),
    mcpServers: input.plugin.mcpServers.map((m) => ({
      name: m.name,
      url: m.url,
    })),
  };
}

/**
 * markFailed can itself fail (DB blip). A failed markFailed is logged
 * but doesn't bubble — the sweeper is the backstop that reconciles
 * staging rows stuck > 1h.
 */
async function safeMarkFailed(
  db: PluginInstallerDb,
  uploadId: string,
  errorMessage: string,
  log: PluginInstallerLogger,
): Promise<void> {
  try {
    await db.markFailed({ uploadId, errorMessage });
  } catch (e) {
    log.warn("plugin-saga markFailed itself failed", {
      uploadId,
      underlying_error: errorMessage,
      mark_error: (e as Error).message,
    });
  }
}

/**
 * Canonical sha256 hex digest for a buffer. Exported so the handler can
 * compute the same hash both when staging (for the plugin_uploads row)
 * and when deduping a re-upload.
 */
export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
