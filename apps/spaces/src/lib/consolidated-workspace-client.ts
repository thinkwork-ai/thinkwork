import type {
  WorkspaceFileMeta,
  WorkspaceFilesClient,
  WorkspaceMoveResult,
} from "@thinkwork/workspace-editor";
import {
  spacesWorkspaceFilesClient,
  type WorkspaceFilesTarget,
} from "@/lib/workspace-files-api";

/**
 * Consolidated, S3-backed workspace editor client.
 *
 * `WorkspaceFileEditor` is single-target, but the Settings → Workspace view
 * presents all three workspace sources — the tenant Agent, each Space, and the
 * current User — as one tree. This client composes them: `listFiles` fans out
 * to every sub-target and prefixes the returned paths with a synthetic top
 * folder (`Agent/`, `Spaces/<space-name>/`, `User/`), and every other operation
 * parses that prefix to route back to the correct per-target API call.
 *
 * This is the same prefix-strip/re-prefix pattern `skillCatalogClient` uses in
 * `workspace-files-api.ts`, generalized across multiple roots. All reads and
 * writes go through `spacesWorkspaceFilesClient` (POST /api/workspaces/files),
 * so server-side side-effects (agent_skills re-derivation, governance audit,
 * manifest regen, built-in-tool guards) all fire on save.
 */

export const AGENT_ROOT = "Agent";
export const SPACES_ROOT = "Spaces";
export const USER_ROOT = "User";

export interface ConsolidatedSpace {
  id: string;
  /** Human display name; becomes the folder label under `Spaces/`. */
  name: string;
}

/** The set of underlying sources the consolidated tree spans. */
export interface ConsolidatedTarget {
  agentId: string | null;
  spaces: ConsolidatedSpace[];
  userId: string | null;
}

interface ResolvedSource {
  sub: WorkspaceFilesTarget;
  /** Path relative to the source root (what the API expects). */
  logical: string;
  /** The synthetic top-folder prefix, including trailing slash. */
  prefix: string;
}

function assertSafe(path: string): void {
  if (path.split("/").some((seg) => seg === "..")) {
    throw new Error(`Unsafe workspace path: ${path}`);
  }
}

/**
 * Resolves a cleaned `Spaces/<name>/...` path to its space by longest matching
 * `Spaces/<name>/` prefix. Prefix matching (rather than taking the second path
 * segment) keeps routing correct even when a space display name contains a
 * slash, and longest-match disambiguates names where one is a prefix of another
 * (e.g. "fin" vs "finance"). If two spaces share a name, the first wins —
 * acceptable at the documented scale.
 */
function matchSpace(
  target: ConsolidatedTarget,
  clean: string,
): { space: ConsolidatedSpace; logical: string; prefix: string } | undefined {
  const candidates = target.spaces
    .filter(
      (space) =>
        clean === `${SPACES_ROOT}/${space.name}` ||
        clean.startsWith(`${SPACES_ROOT}/${space.name}/`),
    )
    .sort((a, b) => b.name.length - a.name.length);
  const space = candidates[0];
  if (!space) return undefined;
  const prefix = `${SPACES_ROOT}/${space.name}/`;
  const logical = clean.startsWith(prefix) ? clean.slice(prefix.length) : "";
  return { space, logical, prefix };
}

/**
 * The underlying sources + their synthetic top-folder prefixes. The single
 * source of truth for the source↔prefix mapping that both `listFiles` (forward)
 * and `resolveSource` (inverse) rely on.
 */
function listableSources(
  target: ConsolidatedTarget,
): { sub: WorkspaceFilesTarget; prefix: string }[] {
  const sources: { sub: WorkspaceFilesTarget; prefix: string }[] = [];
  if (target.agentId) {
    sources.push({
      sub: { agentId: target.agentId },
      prefix: `${AGENT_ROOT}/`,
    });
  }
  for (const space of target.spaces) {
    sources.push({
      sub: { spaceId: space.id },
      prefix: `${SPACES_ROOT}/${space.name}/`,
    });
  }
  if (target.userId) {
    sources.push({ sub: { userId: target.userId }, prefix: `${USER_ROOT}/` });
  }
  return sources;
}

/**
 * Resolves both endpoints of a move/rename and enforces that they live in the
 * same source — a single API call can't relocate across the Agent/Spaces/User
 * boundary. Throws with the given verb on a cross-source attempt.
 */
