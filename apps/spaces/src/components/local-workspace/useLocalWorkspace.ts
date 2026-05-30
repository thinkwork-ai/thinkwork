import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ReadWorkspaceFileResponse,
  ReadWorkspaceTreeResponse,
  WorkspaceTreeNode,
} from "@thinkwork/desktop-ipc";
import { getDesktopBridge } from "@/lib/desktop-runtime";

export type LocalWorkspaceBridge = Pick<
  NonNullable<ReturnType<typeof getDesktopBridge>>,
  "readWorkspaceTree" | "readWorkspaceFile"
>;

export interface LocalWorkspaceState {
  available: boolean;
  tree: ReadWorkspaceTreeResponse | null;
  treeLoading: boolean;
  selectedPath: string | null;
  file: ReadWorkspaceFileResponse | null;
  fileLoading: boolean;
  /** Selected file is no longer present in the cache after a refresh. */
  selectionMissing: boolean;
  refresh: () => void;
  select: (path: string) => void;
}

function findNode(
  nodes: WorkspaceTreeNode[],
  target: string,
): WorkspaceTreeNode | null {
  for (const node of nodes) {
    if (node.path === target) return node;
    if (node.children) {
      const hit = findNode(node.children, target);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Drives the Local Workspace inspector over the desktop bridge. Read-only:
 * loads the cache tree, reads a selected file, and refreshes both. Stale
 * responses are dropped via per-kind request tokens so a slow read superseded
 * by a newer selection never paints. Returns `available: false` off-desktop or
 * when the preload bridge is absent.
 */
export function useLocalWorkspace(
  bridgeOverride?: LocalWorkspaceBridge | null,
): LocalWorkspaceState {
  const bridge = bridgeOverride ?? getDesktopBridge();
  const available = bridge != null;

  const [tree, setTree] = useState<ReadWorkspaceTreeResponse | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [file, setFile] = useState<ReadWorkspaceFileResponse | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [selectionMissing, setSelectionMissing] = useState(false);

  const treeToken = useRef(0);
  const fileToken = useRef(0);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedPath;

  const readFile = useCallback(
    async (path: string) => {
      if (!bridge) return;
      const token = ++fileToken.current;
      setFileLoading(true);
      setSelectionMissing(false);
      try {
        const result = await bridge.readWorkspaceFile({ path });
        if (token !== fileToken.current) return; // superseded
        setFile(result);
      } catch {
        if (token !== fileToken.current) return;
        setFile({ status: "error", code: "EREQUEST" });
      } finally {
        if (token === fileToken.current) setFileLoading(false);
      }
    },
    [bridge],
  );

  const refresh = useCallback(async () => {
    if (!bridge) return;
    const token = ++treeToken.current;
    setTreeLoading(true);
    let result: ReadWorkspaceTreeResponse;
    try {
      result = await bridge.readWorkspaceTree();
    } catch {
      result = { status: "error", code: "EREQUEST" };
    }
    if (token !== treeToken.current) return; // superseded
    setTree(result);
    setTreeLoading(false);

    // Reconcile the current selection against the refreshed tree.
    const current = selectedRef.current;
    if (!current) return;
    const node = result.status === "ok" ? findNode(result.tree, current) : null;
    if (!node || node.kind === "dir") {
      // Missing, or the path is now a folder → clear the content pane but keep
      // the tree. Bump the file token so any in-flight read is discarded.
      fileToken.current++;
      setSelectedPath(null);
      setFile(null);
      setFileLoading(false);
      setSelectionMissing(Boolean(current) && !node);
    } else {
      void readFile(current);
    }
  }, [bridge, readFile]);

  const select = useCallback(
    (path: string) => {
      setSelectedPath(path);
      setSelectionMissing(false);
      void readFile(path);
    },
    [readFile],
  );

  // Stable identity so callers (e.g. the settings header action) can depend on
  // it without re-publishing every render.
  const refreshStable = useCallback(() => void refresh(), [refresh]);

  useEffect(() => {
    if (bridge) void refresh();
    // Initial load only; refresh identity is stable for a given bridge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  return {
    available,
    tree,
    treeLoading,
    selectedPath,
    file,
    fileLoading,
    selectionMissing,
    refresh: refreshStable,
    select,
  };
}
