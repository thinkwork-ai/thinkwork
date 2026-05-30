"use client";

import { Button } from "@thinkwork/ui/button";
import type { BundledLanguage } from "shiki";
import {
  FolderTreeIcon,
  Loader2Icon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import type { WorkspaceTreeNode } from "@thinkwork/desktop-ipc";
import { CodeBlock, CodeBlockCopyButton } from "@/components/ai-elements/code-block";
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from "@/components/ai-elements/file-tree";
import {
  type LocalWorkspaceBridge,
  useLocalWorkspace,
} from "./useLocalWorkspace";

export interface LocalWorkspaceViewProps {
  /** Optional return affordance; the route passes a router-back handler. */
  onClose?: () => void;
  /** Test seam: inject a bridge instead of reading the desktop global. */
  bridge?: LocalWorkspaceBridge | null;
}

function renderNodes(
  nodes: WorkspaceTreeNode[],
  defaultExpanded: boolean,
): React.ReactNode {
  return nodes.map((node) =>
    node.kind === "dir" ? (
      <FileTreeFolder
        key={node.path}
        path={node.path}
        name={
          node.truncated ? (
            <span>
              {node.name}{" "}
              <span className="text-muted-foreground">(truncated)</span>
            </span>
          ) : (
            node.name
          )
        }
        defaultExpanded={defaultExpanded}
      >
        {node.children ? renderNodes(node.children, false) : null}
      </FileTreeFolder>
    ) : (
      <FileTreeFile key={node.path} path={node.path} name={node.name} />
    ),
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      <div className="max-w-sm">{children}</div>
    </div>
  );
}

export function LocalWorkspaceView({ onClose, bridge }: LocalWorkspaceViewProps) {
  const ws = useLocalWorkspace(bridge);

  if (!ws.available) {
    return (
      <Centered>
        Local Workspace is only available in the desktop app.
      </Centered>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <FolderTreeIcon className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">Local Workspace</h1>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={ws.refresh}
            disabled={ws.treeLoading}
          >
            <RefreshCwIcon
              className={ws.treeLoading ? "size-4 animate-spin" : "size-4"}
            />
            Refresh
          </Button>
          {onClose ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close"
            >
              <XIcon className="size-4" />
            </Button>
          ) : null}
        </div>
      </header>
      <p className="border-b bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
        Shows every workspace synced to this machine, including any credentials
        stored in workspace files.
      </p>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,320px)_1fr]">
        <div className="min-h-0 overflow-auto border-r p-2">
          <WorkspaceTreePane ws={ws} />
        </div>
        <div className="min-h-0 overflow-auto">
          <WorkspaceContentPane ws={ws} />
        </div>
      </div>
    </div>
  );
}

function WorkspaceTreePane({
  ws,
}: {
  ws: ReturnType<typeof useLocalWorkspace>;
}) {
  if (ws.tree == null && ws.treeLoading) {
    return (
      <Centered>
        <Loader2Icon className="mx-auto size-5 animate-spin" />
      </Centered>
    );
  }
  if (!ws.tree) return null;
  if (ws.tree.status === "empty") {
    return (
      <Centered>
        Nothing synced yet. Files appear here once a workspace syncs to this
        device.
      </Centered>
    );
  }
  if (ws.tree.status === "error") {
    return (
      <Centered>
        <p>Couldn&apos;t read the local workspace ({ws.tree.code}).</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={ws.refresh}
        >
          Retry
        </Button>
      </Centered>
    );
  }
  return (
    <>
      {ws.tree.truncated ? (
        <p className="mb-1 px-2 text-xs text-muted-foreground">
          Tree truncated — too many entries to show all.
        </p>
      ) : null}
      <FileTree selectedPath={ws.selectedPath ?? undefined} onSelect={ws.select}>
        {renderNodes(ws.tree.tree, true)}
      </FileTree>
    </>
  );
}

function WorkspaceContentPane({
  ws,
}: {
  ws: ReturnType<typeof useLocalWorkspace>;
}) {
  if (ws.selectionMissing) {
    return (
      <Centered>
        That file is no longer in the cache. Refresh to see the latest.
      </Centered>
    );
  }
  if (!ws.selectedPath) {
    return <Centered>Select a file to view its contents.</Centered>;
  }
  if (ws.fileLoading && !ws.file) {
    return (
      <Centered>
        <Loader2Icon className="mx-auto size-5 animate-spin" />
      </Centered>
    );
  }
  if (!ws.file) return null;

  switch (ws.file.status) {
    case "ok":
      return (
        <div className="p-3">
          <div className="mb-2 px-1 font-mono text-xs text-muted-foreground">
            {ws.selectedPath}
          </div>
          <CodeBlock
            code={ws.file.content}
            language={ws.file.language as BundledLanguage}
            showLineNumbers
          >
            <CodeBlockCopyButton />
          </CodeBlock>
        </div>
      );
    case "too-large":
      return (
        <Centered>
          Preview unavailable — file is{" "}
          {(ws.file.size / (1024 * 1024)).toFixed(1)} MB.
        </Centered>
      );
    case "binary":
      return <Centered>Binary file — preview unavailable.</Centered>;
    case "vanished":
      return (
        <Centered>
          That file is no longer in the cache. Refresh to see the latest.
        </Centered>
      );
    case "error":
      return (
        <Centered>
          <p>Couldn&apos;t read this file ({ws.file.code}).</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => ws.selectedPath && ws.select(ws.selectedPath)}
          >
            Retry
          </Button>
        </Centered>
      );
  }
}
