import { gql, useQuery } from "urql";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FilePlus,
  Folder,
  FolderPlus,
  Loader2,
  Plus,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { AcceptTemplateUpdateDialog } from "@/components/AcceptTemplateUpdateDialog";
import { PageLayout } from "@/components/PageLayout";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentDetailQuery } from "@/lib/graphql-queries";
import {
  agentBuilderApi,
  type ComposeSource,
  type Target,
} from "@/lib/agent-builder-api";
import {
  SKILL_AUTHORING_TEMPLATES,
  SKILL_CATEGORIES,
  buildLocalSkillPath,
  renderSkillExtraFiles,
  renderSkillTemplate,
  slugifySkillName,
  type SkillTemplateKey,
} from "@/lib/skill-authoring-templates";
import { FileEditorPane } from "./FileEditorPane";
import { FolderTree, buildWorkspaceTree } from "./FolderTree";
import { ImportDropzone } from "./ImportDropzone";

const AgentPinStatusQuery = gql`
  query AgentPinStatus($agentId: ID!) {
    agentPinStatus(agentId: $agentId, includeNested: true) {
      path
      folderPath
      filename
      pinnedSha
      latestSha
      updateAvailable
      pinnedContent
      latestContent
    }
  }
`;

type PinStatusEntry = {
  path: string;
  folderPath: string | null;
  filename: string;
  pinnedSha: string | null;
  latestSha: string | null;
  updateAvailable: boolean;
  pinnedContent: string | null;
  latestContent: string | null;
};

const DEFAULT_ROUTER = `# Workspace Router

## default
- load: SOUL.md, IDENTITY.md, USER.md

## chat
- load: docs/tone.md, memory/preferences.md

## email
- load: docs/procedures/

## heartbeat
- load: docs/procedures/
- skip: IDENTITY.md, USER.md
`;

const DEFAULT_AGENTS = `# Agent Map

## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| General work | ./ | CONTEXT.md |  |
`;

const DEFAULT_CONTEXT = `# Context

Describe the root scope this agent owns.
`;

const FOLDER_TEMPLATES: Record<string, { files: Record<string, string> }> = {
  "docs/": {
    files: {
      "docs/tone.md":
        "# Tone & Voice\n\nDescribe how this agent should communicate.\n",
    },
  },
  "docs/procedures/": {
    files: {
      "docs/procedures/README.md":
        "# Procedures\n\nStandard operating procedures for this agent.\n",
    },
  },
  "templates/": {
    files: {
      "templates/README.md": "# Templates\n\nReusable content templates.\n",
    },
  },
  "memory/": {
    files: {
      "memory/lessons.md":
        "# Lessons Learned\n\nThings this agent has learned across conversations.\n",
      "memory/preferences.md":
        "# Preferences\n\nDiscovered user and team preferences.\n",
      "memory/contacts.md": "# Contacts\n\nKey people and their roles.\n",
    },
  },
};

function isAgentOverride(source: ComposeSource | undefined): boolean {
  return source === "agent-override" || source === "agent-override-pinned";
}

export interface AgentBuilderShellProps {
  agentId: string;
  initialFolder?: string;
}

