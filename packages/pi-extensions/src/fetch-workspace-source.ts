/**
 * fetch_workspace_source — mid-turn, read-only workspace navigation
 * (plan 2026-06-12-002 U5; R6, R7 mount-level, AE1).
 *
 * The agent's rendered workspace hydrates only the active Space + acting
 * user. The AGENTS.md "Workspace Routing" section lists other authorized
 * Spaces and participants; this tool lets the agent pull one of those source
 * folders into /workspace on demand:
 *
 *   1. POST the U4 authorization endpoint (`/api/workspaces/fetch-source`)
 *      with the platform bearer + tenant header — the API decides access and
 *      returns full S3 keys + etags + relative paths (no content streams
 *      through the endpoint).
 *   2. Download every key through the HOST-supplied `downloadObject` seam
 *      (the extension never constructs S3 clients itself — spike contract),
 *      with bounded concurrency (8 parallel downloads).
 *   3. Stage into a temp dir, then atomically rename under the matching
 *      workspace folder (`Spaces/<slug>/` for Spaces, `Users/<slug>/` for
 *      fetched participants — NEVER under the acting user's writable `User/`
 *      tree). A failure at file k discards the temp dir — nothing is ever
 *      half-mounted.
 *   4. chmod each file 0444 (directories stay writable so re-fetch cleanup
 *      works) and append the fetched contents to the turn's diff baseline via
 *      the host seam so the end-of-turn diff reports zero changes for
 *      fetched paths (no phantom creates).
 *
 * Stateless per the extension contract: all config arrives by closure, the
 * tool re-fetches cleanly (rm + rename) on repeat calls, and denials are
 * surfaced as descriptive tool errors the model should not retry.
 */

import { mkdir, rename, rm, writeFile, chmod } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  defineExtension,
  type ThinkworkExtension,
} from "./define-extension.js";

export const FETCH_WORKSPACE_SOURCE_TOOL_NAME = "fetch_workspace_source";

/** Temp staging dirs live under the workspace root with this prefix; they are
 *  removed on both success (renamed away) and failure (discarded). */
export const FETCH_STAGING_PREFIX = ".fetch-tmp-";

/** Bounded download parallelism for staging fetched files. */
export const FETCH_DOWNLOAD_CONCURRENCY = 8;

/** Top-level workspace roots that are hydrated writable (or reserved) — a
 *  fetch mount must never replace or nest inside any of these. Fetched
 *  participants mount at `Users/<slug>/` precisely so they can never collide
 *  with the acting user's writable `User/` lane. */
const PROTECTED_MOUNT_ROOTS = new Set([
  "Agent",
  "User",
  "Space",
  "Thread",
  "scratch",
]);

/**
 * Validates a computed mount target and returns its absolute path. Refuses
 * (with a descriptive error) any mount that escapes the workspace root,
 * resolves into the acting user's writable `User/` tree (or any other
 * hydrated/reserved writable root), is not exactly two segments under
 * `Spaces/` or `Users/`, or targets the hydrated active Space folder.
 * Exported for tests.
 */
export function resolveSafeMountDir(input: {
  workspaceDir: string;
  mountRel: string;
  activeSpaceFolder?: string;
}): string {
  const root = path.resolve(input.workspaceDir);
  const mountDir = path.resolve(root, input.mountRel);
  const rel = path.relative(root, mountDir);
  const segments = rel.split(path.sep);
  const refused = (reason: string): never => {
    throw new Error(
      `fetch_workspace_source refused mount path '${input.mountRel}': ${reason}`,
    );
  };
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    refused("the mount target escapes the workspace root.");
  }
  if (PROTECTED_MOUNT_ROOTS.has(segments[0]!)) {
    refused(
      `fetched sources must never mount into the writable '${segments[0]}/' tree.`,
    );
  }
  if (
    segments.length !== 2 ||
    (segments[0] !== "Spaces" && segments[0] !== "Users")
  ) {
    refused(
      "fetched sources mount only at Spaces/<slug>/ or Users/<slug>/.",
    );
  }
  if (
    input.activeSpaceFolder &&
    segments[0] === "Spaces" &&
    segments[1] === input.activeSpaceFolder
  ) {
    refused(
      "the active Space is already hydrated writable at this path — remounting it read-only is destructive.",
    );
  }
  return mountDir;
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface FetchWorkspaceSourceConfig {
  apiUrl?: unknown;
  apiSecret?: unknown;
  tenantId?: unknown;
  threadId?: unknown;
  threadTurnId?: unknown;
  /**
   * Runtime folder segment of the ACTIVE space (already hydrated writable).
   * A fetch targeting it is answered with a pointer instead of a remount —
   * remounting would destroy the hydrated in-lane folder and flip it
   * read-only mid-turn.
   */
  activeSpaceFolder?: unknown;
}

