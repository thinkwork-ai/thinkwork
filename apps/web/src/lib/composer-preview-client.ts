/**
 * Composer preview client (Composer plan U2 + v1.1 feedback item 1).
 *
 * A READ-ONLY `WorkspaceFilesClient` adapter over the two workspace-preview
 * GraphQL queries so the Composer can drive the SAME editor shell as
 * Settings → Workspace (`WorkspaceFileEditor` / `FileEditorPane`) instead of a
 * bespoke disclosure list:
 *
 *   - `listFiles`  → `workspacePreview` (the rendered-workspace tree query);
 *   - `getFile`    → `workspacePreviewFile` (lazy per-file content);
 *   - `putFile` / `deleteFile` → rejected. The rendered workspace is DERIVED
 *     (`persist:false` render path) — file CONTENTS are never editable here; the
 *     owning source layer is edited behind jump-to-cause / the U7 split view.
 *
 * The adapter additionally exposes `getManifest` / `getFilePayload`, which
 * surface the preview metadata the plain `WorkspaceFilesClient` shape can't
 * carry (per-file `generated` flag + byte size, the echoed selection ids, the
 * `noUserBaseline` marker, and the resolver `state`/`stateDetail`). The Composer
 * shell uses those to decorate the tree, drive the generated-file split view,
 * and render selection-fault states.
 */

import type {
  WorkspaceFileSource,
  WorkspaceFilesClient,
} from "@thinkwork/workspace-editor";
import {
  SettingsWorkspacePreviewFileQuery,
  SettingsWorkspacePreviewQuery,
} from "@/lib/settings-queries";

export const COMPOSER_READ_ONLY_MESSAGE =
  "The rendered workspace is derived and read-only — edit the owning source layer behind jump-to-cause instead.";

export interface ComposerPreviewEntry {
  path: string;
  owner: string;
  generated: boolean;
  size?: number | null;
}

export interface ComposerPreviewManifest {
  state: string;
  stateDetail: string | null;
  agentId: string | null;
  spaceId: string | null;
  perspectiveUserId: string | null;
  noUserBaseline: boolean;
  entries: ComposerPreviewEntry[];
}

export interface ComposerPreviewFilePayload {
  state: string;
  stateDetail: string | null;
  content: string | null;
  entry: ComposerPreviewEntry | null;
}

export interface ComposerPreviewVars {
  tenantId: string;
  spaceId: string | null;
  perspectiveUserId: string | null;
}

/** Read-only adapter target — the selection tuple is baked into the closure. */
export type ComposerPreviewTarget = Record<string, never>;

export interface ComposerPreviewClient extends WorkspaceFilesClient<ComposerPreviewTarget> {
  getManifest(): Promise<ComposerPreviewManifest>;
  getFilePayload(path: string): Promise<ComposerPreviewFilePayload>;
}

/** Map the preview owner label onto the editor's file-source vocabulary. */
function ownerToSource(owner: string): WorkspaceFileSource {
  switch (owner) {
    case "space":
      return "space";
    case "user":
      return "user";
    case "agent":
      return "agent";
    default:
      return "thread";
  }
}

interface QueryRunnerResult {
  data?: unknown;
  error?: { message: string } | null;
}

/**
 * Minimal urql surface the adapter needs — keeps it trivially fakeable in tests
 * and sidesteps urql's generic `Client['query']` signature (which doesn't
 * survive being wrapped).
 */
export interface ComposerQueryRunner {
  query(
    doc: unknown,
    variables: Record<string, unknown>,
    context?: { requestPolicy?: string },
  ): { toPromise(): Promise<QueryRunnerResult> };
}

interface PreviewQueryData {
  workspacePreview?: {
    state: string;
    stateDetail?: string | null;
    agentId?: string | null;
    spaceId?: string | null;
    perspectiveUserId?: string | null;
    noUserBaseline?: boolean | null;
    files?: ComposerPreviewEntry[] | null;
  } | null;
}

interface PreviewFileQueryData {
  workspacePreviewFile?: {
    state: string;
    stateDetail?: string | null;
    file?: ComposerPreviewEntry | null;
    content?: string | null;
  } | null;
}

export function createComposerPreviewClient(
  client: ComposerQueryRunner,
  vars: ComposerPreviewVars,
): ComposerPreviewClient {
  const baseVariables = {
    tenantId: vars.tenantId,
    agentId: null,
    spaceId: vars.spaceId,
    perspectiveUserId: vars.perspectiveUserId,
  };

  async function getManifest(): Promise<ComposerPreviewManifest> {
    const result = await client
      .query(SettingsWorkspacePreviewQuery, baseVariables, {
        requestPolicy: "network-only",
      })
      .toPromise();
    if (result.error) throw result.error;
    const preview = (result.data as PreviewQueryData | undefined)
      ?.workspacePreview;
    if (!preview) {
      throw new Error("The rendered workspace could not be loaded.");
    }
    return {
      state: preview.state,
      stateDetail: preview.stateDetail ?? null,
      agentId: preview.agentId ?? null,
      spaceId: preview.spaceId ?? null,
      perspectiveUserId: preview.perspectiveUserId ?? null,
      noUserBaseline: Boolean(preview.noUserBaseline),
      entries: ((preview.files ?? []) as ComposerPreviewEntry[]).map(
        (entry) => ({
          path: entry.path,
          owner: entry.owner,
          generated: Boolean(entry.generated),
          size: entry.size ?? null,
        }),
      ),
    };
  }

  async function getFilePayload(
    path: string,
  ): Promise<ComposerPreviewFilePayload> {
    const result = await client
      .query(
        SettingsWorkspacePreviewFileQuery,
        { ...baseVariables, path },
        { requestPolicy: "network-only" },
      )
      .toPromise();
    if (result.error) throw result.error;
    const payload = (result.data as PreviewFileQueryData | undefined)
      ?.workspacePreviewFile;
    if (!payload) {
      throw new Error("This file could not be loaded.");
    }
    const file = (payload.file ?? null) as ComposerPreviewEntry | null;
    return {
      state: payload.state,
      stateDetail: payload.stateDetail ?? null,
      content: payload.content ?? null,
      entry: file
        ? {
            path: file.path,
            owner: file.owner,
            generated: Boolean(file.generated),
            size: file.size ?? null,
          }
        : null,
    };
  }

  return {
    getManifest,
    getFilePayload,
    async listFiles() {
      const manifest = await getManifest();
      return {
        files: manifest.entries.map((entry) => ({
          path: entry.path,
          source: ownerToSource(entry.owner),
          sha256: "",
        })),
      };
    },
    async getFile(_target, path) {
      const payload = await getFilePayload(path);
      if (payload.state !== "ok") {
        throw new Error(
          payload.stateDetail ??
            "This file is no longer part of the rendered workspace.",
        );
      }
      return {
        content: payload.content ?? "",
        source: ownerToSource(payload.entry?.owner ?? "agent"),
        sha256: "",
      };
    },
    async putFile() {
      throw new Error(COMPOSER_READ_ONLY_MESSAGE);
    },
    async deleteFile() {
      throw new Error(COMPOSER_READ_ONLY_MESSAGE);
    },
  };
}