function resolveSameSource(
  target: ConsolidatedTarget,
  fromPath: string,
  destPath: string,
  verb: "move" | "rename",
): { from: ResolvedSource; to: ResolvedSource } {
  const from = resolveSource(target, fromPath);
  const to = resolveSource(target, destPath);
  if (from.prefix !== to.prefix) {
    throw new Error(`Cannot ${verb} files across workspace sources`);
  }
  return { from, to };
}

/**
 * Maps a consolidated path (`Agent/AGENTS.md`, `Spaces/finance/GOAL.md`,
 * `User/USER.md`) to its underlying target + root-relative logical path.
 * Throws for unknown roots, unmapped spaces, or unsafe segments.
 */
function resolveSource(
  target: ConsolidatedTarget,
  path: string,
): ResolvedSource {
  assertSafe(path);
  const clean = path.replace(/^\/+/, "");
  const segments = clean.split("/");
  const root = segments[0];

  if (root === AGENT_ROOT) {
    if (!target.agentId) throw new Error("No agent source available");
    return {
      sub: { agentId: target.agentId },
      logical: segments.slice(1).join("/"),
      prefix: `${AGENT_ROOT}/`,
    };
  }

  if (root === USER_ROOT) {
    if (!target.userId) throw new Error("No user source available");
    return {
      sub: { userId: target.userId },
      logical: segments.slice(1).join("/"),
      prefix: `${USER_ROOT}/`,
    };
  }

  if (root === SPACES_ROOT) {
    const match = matchSpace(target, clean);
    if (!match) {
      throw new Error(`Unknown space folder: ${segments[1] ?? "(none)"}`);
    }
    return {
      sub: { spaceId: match.space.id },
      logical: match.logical,
      prefix: match.prefix,
    };
  }

  // Empty/root or unrecognized top folder. The consolidated view has no single
  // target at the root — files must live under Agent, Spaces, or User. Surface
  // a human-readable message (this reaches the editor's toast on a root-level
  // create/move) rather than leaking the internal root token.
  throw new Error(
    "Choose a folder under Agent, Spaces, or User — files can't live at the workspace root.",
  );
}

async function listPrefixed(
  sub: WorkspaceFilesTarget,
  prefix: string,
): Promise<WorkspaceFileMeta[]> {
  const { files } = await spacesWorkspaceFilesClient.listFiles(sub);
  return files.map((file) => ({ ...file, path: `${prefix}${file.path}` }));
}

export function createConsolidatedWorkspaceClient(): WorkspaceFilesClient<ConsolidatedTarget> {
  return {
    async listFiles(target) {
      // Degrade gracefully: a source the caller can't read (or that errors)
      // is simply absent from the tree rather than blanking the whole view.
      const settled = await Promise.allSettled(
        listableSources(target).map(({ sub, prefix }) =>
          listPrefixed(sub, prefix),
        ),
      );
      const files = settled.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
      return { files };
    },

    async getFile(target, path) {
      const { sub, logical } = resolveSource(target, path);
      return spacesWorkspaceFilesClient.getFile(sub, logical);
    },

    async putFile(target, path, content) {
      const { sub, logical } = resolveSource(target, path);
      return spacesWorkspaceFilesClient.putFile(sub, logical, content);
    },

    async deleteFile(target, path) {
      const { sub, logical } = resolveSource(target, path);
      return spacesWorkspaceFilesClient.deleteFile(sub, logical);
    },

    async movePath(target, fromPath, toFolder): Promise<WorkspaceMoveResult> {
      const { from, to } = resolveSameSource(
        target,
        fromPath,
        toFolder,
        "move",
      );
      const result = await spacesWorkspaceFilesClient.movePath?.(
        from.sub,
        from.logical,
        to.logical,
      );
      return { destPath: `${from.prefix}${result?.destPath ?? from.logical}` };
    },

    async renamePath(target, fromPath, toPath): Promise<WorkspaceMoveResult> {
      const { from, to } = resolveSameSource(
        target,
        fromPath,
        toPath,
        "rename",
      );
      const result = await spacesWorkspaceFilesClient.renamePath?.(
        from.sub,
        from.logical,
        to.logical,
      );
      return { destPath: `${from.prefix}${result?.destPath ?? to.logical}` };
    },
  };
}
