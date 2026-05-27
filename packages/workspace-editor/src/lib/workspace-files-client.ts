export type WorkspaceFileSource =
  | "agent"
  | "agent-override"
  | "agent-override-pinned"
  | "template"
  | "template-pinned"
  | "space"
  | "thread"
  | "computer"
  | "user"
  | "catalog"
  | "defaults";

export interface WorkspaceFileMeta {
  path: string;
  source: WorkspaceFileSource;
  sha256: string;
  overridden?: boolean;
}

export interface WorkspaceMoveResult {
  destPath: string;
}

export interface WorkspaceFilesClient<TTarget> {
  listFiles(target: TTarget): Promise<{ files: WorkspaceFileMeta[] }>;
  getFile(
    target: TTarget,
    path: string,
  ): Promise<{ content: string | null; source: WorkspaceFileSource; sha256: string }>;
  putFile(target: TTarget, path: string, content: string): Promise<void>;
  deleteFile(target: TTarget, path: string): Promise<void>;
  movePath?(
    target: TTarget,
    fromPath: string,
    toFolder: string,
  ): Promise<WorkspaceMoveResult>;
  renamePath?(
    target: TTarget,
    fromPath: string,
    toPath: string,
  ): Promise<WorkspaceMoveResult>;
}
