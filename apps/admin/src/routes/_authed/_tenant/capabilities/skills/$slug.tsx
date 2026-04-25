import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Puzzle,
  Download,
  Trash2,
  Loader2,
  Tag,
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Eye,
  Code,
  ArrowUpCircle,
  PackageCheck,
  PackageX,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CodeMirror from "@uiw/react-codemirror";
import { markdown as markdownLang, markdownLanguage } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { yaml } from "@codemirror/lang-yaml";
import { languages } from "@codemirror/language-data";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { EditorView } from "@codemirror/view";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  getCatalogSkill,
  listCatalogFiles,
  getCatalogFile,
  listTenantSkills,
  listTenantSkillFiles,
  installSkill,
  uninstallSkill,
  upgradeSkill,
  checkUpgradeable,
  getTenantFile,
  saveTenantFile,
  createTenantFile,
  deleteTenantFile,
  type CatalogSkill,
  type InstalledSkill,
} from "@/lib/skills-api";

export const Route = createFileRoute("/_authed/_tenant/capabilities/skills/$slug")({
  component: SkillDetailPage,
});

// ---------------------------------------------------------------------------
// Tree data structure
// ---------------------------------------------------------------------------

type TreeNode = {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
};

function buildTree(files: string[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const filePath of files.sort()) {
    const parts = filePath.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const pathSoFar = parts.slice(0, i + 1).join("/");

      let existing = current.find((n) => n.name === part);
      if (!existing) {
        existing = {
          name: part,
          path: pathSoFar,
          isFolder: !isLast,
          children: [],
        };
        current.push(existing);
      }
      if (!isLast) {
        existing.isFolder = true;
        current = existing.children;
      }
    }
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.isFolder) sortNodes(n.children);
    }
    return nodes;
  };

  return sortNodes(root);
}

// ---------------------------------------------------------------------------
// Tree node component
// ---------------------------------------------------------------------------

