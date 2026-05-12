import { gql, useQuery } from "urql";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  FilePlus,
  Folder,
  FolderPlus,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Upload,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { AcceptTemplateUpdateDialog } from "@/components/AcceptTemplateUpdateDialog";
import { useTenant } from "@/context/TenantContext";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  agentBuilderApi,
  type ComposeSource,
  type Target,
} from "@/lib/agent-builder-api";
import {
  installSkillToAgent,
  installSkillToTemplate,
  filterCatalogSkills,
  listCatalog,
  type CatalogSkillFilter,
  type CatalogSkill,
} from "@/lib/skills-api";
import { cn } from "@/lib/utils";
import {
  SKILL_AUTHORING_TEMPLATES,
  SKILL_CATEGORIES,
  buildLocalSkillPath,
  renderSkillExtraFiles,
  renderSkillTemplate,
  slugifySkillName,
  type SkillTemplateKey,
} from "@/lib/skill-authoring-templates";
import { AddSubAgentDialog } from "./AddSubAgentDialog";
import { FileEditorPane } from "./FileEditorPane";
import {
  FolderTree,
  buildWorkspaceTree,
  subAgentsNodePath,
} from "./FolderTree";
import { ImportDropzone } from "./ImportDropzone";
import { parseRoutingTable, type RoutingRow } from "./routing-table";
import {
  AGENT_BUILDER_SNIPPETS,
  STARTER_AGENT_TEMPLATES,
  type SnippetDefinition,
} from "./snippets";

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

export type WorkspaceEditorMode =
  | "agent"
  | "template"
  | "computer"
  | "defaults";

export type WorkspaceEditorAction =
  | "add-sub-agent"
  | "new-skill"
  | "add-catalog-skill"
  | "new-file"
  | "add-docs-folder"
  | "add-procedures-folder"
  | "add-templates-folder"
  | "add-memory-folder"
  | "import-bundle"
  | "bootstrap";

export interface WorkspaceEditorCapabilities {
  canImportBundle: boolean;
  canReviewTemplateUpdates: boolean;
  canAddSubAgent: boolean;
  canCreateLocalSkill: boolean;
  canAddCatalogSkill: boolean;
  canBootstrapDefaults: boolean;
}

export function workspaceEditorCapabilities(
  mode: WorkspaceEditorMode,
): WorkspaceEditorCapabilities {
  if (mode === "computer") {
    return {
      canImportBundle: false,
      canReviewTemplateUpdates: false,
      canAddSubAgent: false,
      canCreateLocalSkill: true,
      canAddCatalogSkill: false,
      canBootstrapDefaults: false,
    };
  }

  return {
    canImportBundle: mode === "agent",
    canReviewTemplateUpdates: mode === "agent",
    canAddSubAgent: mode !== "defaults",
    canCreateLocalSkill: mode !== "defaults",
    canAddCatalogSkill: mode !== "defaults",
    canBootstrapDefaults: mode !== "template",
  };
}

export function workspaceEditorActions(
  mode: WorkspaceEditorMode,
): WorkspaceEditorAction[] {
  const capabilities = workspaceEditorCapabilities(mode);
  return [
    ...(capabilities.canAddSubAgent ? (["add-sub-agent"] as const) : []),
    ...(capabilities.canCreateLocalSkill ? (["new-skill"] as const) : []),
    ...(capabilities.canAddCatalogSkill
      ? (["add-catalog-skill"] as const)
      : []),
    "new-file",
    "add-docs-folder",
    "add-procedures-folder",
    "add-templates-folder",
    "add-memory-folder",
    ...(capabilities.canImportBundle ? (["import-bundle"] as const) : []),
    ...(capabilities.canBootstrapDefaults ? (["bootstrap"] as const) : []),
  ];
}

export interface WorkspaceEditorProps {
  target: Target;
  mode: WorkspaceEditorMode;
  agentId?: string;
  agentSlug?: string;
  templateSlug?: string;
  initialFolder?: string;
  bootstrapFiles?: Record<string, string>;
  bootstrapLabel?: string;
  preferRunbookSkills?: boolean;
  className?: string;
}

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

