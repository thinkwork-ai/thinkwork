"use client";

import {
  Button,
  cn,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@thinkwork/ui";
import type { BundledLanguage } from "shiki";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import type { WorkspaceTreeNode } from "@thinkwork/desktop-ipc";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  CodeBlock,
  CodeBlockCopyButton,
} from "@/components/ai-elements/code-block";
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from "@/components/ai-elements/file-tree";
import { useEditorFontSize, useEditorWrap } from "@/lib/editor-prefs";
import {
  type LocalWorkspaceBridge,
  useLocalWorkspace,
} from "./useLocalWorkspace";

export interface LocalWorkspaceViewProps {
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

export function LocalWorkspaceView({ bridge }: LocalWorkspaceViewProps) {
  const ws = useLocalWorkspace(bridge);

  // Publish the section title + an icon-only Refresh into the settings header
  // bar — no second in-view header. The PageHeaderProvider lives at the app
  // root (main.tsx), so it's always present for this route.
  const { refresh, treeLoading, available } = ws;
  usePageHeaderActions({
    title: "Workspace",
    breadcrumbs: [{ label: "Workspace" }],
    action: available ? (
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={refresh}
        disabled={treeLoading}
        aria-label="Refresh"
        title="Refresh"
      >
        <RefreshCwIcon
          className={treeLoading ? "size-4 animate-spin" : "size-4"}
        />
      </Button>
    ) : undefined,
    actionKey: `local-workspace:${available ? "on" : "off"}:${treeLoading}`,
  });

  if (!available) {
    return <Centered>Workspace is only available in the desktop app.</Centered>;
  }

  return (
    <div className="flex h-full flex-col">
      <p className="border-b bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
        Shows every workspace synced to this machine, including any credentials
        stored in workspace files.
      </p>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel
          defaultSize="28%"
          minSize="15%"
          maxSize="55%"
          className="min-h-0 overflow-auto p-2"
        >
          <WorkspaceTreePane ws={ws} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="72%" className="min-h-0 overflow-auto">
          <WorkspaceContentPane ws={ws} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function WorkspaceTreePane({
  ws,
}: {
  ws: ReturnType<typeof useLocalWorkspace>;
}) {
  const fontSize = useEditorFontSize();
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
      <FileTree
        selectedPath={ws.selectedPath ?? undefined}
        onSelect={ws.select}
        style={{ fontSize: `${fontSize}px` }}
      >
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
  const wrap = useEditorWrap();
  const fontSize = useEditorFontSize();

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
      // Borderless, edge-to-edge editor that fills the pane. Overrides on the
      // shared CodeBlock: drop its border/rounding, stretch it + its pre
      // wrappers to full height (`:not(:last-child)` excludes the absolute copy
      // button so its hit area isn't expanded), tighten the pre's left padding,
      // and inherit the user's font size (overrides CodeBlock's text-sm). Wrap
      // toggles soft-wrapping vs the default horizontal scroll.
      return (
        <CodeBlock
          code={ws.file.content}
          language={ws.file.language as BundledLanguage}
          showLineNumbers
          style={{ fontSize: `${fontSize}px` }}
          className={cn(
            "h-full rounded-none border-0 [&>div]:h-full [&>div>div:not(:last-child)]:h-full [&_pre]:min-h-full [&_pre]:!pl-2 [&_code]:![font-size:inherit] [&_pre]:![font-size:inherit]",
            wrap && "[&_pre]:break-words [&_pre]:whitespace-pre-wrap",
          )}
        >
          <CodeBlockCopyButton />
        </CodeBlock>
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
