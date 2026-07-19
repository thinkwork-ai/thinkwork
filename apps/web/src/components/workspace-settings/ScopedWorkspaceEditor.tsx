"use client";

import { useMemo } from "react";
import { WorkspaceFileEditor } from "@thinkwork/workspace-editor";
import { useTenant } from "@/context/TenantContext";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  createPrefixedWorkspaceClient,
  spacesWorkspaceFilesClient,
  type WorkspaceFilesTarget,
} from "@/lib/workspace-files-api";

/**
 * A WorkspaceFileEditor bound to exactly one workspace source (agent / Space /
 * user), optionally narrowed to a sub-folder of that source. This is the
 * per-scope replacement for the consolidated Settings → Workspace tree: each
 * settings surface embeds one of these with its own single target, so edits
 * land under that source and the tree never lists another source's files.
 *
 * Operators may edit any source. Every admitted user may also edit their own
 * user source, matched by the resolved database users.id from /api/auth/me.
 * Gating on roleResolved prevents a writable flash before caller identity and
 * role have resolved; the server repeats the same self-only authorization.
 */
export function ScopedWorkspaceEditor({
  target,
  targetKey,
  defaultOpenFile,
  pathPrefix,
  bordered = true,
  className,
}: {
  target: WorkspaceFilesTarget;
  targetKey: string;
  defaultOpenFile?: string;
  /** Narrow the editor to a sub-folder of the source (e.g. `agents/`). */
  pathPrefix?: string;
  bordered?: boolean;
  className?: string;
}) {
  const { isOperator, roleResolved, userId: callerUserId } = useTenant();
  const isSelfUserTarget =
    "userId" in target &&
    Boolean(callerUserId) &&
    target.userId === callerUserId;

  const client = useMemo(
    () =>
      pathPrefix
        ? createPrefixedWorkspaceClient(pathPrefix)
        : spacesWorkspaceFilesClient,
    [pathPrefix],
  );

  return (
    <WorkspaceFileEditor
      target={target}
      targetKey={targetKey}
      client={client}
      readOnly={!(roleResolved && (isOperator || isSelfUserTarget))}
      defaultOpenFile={defaultOpenFile}
      bordered={bordered}
      className={className}
      loadingSlot={<LoadingShimmer />}
    />
  );
}