function TreeItem({
  node,
  depth,
  selectedPath,
  expandedFolders,
  onSelect,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  expandedFolders: Set<string>;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = selectedPath === node.path;

  return (
    <>
      <div
        className={`flex items-center gap-1 px-2 py-1 text-sm cursor-pointer hover:bg-accent ${
          isSelected ? "bg-accent" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (node.isFolder) {
            onToggle(node.path);
          } else {
            onSelect(node.path);
          }
        }}
      >
        {node.isFolder ? (
          <>
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            {isExpanded ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <File className="h-4 w-4 shrink-0 text-muted-foreground" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {node.isFolder && isExpanded && (
        <>
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedFolders={expandedFolders}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
          {node.children.length === 0 && (
            <div
              className="text-xs text-muted-foreground italic px-2 py-1"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              Empty folder
            </div>
          )}
        </>
      )}
    </>
  );
}


// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

function SkillDetailPage() {
  const { slug } = Route.useParams();
  const { tenant } = useTenant();
  const tenantSlug = tenant?.slug;

  const [skill, setSkill] = useState<CatalogSkill | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [isInstalled, setIsInstalled] = useState(false);
  /** 'builtin' | 'catalog' | 'tenant' | null */
  const [skillSource, setSkillSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [editValue, setEditValue] = useState<string>("");
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [markdownPreview, setMarkdownPreview] = useState(false);
  const [upgradeInfo, setUpgradeInfo] = useState<{ upgradeable: boolean; latestVersion: string } | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [dependencies, setDependencies] = useState<{ slug: string; name: string; installed: boolean }[]>([]);

  useBreadcrumbs([
    { label: "Capabilities", href: "/capabilities" },
    { label: "Skills", href: "/capabilities/skills" },
    { label: skill?.name || slug },
  ]);

  // ---------------------------------------------------------------------------
  // Tree state
  // ---------------------------------------------------------------------------

  const tree = useMemo(() => buildTree(files), [files]);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Start with folders collapsed
    setExpandedFolders(new Set());
  }, [files]);

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setLoading(true);
    const installedPromise = tenantSlug
      ? listTenantSkills(tenantSlug)
      : Promise.resolve([] as InstalledSkill[]);
    Promise.all([
      getCatalogSkill(slug).catch(() => null),
      listCatalogFiles(slug).catch(() => [] as string[]),
      installedPromise,
    ])
      .then(async ([s, catalogFiles, inst]) => {
        const installed = inst.find((i) => i.slug === slug);
        setIsInstalled(!!installed);
        setSkillSource(installed?.source || null);

        // For tenant-created skills, the catalog may not have them
        if (s) setSkill(s);
        else if (installed) {
          setSkill({
            slug: installed.slug,
            name: installed.name,
            description: installed.description,
            category: installed.category,
            version: installed.version,
            icon: installed.icon,
            author: "tenant",
            tags: [],
            requires_env: [],
          } as CatalogSkill);
        }

        // Builtin skills always use catalog files. Catalog/tenant installed skills use tenant files.
        let fileList = catalogFiles;
        if (installed && tenantSlug && installed.source !== "builtin") {
          try {
            const tenantFiles = await listTenantSkillFiles(tenantSlug, slug);
            if (tenantFiles.length > 0) fileList = tenantFiles;
          } catch { /* fall back to catalog files */ }
        }
        setFiles(fileList);
        const defaultFile = fileList.find((p) => p === "SKILL.md") || fileList[0];
        if (defaultFile) setSelectedFile(defaultFile);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tenantSlug, slug]);

  // Check upgradeable status for installed catalog skills
  useEffect(() => {
    if (!tenantSlug || !isInstalled || skillSource === "tenant" || skillSource === "builtin") return;
    checkUpgradeable(tenantSlug, slug)
      .then((res) => setUpgradeInfo({ upgradeable: res.upgradeable, latestVersion: res.latestVersion }))
      .catch(() => setUpgradeInfo(null));
  }, [tenantSlug, slug, isInstalled, skillSource]);

  // Load dependencies from catalog entry
  useEffect(() => {
    if (!skill?.dependencies?.length) {
      setDependencies([]);
      return;
    }
    if (!tenantSlug) return;
    listTenantSkills(tenantSlug).then((inst) => {
      const installedSlugs = new Set(inst.map((s) => s.slug));
      Promise.all(
        skill.dependencies!.map((depSlug) =>
          getCatalogSkill(depSlug)
            .then((cat) => ({ slug: depSlug, name: cat.name, installed: installedSlugs.has(depSlug) }))
            .catch(() => ({ slug: depSlug, name: depSlug, installed: installedSlugs.has(depSlug) }))
        )
      ).then(setDependencies);
    });
  }, [tenantSlug, skill?.dependencies]);

  // Load file content
  // Builtin skills read from catalog (no tenant copy). Catalog/tenant skills read from tenant prefix.
  useEffect(() => {
    if (!tenantSlug || !selectedFile) return;
    setFileLoading(true);
    setMarkdownPreview(false);
    const usesTenantFiles = isInstalled && skillSource !== "builtin";
    const fetcher = usesTenantFiles ? getTenantFile : getCatalogFile;
    const args: [string, string, string] | [string, string] = usesTenantFiles
      ? [tenantSlug, slug, selectedFile]
      : [slug, selectedFile];
    (fetcher as any)(...args)
      .then((res: { content: string }) => {
        setFileContent(res.content);
        setEditValue(res.content);
      })
      .catch(console.error)
      .finally(() => setFileLoading(false));
  }, [tenantSlug, slug, selectedFile, isInstalled, skillSource]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleInstall = async () => {
    if (!tenantSlug) return;
    setInstalling(true);
    try {
      await installSkill(tenantSlug, slug);
      setIsInstalled(true);
    } finally {
      setInstalling(false);
    }
  };

  const handleUninstall = async () => {
    if (!tenantSlug) return;
    setUninstalling(true);
    try {
      await uninstallSkill(tenantSlug, slug);
      setIsInstalled(false);
    } finally {
      setUninstalling(false);
    }
  };

  const handleUpgrade = async (force = false) => {
    if (!tenantSlug) return;
    setUpgrading(true);
    try {
      const res = await upgradeSkill(tenantSlug, slug, force);
      if (res.hasCustomizations && !force) {
        // Show confirmation — handled via dialog state
        setUpgrading(false);
        return "has_customizations";
      }
      // Reload page to pick up new version
      window.location.reload();
    } catch (err) {
      console.error("Failed to upgrade skill:", err);
    } finally {
      setUpgrading(false);
    }
  };

  const handleSave = useCallback(async () => {
    if (!tenantSlug || !selectedFile) return;
    setSaving(true);
    try {
      await saveTenantFile(tenantSlug, slug, selectedFile, editValue);
      setFileContent(editValue);
    } catch (err) {
      console.error("Failed to save file:", err);
    } finally {
      setSaving(false);
    }
  }, [tenantSlug, slug, selectedFile, editValue]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) return <PageSkeleton />;
  if (!skill) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>Skill not found.</p>
        <Link to="/capabilities/skills" className="text-sm underline mt-2 inline-block">
          Back to Skills
        </Link>
      </div>
    );
  }

  const isMarkdown = selectedFile?.endsWith(".md") ?? false;
  const isPython = selectedFile?.endsWith(".py") ?? false;
  const isYaml = selectedFile?.endsWith(".yaml") || selectedFile?.endsWith(".yml") || false;
  const fileName = selectedFile?.split("/").pop() ?? selectedFile;
  // Built-in skills are read-only. Catalog/tenant installed skills are editable.
  const isEditable = isInstalled && skillSource !== "builtin";
  const isTenantSkill = skillSource === "tenant";
  const isBuiltin = skillSource === "builtin";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-start justify-between pb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-semibold">{skill.name}</h1>
            <p className="text-sm text-muted-foreground">{skill.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Upgrade button — only for installed catalog skills with available update */}
          {isInstalled && skillSource !== "tenant" && skillSource !== "builtin" && upgradeInfo?.upgradeable && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={upgrading}>
                  {upgrading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <ArrowUpCircle className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Update to v{upgradeInfo.latestVersion}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Update {skill.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will update from v{skill.version} to v{upgradeInfo.latestVersion}. Your customizations will be reset to the new catalog defaults.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleUpgrade(true)}>
                    Update
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {isInstalled && !isBuiltin ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={uninstalling}>
                  {uninstalling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Uninstall
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Uninstall {skill.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove the skill and any customizations from your tenant. Agents using this skill will no longer have access to it.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleUninstall}>
                    Uninstall
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button size="sm" onClick={handleInstall} disabled={installing}>
              {installing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Download className="h-3.5 w-3.5 mr-1.5" />
              )}
              Install
            </Button>
          )}
        </div>
      </div>

      {/* Meta badges */}
      <div className="flex items-center gap-2 flex-wrap pb-4 shrink-0">
        {isBuiltin && <Badge variant="secondary">Built-in</Badge>}
        {skillSource === "catalog" && <Badge variant="outline">Catalog</Badge>}
        {isTenantSkill && <Badge variant="outline" className="border-primary text-primary">Custom</Badge>}
        <Badge variant="outline">{skill.category}</Badge>
        <Badge variant="secondary">v{skill.version}</Badge>
        {skill.tags?.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1">
            <Tag className="h-2.5 w-2.5" />
            {tag}
          </Badge>
        ))}
        {isBuiltin && (
          <Badge variant="secondary" className="text-muted-foreground">Read-only</Badge>
        )}
      </div>

      {/* Dependencies section */}
      {dependencies.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap pb-3 shrink-0">
          <span className="text-xs font-medium text-muted-foreground mr-1">Dependencies:</span>
          {dependencies.map((dep) => (
            <Link key={dep.slug} to="/capabilities/skills/$slug" params={{ slug: dep.slug }}>
              <Badge
                variant="outline"
                className={`gap-1 text-[10px] cursor-pointer hover:bg-accent ${
                  dep.installed
                    ? "border-green-500/30 text-green-500"
                    : "border-red-500/30 text-red-500"
                }`}
              >
                {dep.installed ? (
                  <PackageCheck className="h-2.5 w-2.5" />
                ) : (
                  <PackageX className="h-2.5 w-2.5" />
                )}
                {dep.name}
                {dep.installed ? " (installed)" : " (missing)"}
              </Badge>
            </Link>
          ))}
        </div>
      )}

      {/* VS Code split-pane: file tree + editor */}
      <div className="flex border rounded-md flex-1 min-h-0">
        {/* File tree sidebar */}
        <div className="w-56 shrink-0 border-r flex flex-col">
          <div className="h-9 px-3 flex items-center justify-between text-xs font-medium text-muted-foreground bg-muted/50 border-b">
            <span>{files.length} files</span>
            {isTenantSkill && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5"
                onClick={() => setShowNewFile(true)}
              >
                + Add
              </Button>
            )}
          </div>
          {showNewFile && (
            <div className="px-2 py-1.5 border-b bg-muted/30 flex gap-1">
              <input
                autoFocus
                className="flex-1 text-xs px-1.5 py-0.5 rounded bg-background border text-foreground"
                placeholder="path/to/file.md"
                value={newFilePath}
                onChange={(e) => setNewFilePath(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Enter" && newFilePath.trim() && tenantSlug) {
                    await createTenantFile(tenantSlug, slug, newFilePath.trim(), "");
                    setFiles((prev) => [...prev, newFilePath.trim()]);
                    setSelectedFile(newFilePath.trim());
                    setShowNewFile(false);
                    setNewFilePath("");
                  }
                  if (e.key === "Escape") {
                    setShowNewFile(false);
                    setNewFilePath("");
                  }
                }}
              />
            </div>
          )}
          <div className="flex-1 overflow-y-auto py-1">
            {tree.map((node) => (
              <TreeItem
                key={node.path}
                node={node}
                depth={0}
                selectedPath={selectedFile}
                expandedFolders={expandedFolders}
                onSelect={setSelectedFile}
                onToggle={toggleFolder}
              />
            ))}
          </div>
        </div>

        {/* Editor pane */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedFile ? (
            <>
              {/* Toolbar */}
              <div className="h-9 px-3 border-b bg-muted/50 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-xs font-medium truncate">{fileName}</span>
                  {selectedFile.includes("/") && (
                    <span className="text-[10px] text-muted-foreground truncate">{selectedFile}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isMarkdown && !fileLoading && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] px-2 text-muted-foreground"
                      onClick={() => setMarkdownPreview(!markdownPreview)}
                    >
                      {markdownPreview ? (
                        <>
                          <Code className="h-3 w-3 mr-1" />
                          Raw
                        </>
                      ) : (
                        <>
                          <Eye className="h-3 w-3 mr-1" />
                          Preview
                        </>
                      )}
                    </Button>
                  )}
                  {isTenantSkill && selectedFile && selectedFile !== "SKILL.md" && !fileLoading && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] px-2 text-destructive"
                      onClick={async () => {
                        if (!tenantSlug || !selectedFile) return;
                        await deleteTenantFile(tenantSlug, slug, selectedFile);
                        setFiles((prev) => prev.filter((f) => f !== selectedFile));
                        setSelectedFile(files.find((f) => f === "SKILL.md") || files[0] || null);
                      }}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete
                    </Button>
                  )}
                  {isEditable && !fileLoading && !markdownPreview && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] px-2 text-muted-foreground"
                        onClick={() => setEditValue(fileContent)}
                        disabled={saving || editValue === fileContent}
                      >
                        Discard
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 text-[11px] px-2"
                        onClick={handleSave}
                        disabled={saving || editValue === fileContent}
                      >
                        {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                        Save
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Content area */}
              <div className="flex-1 min-h-0 overflow-hidden bg-black [&>div]:h-full">
                {fileLoading ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                  </div>
                ) : isMarkdown && markdownPreview ? (
                  <div className="h-full overflow-y-auto p-5 bg-background">
                    <div className="prose prose-sm prose-invert max-w-none [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:break-words [&_table]:table-fixed [&_table]:w-full">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{fileContent}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <CodeMirror
                    value={isEditable ? editValue : fileContent}
                    onChange={isEditable ? (val) => setEditValue(val) : undefined}
                    readOnly={!isEditable}
                    height="100%"
                    theme={vscodeDark}
                    extensions={[
                      isPython ? python() : isYaml ? yaml() : markdownLang({ base: markdownLanguage, codeLanguages: languages }),
                      EditorView.lineWrapping,
                    ]}
                    style={{ fontSize: "14px", backgroundColor: "black" }}
                    className="[&_.cm-editor]:!bg-black [&_.cm-gutters]:!bg-black [&_.cm-activeLine]:!bg-transparent [&_.cm-activeLineGutter]:!bg-transparent"
                    basicSetup={{
                      lineNumbers: true,
                      foldGutter: true,
                      highlightActiveLine: false,
                      bracketMatching: true,
                    }}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Select a file
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