export function AgentBuilderShell({
  agentId,
  initialFolder,
}: AgentBuilderShellProps) {
  const [result] = useQuery({
    query: AgentDetailQuery,
    variables: { id: agentId },
  });
  const agent = result.data?.agent;
  const target = useMemo<Target>(() => ({ agentId }), [agentId]);

  const [files, setFiles] = useState<string[]>([]);
  const [fileSources, setFileSources] = useState<Record<string, ComposeSource>>(
    {},
  );
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [loadedFilesOnce, setLoadedFilesOnce] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [editValue, setEditValue] = useState("");
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [confirmingDeletePath, setConfirmingDeletePath] = useState<
    string | null
  >(null);
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [creatingFile, setCreatingFile] = useState(false);
  const [showNewSkillDialog, setShowNewSkillDialog] = useState(false);
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [newSkillTemplate, setNewSkillTemplate] =
    useState<SkillTemplateKey>("knowledge");
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillDescription, setNewSkillDescription] = useState("");
  const [newSkillCategory, setNewSkillCategory] = useState("custom");
  const [newSkillTags, setNewSkillTags] = useState("");
  const [acceptDialogPath, setAcceptDialogPath] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const loadRequestId = useRef(0);
  const fileListRequestId = useRef(0);
  const openFileRef = useRef<string | null>(null);
  const lastHandledInitialFolder = useRef<string | undefined>(undefined);

  useEffect(() => {
    openFileRef.current = openFile;
  }, [openFile]);

  const fetchFiles = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      const showLoading = options.showLoading ?? false;
      const requestId = fileListRequestId.current + 1;
      fileListRequestId.current = requestId;
      if (showLoading) setLoadingFiles(true);
      try {
        const data = await agentBuilderApi.listFiles(target);
        if (fileListRequestId.current !== requestId) return;
        setFiles(data.files.map((file) => file.path));
        const sources: Record<string, ComposeSource> = {};
        for (const file of data.files) sources[file.path] = file.source;
        setFileSources(sources);
      } catch (err) {
        if (fileListRequestId.current !== requestId) return;
        console.error("Failed to list workspace files:", err);
      } finally {
        if (fileListRequestId.current === requestId) {
          setLoadedFilesOnce(true);
          if (showLoading) setLoadingFiles(false);
        }
      }
    },
    [target],
  );

  const refreshFilesInBackground = useCallback(() => {
    void fetchFiles({ showLoading: false });
  }, [fetchFiles]);

  useEffect(() => {
    loadRequestId.current += 1;
    fileListRequestId.current += 1;
    lastHandledInitialFolder.current = undefined;
    setFiles([]);
    setFileSources({});
    setExpandedFolders(new Set());
    setOpenFile(null);
    setContent("");
    setEditValue("");
    setLoadingContent(false);
    setLoadingFiles(true);
    setLoadedFilesOnce(false);
  }, [agentId]);

  useEffect(() => {
    fetchFiles({ showLoading: true });
  }, [fetchFiles]);

  const tree = useMemo(() => buildWorkspaceTree(files), [files]);

  useEffect(() => {
    if (files.length === 0) return;
    const folders = new Set<string>();
    for (const file of files) {
      const parts = file.split("/");
      for (let i = 1; i < parts.length; i++) {
        folders.add(parts.slice(0, i).join("/"));
      }
    }
    setExpandedFolders(folders);
  }, [files]);

  const [pinStatusResult, refetchPinStatus] = useQuery({
    query: AgentPinStatusQuery,
    variables: { agentId },
  });

  const pinStatus = useMemo(() => {
    const out: Record<string, PinStatusEntry> = {};
    const list = (
      pinStatusResult.data as { agentPinStatus?: PinStatusEntry[] } | undefined
    )?.agentPinStatus;
    if (list) {
      for (const entry of list) out[entry.path] = entry;
    }
    return out;
  }, [pinStatusResult.data]);

  const openWorkspaceFile = useCallback(
    async (filePath: string) => {
      const requestId = loadRequestId.current + 1;
      loadRequestId.current = requestId;
      setOpenFile(filePath);
      setLoadingContent(true);
      try {
        const data = await agentBuilderApi.getFile(target, filePath);
        if (loadRequestId.current !== requestId) return;
        const fileContent = data.content ?? "";
        setContent(fileContent);
        setEditValue(fileContent);
      } catch (err) {
        if (loadRequestId.current !== requestId) return;
        console.error("Failed to load workspace file:", err);
        setContent("");
        setEditValue("");
      } finally {
        if (loadRequestId.current === requestId) {
          setLoadingContent(false);
        }
      }
    },
    [target],
  );

  useEffect(() => {
    if (
      !initialFolder ||
      files.length === 0 ||
      lastHandledInitialFolder.current === initialFolder
    ) {
      return;
    }
    const contextPath = `${initialFolder}/CONTEXT.md`;
    if (files.includes(contextPath)) {
      lastHandledInitialFolder.current = initialFolder;
      openWorkspaceFile(contextPath);
    }
  }, [initialFolder, files, openWorkspaceFile]);

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const defaults: Record<string, string> = {
        "SOUL.md":
          "# Soul\n\nEdit this file to define your agent's personality and values.\n",
        "IDENTITY.md":
          "# Identity\n\nEdit this file to define your agent's name and role.\n",
        "USER.md":
          "# User Context\n\nEdit this file to describe the users this agent works with.\n",
        "AGENTS.md": DEFAULT_AGENTS,
        "CONTEXT.md": DEFAULT_CONTEXT,
        "ROUTER.md": DEFAULT_ROUTER,
        "memory/lessons.md":
          "# Lessons Learned\n\nThings this agent has learned across conversations.\n",
        "memory/preferences.md":
          "# Preferences\n\nDiscovered user and team preferences.\n",
        "memory/contacts.md": "# Contacts\n\nKey people and their roles.\n",
      };
      for (const [path, fileContent] of Object.entries(defaults)) {
        await agentBuilderApi.putFile(target, path, fileContent);
      }
      await fetchFiles();
    } catch (err) {
      console.error("Failed to generate workspace files:", err);
    } finally {
      setGenerating(false);
    }
  };

  const handleAddFolder = async (folderKey: string) => {
    const template = FOLDER_TEMPLATES[folderKey];
    if (!template) return;
    for (const [path, fileContent] of Object.entries(template.files)) {
      await agentBuilderApi.putFile(target, path, fileContent);
    }
    await fetchFiles();
  };

  const handleCreateFile = async () => {
    if (!newFilePath.trim()) return;
    setCreatingFile(true);
    try {
      const path = newFilePath.trim();
      const fileContent = path.endsWith(".md")
        ? `# ${path.split("/").pop()?.replace(".md", "")}\n\n`
        : "";
      await agentBuilderApi.putFile(target, path, fileContent);
      await fetchFiles();
      setShowNewFileDialog(false);
      setNewFilePath("");
    } catch (err) {
      console.error("Failed to create file:", err);
    } finally {
      setCreatingFile(false);
    }
  };

  const resetNewSkillDialog = () => {
    setNewSkillTemplate("knowledge");
    setNewSkillName("");
    setNewSkillDescription("");
    setNewSkillCategory("custom");
    setNewSkillTags("");
  };

  const newSkillSlug = slugifySkillName(newSkillName);

  const handleCreateLocalSkill = async () => {
    if (!newSkillSlug) return;
    setCreatingSkill(true);
    const options = {
      template: newSkillTemplate,
      name: newSkillName,
      description: newSkillDescription,
      category: newSkillCategory,
      tags: newSkillTags,
    };
    const skillPath = buildLocalSkillPath(newSkillSlug);
    const skillContent = renderSkillTemplate(options);
    const failedExtraFiles: string[] = [];

    try {
      if (files.includes(skillPath)) {
        toast.error(`${skillPath} already exists`);
        return;
      }

      await agentBuilderApi.putFile(target, skillPath, skillContent);
      for (const [extraPath, extraContent] of Object.entries(
        renderSkillExtraFiles(options),
      )) {
        const localPath = buildLocalSkillPath(newSkillSlug, extraPath);
        try {
          await agentBuilderApi.putFile(target, localPath, extraContent);
        } catch (err) {
          console.error(
            `Failed to create local skill support file ${localPath}:`,
            err,
          );
          failedExtraFiles.push(localPath);
        }
      }

      setOpenFile(skillPath);
      setContent(skillContent);
      setEditValue(skillContent);
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        next.add("skills");
        next.add(`skills/${newSkillSlug}`);
        return next;
      });
      await fetchFiles();
      setShowNewSkillDialog(false);
      resetNewSkillDialog();

      if (failedExtraFiles.length > 0) {
        toast.warning(
          `Created SKILL.md, but ${failedExtraFiles.length} support file failed.`,
        );
      } else {
        toast.success(`Created local skill ${newSkillSlug}`);
      }
    } catch (err) {
      console.error("Failed to create local skill:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to create local skill",
      );
    } finally {
      setCreatingSkill(false);
    }
  };

  const handleSave = async () => {
    if (!openFile) return;
    const savedPath = openFile;
    const savedValue = editValue;
    setSaving(true);
    try {
      await agentBuilderApi.putFile(target, savedPath, savedValue);
      if (openFileRef.current === savedPath) {
        setContent(savedValue);
      }
      await fetchFiles();
    } catch (err) {
      console.error("Failed to save workspace file:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!openFile) return;
    await handleDeletePath(openFile, false);
  };

  const handleDeletePath = async (path: string, isFolder: boolean) => {
    const allPaths = isFolder
      ? files.filter((file) => file === path || file.startsWith(`${path}/`))
      : [path];
    const paths = allPaths.filter((filePath) =>
      isAgentOverride(fileSources[filePath]),
    );
    if (allPaths.length === 0) return;

    if (paths.length < allPaths.length) {
      const inheritedCount = allPaths.length - paths.length;
      if (!isFolder) {
        toast.info(
          "Inherited files stay visible until overridden; only agent overrides can be deleted.",
        );
        return;
      }
      if (paths.length > 0) {
        toast.info(
          `${inheritedCount} inherited file${inheritedCount === 1 ? "" : "s"} will remain visible.`,
        );
      }
    }
    if (paths.length === 0) return;

    setConfirmingDeletePath(null);
    setDeletingPath(path);
    try {
      for (const filePath of paths) {
        await agentBuilderApi.deleteFile(target, filePath);
      }
      setFiles((current) => current.filter((file) => !paths.includes(file)));
      setFileSources((current) => {
        const next = { ...current };
        for (const file of paths) delete next[file];
        return next;
      });
      if (openFile && paths.includes(openFile)) {
        setOpenFile(null);
        setContent("");
        setEditValue("");
      }
      refreshFilesInBackground();
    } catch (err) {
      console.error("Failed to delete workspace path:", err);
    } finally {
      setDeletingPath(null);
    }
  };

  const handleConfirmDelete = (path: string) => {
    setConfirmingDeletePath(path);
  };

  const handleCancelDeleteConfirm = (path: string) => {
    setConfirmingDeletePath((current) => (current === path ? null : current));
  };

  const handleAccepted = useCallback(async () => {
    const acceptedPath = acceptDialogPath;
    setAcceptDialogPath(null);
    refetchPinStatus({ requestPolicy: "network-only" });
    await fetchFiles();
    if (acceptedPath && openFileRef.current === acceptedPath) {
      await openWorkspaceFile(acceptedPath);
    }
  }, [acceptDialogPath, fetchFiles, openWorkspaceFile, refetchPinStatus]);

  const sourceFor = useCallback(
    (path: string) => fileSources[path],
    [fileSources],
  );
  const updateAvailableFor = useCallback(
    (path: string) => Boolean(pinStatus[path]?.updateAvailable),
    [pinStatus],
  );

  return (
    <PageLayout
      header={
        <div className="flex w-full items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight leading-tight text-foreground">
              Agent Builder
              {agent?.name ? (
                <span className="ml-2 font-medium text-muted-foreground">
                  : {agent.name}
                </span>
              ) : null}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuItem
                  className="whitespace-nowrap"
                  onClick={() => setShowNewSkillDialog(true)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  New Skill
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="whitespace-nowrap"
                  onClick={() => setShowNewFileDialog(true)}
                >
                  <FilePlus className="mr-2 h-4 w-4" />
                  New File
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="whitespace-nowrap"
                  onClick={() => handleAddFolder("docs/")}
                >
                  <FolderPlus className="mr-2 h-4 w-4" />
                  Add docs/ folder
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="whitespace-nowrap"
                  onClick={() => handleAddFolder("docs/procedures/")}
                >
                  <FolderPlus className="mr-2 h-4 w-4" />
                  Add procedures/ folder
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="whitespace-nowrap"
                  onClick={() => handleAddFolder("templates/")}
                >
                  <FolderPlus className="mr-2 h-4 w-4" />
                  Add templates/ folder
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="whitespace-nowrap"
                  onClick={() => handleAddFolder("memory/")}
                >
                  <FolderPlus className="mr-2 h-4 w-4" />
                  Add memory/ folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      }
    >
      {loadingFiles && !loadedFilesOnce ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Folder className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No workspace files yet.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={generating || loadingFiles}
          >
            {generating ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            Create Default Files
          </Button>
        </div>
      ) : (
        <div className="flex h-[calc(100vh-8rem)] min-h-[400px] rounded-md border">
          <div className="flex w-64 shrink-0 flex-col border-r">
            <Collapsible
              open={importOpen}
              onOpenChange={setImportOpen}
              className="border-b"
            >
              <div className="flex h-9 items-center justify-between bg-muted/50 px-3 text-xs font-medium text-muted-foreground">
                <span>{files.length} files</span>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Import bundle"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <ImportDropzone agentId={agentId} onImported={fetchFiles} />
              </CollapsibleContent>
            </Collapsible>
            <div className="flex-1 overflow-y-auto">
              <FolderTree
                nodes={tree}
                selectedPath={openFile}
                expandedFolders={expandedFolders}
                sourceFor={sourceFor}
                updateAvailableFor={updateAvailableFor}
                deletingPath={deletingPath}
                confirmingDeletePath={confirmingDeletePath}
                onSelect={openWorkspaceFile}
                onToggle={toggleFolder}
                onAcceptUpdate={setAcceptDialogPath}
                onDelete={handleDeletePath}
                onConfirmDelete={handleConfirmDelete}
                onCancelDeleteConfirm={handleCancelDeleteConfirm}
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <FileEditorPane
              openFile={openFile}
              content={content}
              value={editValue}
              loading={loadingContent}
              saving={saving}
              deleting={deletingPath === openFile}
              confirmingDelete={confirmingDeletePath === openFile}
              onChange={setEditValue}
              onSave={handleSave}
              onDiscard={() => setEditValue(content)}
              onDelete={handleDelete}
              onConfirmDelete={() => openFile && handleConfirmDelete(openFile)}
              onCancelDeleteConfirm={() =>
                openFile && handleCancelDeleteConfirm(openFile)
              }
            />
          </div>
        </div>
      )}

      <Dialog open={showNewFileDialog} onOpenChange={setShowNewFileDialog}>
        <DialogContent style={{ maxWidth: 440 }}>
          <DialogHeader>
            <DialogTitle>New File</DialogTitle>
            <DialogDescription>
              Enter the file path relative to workspace root.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              placeholder="e.g. docs/domain/products.md"
              value={newFilePath}
              onChange={(event) => setNewFilePath(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && handleCreateFile()}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowNewFileDialog(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreateFile}
                disabled={!newFilePath.trim() || creatingFile}
              >
                {creatingFile && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNewSkillDialog} onOpenChange={setShowNewSkillDialog}>
        <DialogContent style={{ maxWidth: 520 }}>
          <DialogHeader>
            <DialogTitle>New Local Skill</DialogTitle>
            <DialogDescription>
              Create a local skill under{" "}
              <code>skills/{newSkillSlug || "skill-slug"}/</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Template</Label>
              <Select
                value={newSkillTemplate}
                onValueChange={(value) =>
                  setNewSkillTemplate(value as SkillTemplateKey)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SKILL_AUTHORING_TEMPLATES).map(
                    ([key, template]) => (
                      <SelectItem key={key} value={key}>
                        {template.label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {SKILL_AUTHORING_TEMPLATES[newSkillTemplate].description}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input
                value={newSkillName}
                onChange={(event) => setNewSkillName(event.target.value)}
                placeholder="Approve Receipt"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Textarea
                value={newSkillDescription}
                onChange={(event) => setNewSkillDescription(event.target.value)}
                placeholder="What should this skill help the agent do?"
                rows={3}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Category</Label>
                <Select
                  value={newSkillCategory}
                  onValueChange={setNewSkillCategory}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SKILL_CATEGORIES.map((category) => (
                      <SelectItem key={category.value} value={category.value}>
                        {category.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Tags</Label>
                <Input
                  value={newSkillTags}
                  onChange={(event) => setNewSkillTags(event.target.value)}
                  placeholder="receipts, approval"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowNewSkillDialog(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreateLocalSkill}
                disabled={!newSkillSlug || creatingSkill}
              >
                {creatingSkill && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                Create Skill
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {acceptDialogPath && (
        <AcceptTemplateUpdateDialog
          open={Boolean(acceptDialogPath)}
          onOpenChange={(open) => {
            if (!open) setAcceptDialogPath(null);
          }}
          agentId={agentId}
          filename={acceptDialogPath}
          folderPath={pinStatus[acceptDialogPath]?.folderPath ?? null}
          pinnedContent={pinStatus[acceptDialogPath]?.pinnedContent ?? null}
          latestContent={pinStatus[acceptDialogPath]?.latestContent ?? null}
          onAccepted={handleAccepted}
        />
      )}
    </PageLayout>
  );
}