export const AGENT_WORKSPACE_DEFAULT_FILES: Record<string, string> = {
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

export function workspaceEditorTargetKey(target: Target): string {
  if ("agentId" in target) return `agent:${target.agentId}`;
  if ("templateId" in target) return `template:${target.templateId}`;
  if ("computerId" in target) return `computer:${target.computerId}`;
  return "defaults";
}

export function WorkspaceEditor({
  target,
  mode,
  agentId,
  agentSlug,
  templateSlug,
  initialFolder,
  bootstrapFiles,
  bootstrapLabel = "Create Default Files",
  preferRunbookSkills = false,
  className,
}: WorkspaceEditorProps) {
  const { tenant } = useTenant();
  const capabilities = workspaceEditorCapabilities(mode);
  const key = workspaceEditorTargetKey(target);
  const stableTarget = useMemo(() => target, [key]);
  const defaultSkillTemplate: SkillTemplateKey = preferRunbookSkills
    ? "runbook"
    : "knowledge";
  const defaultSkillCategory = preferRunbookSkills ? "artifact" : "custom";
  const defaultCatalogSkillFilter: CatalogSkillFilter = preferRunbookSkills
    ? "runbooks"
    : "all";
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
  const [showAddSubAgentDialog, setShowAddSubAgentDialog] = useState(false);
  const [creatingSubAgent, setCreatingSubAgent] = useState(false);
  const [subAgentCreateError, setSubAgentCreateError] = useState<string | null>(
    null,
  );
  const [routingRows, setRoutingRows] = useState<RoutingRow[]>([]);
  const [showNewSkillDialog, setShowNewSkillDialog] = useState(false);
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [showCatalogSkillDialog, setShowCatalogSkillDialog] = useState(false);
  const [catalogSkills, setCatalogSkills] = useState<CatalogSkill[]>([]);
  const [loadingCatalogSkills, setLoadingCatalogSkills] = useState(false);
  const [installingCatalogSkill, setInstallingCatalogSkill] = useState<
    string | null
  >(null);
  const [catalogInstallError, setCatalogInstallError] = useState<string | null>(
    null,
  );
  const [newSkillTemplate, setNewSkillTemplate] =
    useState<SkillTemplateKey>(defaultSkillTemplate);
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillDescription, setNewSkillDescription] = useState("");
  const [newSkillCategory, setNewSkillCategory] =
    useState(defaultSkillCategory);
  const [newSkillTags, setNewSkillTags] = useState("");
  const [catalogSkillFilter, setCatalogSkillFilter] =
    useState<CatalogSkillFilter>(defaultCatalogSkillFilter);
  const [acceptDialogPath, setAcceptDialogPath] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
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
        const data = await agentBuilderApi.listFiles(stableTarget);
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
    [stableTarget],
  );

  const refreshFilesInBackground = useCallback(() => {
    void fetchFiles({ showLoading: false });
  }, [fetchFiles]);

  useEffect(() => {
    if (!files.includes("AGENTS.md")) {
      setRoutingRows([]);
      return;
    }
    let cancelled = false;
    agentBuilderApi
      .getFile(stableTarget, "AGENTS.md")
      .then((data) => {
        if (cancelled) return;
        const parsed = parseRoutingTable(data.content ?? "");
        setRoutingRows(parsed.warning ? [] : parsed.rows);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to parse AGENTS.md routing rows:", err);
        setRoutingRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [files, stableTarget]);

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
    setRoutingRows([]);
    setShowAddSubAgentDialog(false);
    setSubAgentCreateError(null);
    setShowCatalogSkillDialog(false);
    setCatalogInstallError(null);
    setCatalogSkillFilter(defaultCatalogSkillFilter);
    setNewSkillTemplate(defaultSkillTemplate);
    setNewSkillCategory(defaultSkillCategory);
    setNewSkillName("");
    setNewSkillDescription("");
    setNewSkillTags("");
  }, [
    key,
    defaultCatalogSkillFilter,
    defaultSkillCategory,
    defaultSkillTemplate,
  ]);

  useEffect(() => {
    fetchFiles({ showLoading: true });
  }, [fetchFiles]);

  const tree = useMemo(
    () => buildWorkspaceTree(files, routingRows),
    [files, routingRows],
  );

  const installedWorkspaceSkillSlugs = useMemo(
    () =>
      new Set(
        files
          .map((path) => path.match(/(?:^|\/)skills\/([^/]+)\/SKILL\.md$/)?.[1])
          .filter((slug): slug is string => Boolean(slug)),
      ),
    [files],
  );

  const uninstalledCatalogSkills = useMemo(
    () =>
      catalogSkills.filter(
        (skill) => !installedWorkspaceSkillSlugs.has(skill.slug),
      ),
    [catalogSkills, installedWorkspaceSkillSlugs],
  );

  const availableCatalogSkills = useMemo(
    () => filterCatalogSkills(uninstalledCatalogSkills, catalogSkillFilter),
    [catalogSkillFilter, uninstalledCatalogSkills],
  );

  useEffect(() => {
    if (!showCatalogSkillDialog || catalogSkills.length > 0) return;
    let cancelled = false;
    setLoadingCatalogSkills(true);
    listCatalog()
      .then((items) => {
        if (!cancelled) setCatalogSkills(items);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load skill catalog:", err);
        setCatalogInstallError(
          err instanceof Error ? err.message : "Failed to load skill catalog",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingCatalogSkills(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showCatalogSkillDialog, catalogSkills.length]);

  const [pinStatusResult, refetchPinStatus] = useQuery({
    query: AgentPinStatusQuery,
    variables: { agentId: agentId ?? "" },
    pause: !capabilities.canReviewTemplateUpdates || !agentId,
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
      const previousOpenFile = openFileRef.current;
      setOpenFile(filePath);
      setLoadingContent(true);
      if (previousOpenFile !== filePath) {
        setContent("");
        setEditValue("");
      }
      try {
        const data = await agentBuilderApi.getFile(stableTarget, filePath);
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
    [stableTarget],
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
    if (!bootstrapFiles) return;
    setGenerating(true);
    try {
      for (const [path, fileContent] of Object.entries(bootstrapFiles)) {
        await agentBuilderApi.putFile(stableTarget, path, fileContent);
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
      await agentBuilderApi.putFile(stableTarget, path, fileContent);
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
      await agentBuilderApi.putFile(stableTarget, path, fileContent);
      await fetchFiles();
      await openWorkspaceFile(path);
      setShowNewFileDialog(false);
      setNewFilePath("");
    } catch (err) {
      console.error("Failed to create file:", err);
    } finally {
      setCreatingFile(false);
    }
  };

  const handleAddSubAgent = async (input: {
    slug: string;
    contextContent: string;
  }) => {
    setCreatingSubAgent(true);
    setSubAgentCreateError(null);
    try {
      if (mode === "agent" && agentId) {
        await agentBuilderApi.createSubAgent(
          agentId,
          input.slug,
          input.contextContent,
        );
      } else {
        await agentBuilderApi.putFile(
          stableTarget,
          `${input.slug}/CONTEXT.md`,
          input.contextContent,
        );
      }
      await fetchFiles();
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        next.add(subAgentsNodePath());
        next.add(input.slug);
        return next;
      });
      setShowAddSubAgentDialog(false);
      toast.success(`Created sub-agent ${input.slug}`);
      await openWorkspaceFile(`${input.slug}/CONTEXT.md`);
    } catch (err) {
      console.error("Failed to create sub-agent:", err);
      const message =
        err instanceof Error ? err.message : "Failed to create sub-agent";
      setSubAgentCreateError(message);
      toast.error(message);
    } finally {
      setCreatingSubAgent(false);
    }
  };

  const resetNewSkillDialog = useCallback(() => {
    setNewSkillTemplate(defaultSkillTemplate);
    setNewSkillName("");
    setNewSkillDescription("");
    setNewSkillCategory(defaultSkillCategory);
    setNewSkillTags("");
  }, [defaultSkillCategory, defaultSkillTemplate]);

  const openNewSkillDialog = useCallback(() => {
    resetNewSkillDialog();
    setShowNewSkillDialog(true);
  }, [resetNewSkillDialog]);

  const openCatalogSkillDialog = useCallback(
    (filter: CatalogSkillFilter = defaultCatalogSkillFilter) => {
      setCatalogSkillFilter(filter);
      setCatalogInstallError(null);
      setShowCatalogSkillDialog(true);
    },
    [defaultCatalogSkillFilter],
  );

  const handleNewSkillTemplateChange = (template: SkillTemplateKey) => {
    setNewSkillTemplate(template);
    if (template === "runbook") {
      setNewSkillCategory("artifact");
    }
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

      await agentBuilderApi.putFile(stableTarget, skillPath, skillContent);
      for (const [extraPath, extraContent] of Object.entries(
        renderSkillExtraFiles(options),
      )) {
        const localPath = buildLocalSkillPath(newSkillSlug, extraPath);
        try {
          await agentBuilderApi.putFile(stableTarget, localPath, extraContent);
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

  const handleInstallCatalogSkill = async (skillSlug: string) => {
    if (!tenant?.slug) {
      setCatalogInstallError("Tenant slug is unavailable.");
      return;
    }
    if (files.includes(`skills/${skillSlug}/SKILL.md`)) {
      setCatalogInstallError(
        "This skill already exists in the workspace. Delete it before reinstalling.",
      );
      return;
    }
    setInstallingCatalogSkill(skillSlug);
    setCatalogInstallError(null);
    try {
      if (mode === "agent" && agentSlug) {
        await installSkillToAgent(tenant.slug, agentSlug, skillSlug);
      } else if (mode === "template" && templateSlug) {
        await installSkillToTemplate(tenant.slug, templateSlug, skillSlug);
      } else {
        throw new Error("Workspace target slug is unavailable.");
      }
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        next.add("skills");
        next.add(`skills/${skillSlug}`);
        return next;
      });
      await fetchFiles();
      setShowCatalogSkillDialog(false);
      toast.success(`Installed ${skillSlug}`);
    } catch (err) {
      console.error("Failed to install catalog skill:", err);
      setCatalogInstallError(
        err instanceof Error ? err.message : "Failed to install skill",
      );
    } finally {
      setInstallingCatalogSkill(null);
    }
  };

  const handleSave = async () => {
    if (!openFile) return;
    const savedPath = openFile;
    const savedValue = editValue;
    setSaving(true);
    try {
      await agentBuilderApi.putFile(stableTarget, savedPath, savedValue);
      if (openFileRef.current === savedPath) {
        setContent(savedValue);
        setEditValue(savedValue);
      }
      await fetchFiles({ showLoading: false });
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
    const paths =
      mode === "agent"
        ? allPaths.filter((filePath) => isAgentOverride(fileSources[filePath]))
        : allPaths;
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
        await agentBuilderApi.deleteFile(stableTarget, filePath);
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
    (path: string) =>
      capabilities.canReviewTemplateUpdates &&
      Boolean(pinStatus[path]?.updateAvailable),
    [capabilities.canReviewTemplateUpdates, pinStatus],
  );

  const canUseSnippets = Boolean(openFile) && !loadingContent;
  const insertSnippet = (snippet: SnippetDefinition) => {
    setEditValue((current) => {
      const separator = current.endsWith("\n") ? "" : "\n";
      return `${current}${separator}${snippet.content}`;
    });
  };
  const applyStarter = (snippet: SnippetDefinition) => {
    if (
      editValue.trim().length > 0 &&
      !confirm(`Replace the current editor buffer with "${snippet.name}"?`)
    ) {
      return;
    }
    setEditValue(snippet.content);
  };

  const showBootstrap = Boolean(bootstrapFiles);
  const addMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Workspace actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuItem
          className="whitespace-nowrap"
          onClick={() => setShowNewFileDialog(true)}
        >
          <FilePlus className="mr-2 h-4 w-4" />
          New File
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {capabilities.canAddSubAgent ? (
          <DropdownMenuItem
            className="whitespace-nowrap"
            onClick={() => {
              setSubAgentCreateError(null);
              setShowAddSubAgentDialog(true);
            }}
          >
            <Bot className="mr-2 h-4 w-4" />
            Add Sub-agent
          </DropdownMenuItem>
        ) : null}
        {capabilities.canCreateLocalSkill ? (
          <DropdownMenuItem
            className="whitespace-nowrap"
            onClick={openNewSkillDialog}
          >
            {preferRunbookSkills ? (
              <ListChecks className="mr-2 h-4 w-4" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            {preferRunbookSkills ? "New Runbook Skill" : "New Skill"}
          </DropdownMenuItem>
        ) : null}
        {capabilities.canAddCatalogSkill ? (
          <DropdownMenuItem
            className="whitespace-nowrap"
            onClick={() => openCatalogSkillDialog()}
          >
            {preferRunbookSkills ? (
              <ListChecks className="mr-2 h-4 w-4" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            {preferRunbookSkills ? "Add Runbook Skill" : "Add from catalog"}
          </DropdownMenuItem>
        ) : null}
        {(capabilities.canAddSubAgent ||
          capabilities.canCreateLocalSkill ||
          capabilities.canAddCatalogSkill) && <DropdownMenuSeparator />}
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
        <DropdownMenuSeparator />
        <DropdownMenuSub open={snippetsOpen} onOpenChange={setSnippetsOpen}>
          <DropdownMenuSubTrigger
            onFocus={() => setSnippetsOpen(true)}
            onPointerEnter={() => setSnippetsOpen(true)}
          >
            <Wand2 className="mr-2 h-4 w-4" />
            Snippets
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            className="w-72"
            sideOffset={8}
            onPointerEnter={() => setSnippetsOpen(true)}
          >
            <DropdownMenuLabel>Insert snippet</DropdownMenuLabel>
            {AGENT_BUILDER_SNIPPETS.map((snippet) => (
              <DropdownMenuItem
                key={snippet.id}
                className="flex flex-col items-start gap-0.5"
                disabled={!canUseSnippets}
                onClick={() => insertSnippet(snippet)}
              >
                <span>{snippet.name}</span>
                <span className="text-xs text-muted-foreground">
                  {snippet.description}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Starter content</DropdownMenuLabel>
            {STARTER_AGENT_TEMPLATES.map((snippet) => (
              <DropdownMenuItem
                key={snippet.id}
                className="flex flex-col items-start gap-0.5"
                disabled={!canUseSnippets}
                onClick={() => applyStarter(snippet)}
              >
                <span>{snippet.name}</span>
                <span className="text-xs text-muted-foreground">
                  {snippet.description}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {capabilities.canImportBundle && agentId ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="whitespace-nowrap"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="mr-2 h-4 w-4" />
              Import bundle
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      {loadingFiles && !loadedFilesOnce ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : (
        <div
          className={cn(
            "flex h-full min-h-[400px] rounded-md border",
            className,
          )}
        >
          <div className="flex w-64 shrink-0 flex-col border-r">
            <Collapsible
              open={capabilities.canImportBundle && importOpen}
              onOpenChange={setImportOpen}
              className="border-b"
            >
              <div className="flex h-9 items-center justify-between bg-muted/50 px-3 text-xs font-medium text-muted-foreground">
                <span>{files.length} files</span>
                <div className="flex items-center gap-1.5">{addMenu}</div>
              </div>
              {capabilities.canImportBundle && agentId ? (
                <CollapsibleContent>
                  <ImportDropzone agentId={agentId} onImported={fetchFiles} />
                </CollapsibleContent>
              ) : null}
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
                onAcceptUpdate={
                  capabilities.canReviewTemplateUpdates
                    ? setAcceptDialogPath
                    : () => {}
                }
                onDelete={handleDeletePath}
                onConfirmDelete={handleConfirmDelete}
                onCancelDeleteConfirm={handleCancelDeleteConfirm}
                onCreateSkill={openNewSkillDialog}
                onAddSkillFromCatalog={() => openCatalogSkillDialog()}
                preferRunbookSkills={preferRunbookSkills}
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {files.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <Folder className="h-12 w-12 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  No workspace files yet.
                </p>
                {showBootstrap ? (
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
                    {bootstrapLabel}
                  </Button>
                ) : null}
              </div>
            ) : (
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
                onConfirmDelete={() =>
                  openFile && handleConfirmDelete(openFile)
                }
                onCancelDeleteConfirm={() =>
                  openFile && handleCancelDeleteConfirm(openFile)
                }
              />
            )}
          </div>
        </div>
      )}

      {capabilities.canAddSubAgent ? (
        <AddSubAgentDialog
          open={showAddSubAgentDialog}
          files={files}
          creating={creatingSubAgent}
          serverError={subAgentCreateError}
          onOpenChange={(open) => {
            setShowAddSubAgentDialog(open);
            if (open) setSubAgentCreateError(null);
          }}
          onSubmit={handleAddSubAgent}
        />
      ) : null}

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

      {capabilities.canAddCatalogSkill ? (
        <Dialog
          open={showCatalogSkillDialog}
          onOpenChange={(open) => {
            setShowCatalogSkillDialog(open);
            if (open) setCatalogInstallError(null);
          }}
        >
          <DialogContent style={{ maxWidth: 520 }}>
            <DialogHeader>
              <DialogTitle>
                {catalogSkillFilter === "runbooks"
                  ? "Add Runbook Skill"
                  : "Add from catalog"}
              </DialogTitle>
              <DialogDescription>
                Install a catalog skill into this workspace. Runbook skills are
                activated by their folder under <code>skills/</code>.
              </DialogDescription>
            </DialogHeader>
            {catalogInstallError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {catalogInstallError}
              </div>
            ) : null}
            <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-1">
              <Button
                type="button"
                variant={catalogSkillFilter === "all" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 flex-1"
                onClick={() => setCatalogSkillFilter("all")}
              >
                All skills
              </Button>
              <Button
                type="button"
                variant={
                  catalogSkillFilter === "runbooks" ? "secondary" : "ghost"
                }
                size="sm"
                className="h-7 flex-1"
                onClick={() => setCatalogSkillFilter("runbooks")}
              >
                Runbook skills
              </Button>
            </div>
            <div className="-mx-2 max-h-[420px] overflow-y-auto">
              {loadingCatalogSkills ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading catalog...
                </div>
              ) : availableCatalogSkills.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {catalogSkillFilter === "runbooks"
                    ? "All runbook skills are already installed."
                    : "All catalog skills are already installed."}
                </p>
              ) : (
                availableCatalogSkills.map((skill) => (
                  <button
                    key={skill.slug}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
                    disabled={Boolean(installingCatalogSkill)}
                    onClick={() => handleInstallCatalogSkill(skill.slug)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {skill.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {skill.description}
                      </span>
                    </span>
                    {installingCatalogSkill === skill.slug ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {capabilities.canCreateLocalSkill ? (
        <Dialog open={showNewSkillDialog} onOpenChange={setShowNewSkillDialog}>
          <DialogContent style={{ maxWidth: 520 }}>
            <DialogHeader>
              <DialogTitle>
                {newSkillTemplate === "runbook"
                  ? "New Runbook Skill"
                  : "New Local Skill"}
              </DialogTitle>
              <DialogDescription>
                Create a local skill under{" "}
                <code>skills/{newSkillSlug || "skill-slug"}/</code>. Runbook
                skills use standard Agent Skill files plus a reference contract.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label>Template</Label>
                <Select
                  value={newSkillTemplate}
                  onValueChange={(value) =>
                    handleNewSkillTemplateChange(value as SkillTemplateKey)
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
                  onChange={(event) =>
                    setNewSkillDescription(event.target.value)
                  }
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
      ) : null}

      {acceptDialogPath && agentId && (
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
    </>
  );
}