/** A file appended to the turn's workspace-diff baseline after a mount. */
export interface FetchedBaselineFile {
  /** Workspace-relative runtime path, e.g. `Spaces/research/notes.md`. */
  path: string;
  bytes: Uint8Array;
  etag?: string;
}

/**
 * Host seam: filesystem root + S3 download + diff-baseline append. Supplied
 * by the cloud (or desktop) host; the extension never builds these clients.
 */
export interface FetchWorkspaceSourceHost {
  workspaceDir: string;
  downloadObject(key: string): Promise<Uint8Array>;
  appendToBaseline(files: readonly FetchedBaselineFile[]): void;
}

export interface FetchWorkspaceSourceExtensionOptions {
  fetchSourceConfig?: FetchWorkspaceSourceConfig | null;
  host?: FetchWorkspaceSourceHost | null;
  fetchImpl?: FetchLike;
}

interface FetchSourceEndpointFile {
  key: string;
  etag: string;
  relPath: string;
  size: number;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Folder names the endpoint hands back / routing lists: single path segment,
 *  no traversal. Rejects anything that could escape the mount root. */
function isSafeSlug(slug: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug) &&
    !slug.includes("..") &&
    slug.length <= 120
  );
}

/** Relative paths inside the fetched folder must stay inside it. */
function safeRelPath(relPath: string): string | null {
  const normalized = relPath.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) return null;
  const segments = normalized.split("/");
  if (segments.some((s) => !s || s === "." || s === "..")) return null;
  return normalized;
}

function parseEndpointFiles(value: unknown): FetchSourceEndpointFile[] {
  if (!Array.isArray(value)) return [];
  const files: FetchSourceEndpointFile[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const key = asString(record.key);
    const relPath = asString(record.relPath);
    if (!key || !relPath) continue;
    files.push({
      key,
      relPath,
      etag: asString(record.etag),
      size: typeof record.size === "number" ? record.size : 0,
    });
  }
  return files;
}

export function createFetchWorkspaceSourceExtension(
  options: FetchWorkspaceSourceExtensionOptions,
): ThinkworkExtension {
  const config = options.fetchSourceConfig;
  const apiUrl = asString(config?.apiUrl).replace(/\/+$/, "");
  const apiSecret = asString(config?.apiSecret);
  const tenantId = asString(config?.tenantId);
  const threadId = asString(config?.threadId);
  const threadTurnId = asString(config?.threadTurnId);
  const activeSpaceFolder = asString(config?.activeSpaceFolder);
  const host = options.host ?? null;
  const enabled = Boolean(
    apiUrl &&
    apiSecret &&
    tenantId &&
    threadId &&
    threadTurnId &&
    host?.workspaceDir,
  );

  return defineExtension({
    name: "thinkwork-fetch-workspace-source",
    toolNames: enabled ? [FETCH_WORKSPACE_SOURCE_TOOL_NAME] : [],
    register(pi) {
      if (!enabled || !host) return;
      const fetchImpl = options.fetchImpl ?? fetch;

      const tool: ToolDefinition = {
        name: FETCH_WORKSPACE_SOURCE_TOOL_NAME,
        label: "Fetch Workspace Source",
        description:
          "Fetch an authorized workspace source folder into /workspace mid-turn as READ-ONLY " +
          "reference context. Valid targets are listed in the 'Workspace Routing' section of " +
          "AGENTS.md: other authorized Spaces (kind 'space') and Active Space participants " +
          "(kind 'user'). Pass listed_in_routing: true when the target appears in that section. " +
          "Spaces mount at Spaces/<slug>/ and fetched participant folders at Users/<slug>/ " +
          "(distinct from your acting user's writable User/ folder). Fetched files are " +
          "read-only context — do not attempt to edit them; writes under fetched folders are " +
          "rejected at finalize.",
        parameters: Type.Object({
          kind: Type.String({
            description: "Target kind: 'space' or 'user'.",
          }),
          slug: Type.String({
            description:
              "The target's workspace folder name as shown in the Workspace Routing section " +
              "(the segment after Spaces/ or Users/).",
          }),
          listed_in_routing: Type.Optional(
            Type.Boolean({
              description:
                "True when this target was listed in the AGENTS.md Workspace Routing section.",
            }),
          ),
        }),
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          const typed = asRecord(params);
          const kind = asString(typed.kind);
          const slug = asString(typed.slug);
          if (kind !== "space" && kind !== "user") {
            throw new Error(
              "fetch_workspace_source requires kind 'space' or 'user'.",
            );
          }
          if (!isSafeSlug(slug)) {
            throw new Error(
              "fetch_workspace_source requires a valid folder slug (a single path segment from the Workspace Routing section).",
            );
          }
          if (
            kind === "space" &&
            activeSpaceFolder &&
            slug === activeSpaceFolder
          ) {
            const text =
              `Space '${slug}' is the active Space and is already hydrated at Spaces/${slug}/ — ` +
              "read it directly; no fetch is needed.";
            return {
              content: [{ type: "text", text }],
              details: {
                status: "already_hydrated",
                mountPath: `Spaces/${slug}/`,
              },
            };
          }

          const response = await fetchImpl(
            `${apiUrl}/api/workspaces/fetch-source`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiSecret}`,
                "Content-Type": "application/json",
                "x-tenant-id": tenantId,
                "User-Agent": "Thinkwork-AgentCore-Pi/1.0",
              },
              body: JSON.stringify({
                kind,
                slug,
                threadId,
                threadTurnId,
                listedInRouting: typed.listed_in_routing === true,
              }),
            },
          );

          const body = (await response.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;
          // Identity-based "already mounted writable" answer (HTTP 200): the
          // endpoint resolved the target to the thread's active Space (under
          // any of its identifiers) or to the acting user. Informative — do
          // not mount, do not throw.
          if (
            body.outcome === "denied" &&
            asString(body.deniedReason) === "already_hydrated"
          ) {
            const hydratedAt =
              kind === "space"
                ? `Spaces/${activeSpaceFolder || slug}/`
                : "User/";
            const text =
              kind === "space"
                ? `Space '${slug}' is the active Space and is already hydrated at ${hydratedAt} — read it directly; no fetch is needed.`
                : `User '${slug}' is the acting user, whose folder is already hydrated at ${hydratedAt} — read it directly; no fetch is needed.`;
            return {
              content: [{ type: "text", text }],
              details: {
                status: "already_hydrated",
                mountPath: hydratedAt,
              },
            };
          }
          if (response.status === 403 && body.outcome === "denied") {
            const deniedReason =
              asString(body.deniedReason) || "not_authorized";
            throw new Error(
              deniedReason === "revoked"
                ? `fetch_workspace_source denied (revoked): access to ${kind} '${slug}' was revoked after this workspace was rendered. Do not retry.`
                : `fetch_workspace_source denied (not_authorized): ${kind} '${slug}' is not authorized for this thread. Do not retry.`,
            );
          }
          if (!response.ok) {
            const detail = JSON.stringify(body).slice(0, 500);
            throw new Error(
              `fetch_workspace_source failed: HTTP ${response.status}${
                detail && detail !== "{}" ? `: ${detail}` : ""
              }`,
            );
          }

          const partial = body.outcome === "partial" || body.partial === true;
          const files = parseEndpointFiles(body.files);
          // Fetched participants mount at the top-level plural `Users/` root —
          // NEVER inside the acting user's writable `User/` tree, where a slug
          // collision (e.g. 'memory') would rm -rf a writable lane and bleed
          // another user's files into the acting user's reconcile source.
          const mountRel =
            kind === "space" ? `Spaces/${slug}` : `Users/${slug}`;
          const mountPath = `${mountRel}/`;
          // Hard guard: refuse any computed mount that resolves into User/ or
          // any other hydrated writable root (defense in depth — slug + kind
          // validation should already make this unreachable).
          const mountDir = resolveSafeMountDir({
            workspaceDir: host.workspaceDir,
            mountRel,
            activeSpaceFolder,
          });

          if (files.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `Fetched ${kind} '${slug}': the source folder is empty (0 files). Nothing was mounted.`,
                },
              ],
              details: {
                status: "success",
                mountPath,
                fileCount: 0,
                totalBytes: 0,
                partial: false,
              },
            };
          }

          // --- Stage into a temp dir; only a complete download mounts. ----
          const workspaceDir = host.workspaceDir;
          const stagingDir = path.join(
            workspaceDir,
            `${FETCH_STAGING_PREFIX}${randomUUID()}`,
          );
          const baselineFiles: FetchedBaselineFile[] = [];
          let totalBytes = 0;
          try {
            // Validate every relPath up front so an unsafe entry fails
            // before any download starts.
            const validated = files.map((file) => {
              const relPath = safeRelPath(file.relPath);
              if (!relPath) {
                throw new Error(
                  `fetch_workspace_source: endpoint returned an unsafe path '${file.relPath}'.`,
                );
              }
              return { ...file, relPath };
            });

            // Bounded-concurrency worker pool (FETCH_DOWNLOAD_CONCURRENCY
            // parallel downloads) over the file list. Results land by index
            // so the baseline order matches the endpoint's deterministic
            // sorted-by-key order. allSettled lets in-flight workers finish
            // writing into the staging dir before a failure discards it.
            let nextIndex = 0;
            const staged: Array<FetchedBaselineFile | undefined> = new Array(
              validated.length,
            );
            const worker = async (): Promise<void> => {
              for (;;) {
                const index = nextIndex;
                nextIndex += 1;
                if (index >= validated.length) return;
                const file = validated[index]!;
                const bytes = await host.downloadObject(file.key);
                const stagedPath = path.join(stagingDir, file.relPath);
                await mkdir(path.dirname(stagedPath), { recursive: true });
                await writeFile(stagedPath, bytes);
                // Read-only files; directories stay writable so an
                // idempotent re-fetch (rm + rename) and container cleanup
                // keep working.
                await chmod(stagedPath, 0o444);
                staged[index] = {
                  path: `${mountRel}/${file.relPath}`,
                  bytes,
                  etag: file.etag || undefined,
                };
              }
            };
            const settled = await Promise.allSettled(
              Array.from(
                {
                  length: Math.min(
                    FETCH_DOWNLOAD_CONCURRENCY,
                    validated.length,
                  ),
                },
                () => worker(),
              ),
            );
            const failure = settled.find(
              (result) => result.status === "rejected",
            );
            if (failure && failure.status === "rejected") {
              throw failure.reason instanceof Error
                ? failure.reason
                : new Error(String(failure.reason));
            }
            for (const file of staged) {
              if (!file) throw new Error("fetch_workspace_source: staging incomplete.");
              totalBytes += file.bytes.byteLength;
              baselineFiles.push(file);
            }

            // --- Atomic mount: clear any prior fetch, rename into place. --
            await rm(mountDir, { recursive: true, force: true });
            await mkdir(path.dirname(mountDir), { recursive: true });
            await rename(stagingDir, mountDir);
          } catch (err) {
            await rm(stagingDir, { recursive: true, force: true }).catch(
              () => {},
            );
            throw new Error(
              `fetch_workspace_source failed before mounting (nothing was mounted): ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }

          // Baseline append AFTER a successful mount so a failed fetch never
          // poisons the diff baseline. Re-fetch overwrites the same keys —
          // no duplicate entries.
          host.appendToBaseline(baselineFiles);

          const listed = files
            .slice(0, 20)
            .map((file) => `- ${mountRel}/${file.relPath}`)
            .join("\n");
          const more =
            files.length > 20 ? `\n…and ${files.length - 20} more files.` : "";
          const partialNote = partial
            ? "\nNOTE: the source folder exceeded the per-fetch cap — this is a deterministic subset (outcome: partial)."
            : "";
          return {
            content: [
              {
                type: "text",
                text:
                  `Mounted ${files.length} file(s) from ${kind} '${slug}' at ${mountPath} (read-only).` +
                  `${partialNote}\n${listed}${more}`,
              },
            ],
            details: {
              status: partial ? "partial" : "success",
              mountPath,
              fileCount: files.length,
              totalBytes,
              partial,
              files: files.slice(0, 50).map((file) => file.relPath),
            },
          };
        },
      };

      pi.registerTool(tool);
    },
  });
}
