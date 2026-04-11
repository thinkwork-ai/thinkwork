import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Search, Check, Download, Loader2, Plus, Upload, FileText, X } from "lucide-react";
import { toast } from "sonner";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listCatalog,
  listTenantSkills,
  installSkill,
  checkUpgradeable,
  createTenantSkill,
  createTenantFile,
  type CatalogSkill,
  type InstalledSkill,
} from "@/lib/skills-api";

export const Route = createFileRoute("/_authed/_tenant/skills/")({
  component: SkillsPage,
});

type SkillRow = CatalogSkill & { installed: boolean; installedSource?: string };

function SkillsPage() {
  const { tenant } = useTenant();
  const tenantSlug = tenant?.slug;
  const navigate = useNavigate();
  useBreadcrumbs([{ label: "Skills Catalog" }]);

  const [catalog, setCatalog] = useState<CatalogSkill[]>([]);
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [tab, setTab] = useState("all");
  const [upgradeMap, setUpgradeMap] = useState<Map<string, { upgradeable: boolean; latestVersion: string }>>(new Map());

  // Fetch catalog (no tenant dependency) + tenant installs (when slug ready)
  useEffect(() => {
    setLoading(true);
    const catalogPromise = listCatalog();
    const installedPromise = tenantSlug
      ? listTenantSkills(tenantSlug)
      : Promise.resolve([] as InstalledSkill[]);

    Promise.all([catalogPromise, installedPromise])
      .then(([cat, inst]) => {
        setCatalog(cat);
        setInstalled(inst);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tenantSlug]);

  // Batch-check upgradeable status for all installed catalog skills
  useEffect(() => {
    if (!tenantSlug || installed.length === 0) return;
    const catalogInstalled = installed.filter((s) => s.source !== "tenant" && s.source !== "builtin");
    if (catalogInstalled.length === 0) return;

    Promise.all(
      catalogInstalled.map((s) =>
        checkUpgradeable(tenantSlug, s.slug)
          .then((res) => [s.slug, { upgradeable: res.upgradeable, latestVersion: res.latestVersion }] as const)
          .catch(() => [s.slug, { upgradeable: false, latestVersion: s.version || "" }] as const)
      )
    ).then((results) => {
      setUpgradeMap(new Map(results));
    });
  }, [tenantSlug, installed]);

  const handleInstall = async (slug: string) => {
    if (!tenantSlug) return;
    setInstallingSlug(slug);
    try {
      await installSkill(tenantSlug, slug);
      setInstalled((prev) => [...prev, { slug } as InstalledSkill]);
    } catch (err) {
      console.error("Failed to install skill:", err);
    } finally {
      setInstallingSlug(null);
    }
  };

  // ── Upload Skill dialog state ──────────────────────────────────
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [uploadFiles, setUploadFiles] = useState<{ path: string; content: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const resetUpload = () => {
    setUploadName("");
    setUploadDesc("");
    setUploadFiles([]);
    setUploading(false);
    setDragOver(false);
  };

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const entries: { path: string; content: string }[] = [];

    const fileArray = Array.from(files);
    if (fileArray.length === 1 && fileArray[0].name.endsWith(".zip")) {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(fileArray[0]);
      for (const [relativePath, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const content = await entry.async("string");
        entries.push({ path: relativePath, content });
      }
    } else {
      for (const file of fileArray) {
        const content = await file.text();
        const path = file.webkitRelativePath
          ? file.webkitRelativePath.split("/").slice(1).join("/")
          : file.name;
        entries.push({ path, content });
      }
    }

    // Strip common root directory prefix
    if (entries.length > 1) {
      const first = entries[0].path;
      const prefix = first.includes("/") ? first.split("/").slice(0, -1).join("/") : "";
      if (prefix && entries.every((f) => f.path.startsWith(prefix + "/"))) {
        for (const e of entries) e.path = e.path.slice(prefix.length + 1);
      }
    }

    setUploadFiles(entries);

    // Auto-fill name/description from SKILL.md if present
    const skillMd = entries.find((f) => f.path === "SKILL.md");
    if (skillMd) {
      const fm = skillMd.content.match(/^---\n([\s\S]*?)\n---/);
      const name = fm?.[1]?.match(/^name:\s*(.+)$/m)?.[1]?.trim();
      const desc = fm?.[1]?.match(/^description:\s*(.+)$/m)?.[1]?.trim();
      if (name) setUploadName(name);
      if (desc) setUploadDesc(desc);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const handleUploadConfirm = async () => {
    if (!tenantSlug || !uploadName.trim() || uploadFiles.length === 0) return;
    setUploading(true);
    try {
      const result = await createTenantSkill(tenantSlug, {
        name: uploadName.trim(),
        slug: uploadName.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        description: uploadDesc.trim() || undefined,
      });

      for (const entry of uploadFiles) {
        if (!entry.path) continue;
        await createTenantFile(tenantSlug, result.slug, entry.path, entry.content);
      }

      toast.success(`Skill "${uploadName}" uploaded (${uploadFiles.length} files)`);
      setUploadOpen(false);
      resetUpload();
      navigate({ to: "/skills/$slug", params: { slug: result.slug } });
    } catch (err) {
      console.error("Upload failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to upload skill");
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <PageSkeleton />;

  const installedMap = new Map(installed.map((s) => [s.slug, s]));

  // Merge catalog + tenant-only skills (custom skills not in catalog)
  const allRows: SkillRow[] = [
    ...catalog.map((s) => ({
      ...s,
      installed: installedMap.has(s.slug),
      installedSource: installedMap.get(s.slug)?.source,
    })),
    // Add tenant-created skills that aren't in the catalog
    ...installed
      .filter((s) => s.source === "tenant" && !catalog.some((c) => c.slug === s.slug))
      .map((s) => ({
        slug: s.slug,
        name: s.name || s.slug,
        description: s.description || "",
        category: s.category || "custom",
        version: s.version || "1.0.0",
        author: "tenant",
        icon: "zap",
        tags: [],
        requires_env: [],
        execution: s.execution,
        is_default: false,
        installed: true,
        installedSource: "tenant" as const,
      } as SkillRow)),
  ];

  // Filter by tab
  const rows = (() => {
    switch (tab) {
      case "installed":
        return allRows.filter((r) => r.installed);
      case "custom":
        return allRows.filter((r) => r.installedSource === "tenant");
      case "catalog":
        return allRows.filter((r) => r.installedSource !== "tenant" && !r.is_default);
      default:
        return allRows;
    }
  })().sort((a, b) => a.name.localeCompare(b.name));

  const columns: ColumnDef<SkillRow, any>[] = [
    {
      accessorKey: "name",
      header: "Name",
      size: 200,
      cell: ({ row }) => (
        <span className="font-medium whitespace-nowrap pl-3">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ row }) => (
        <div className="text-muted-foreground text-sm truncate overflow-hidden">
          {row.original.description}
        </div>
      ),
    },
    {
      accessorKey: "category",
      header: "Category",
      size: 120,
      cell: ({ row }) => (
        <Badge variant="outline" className="text-[10px]">
          {row.original.category}
        </Badge>
      ),
    },
    {
      accessorKey: "version",
      header: "Version",
      size: 120,
      cell: ({ row }) => {
        const upgradeInfo = upgradeMap.get(row.original.slug);
        return (
          <span className="text-muted-foreground text-sm flex items-center">
            v{row.original.version}
            {upgradeInfo?.upgradeable && (
              <Badge variant="outline" className="ml-1 text-yellow-500 border-yellow-500/30 text-[10px]">
                Update
              </Badge>
            )}
          </span>
        );
      },
    },
    {
      id: "source",
      header: "Type",
      size: 90,
      cell: ({ row }) => {
        const source = row.original.installedSource || (row.original.is_default ? "builtin" : undefined);
        const exec = row.original.execution;
        if (source === "builtin") {
          return <Badge variant="secondary" className="text-[10px]">Built-in</Badge>;
        }
        if (source === "tenant") {
          return <Badge variant="outline" className="text-[10px] border-primary text-primary">Custom</Badge>;
        }
        if (exec === "mcp") {
          return <Badge variant="outline" className="text-[10px]">MCP</Badge>;
        }
        if (exec === "script") {
          return <Badge variant="outline" className="text-[10px]">Script</Badge>;
        }
        return <Badge variant="outline" className="text-[10px]">Catalog</Badge>;
      },
    },
    {
      id: "actions",
      header: "Status",
      size: 110,
      cell: ({ row }) => {
        const { slug, installed, installedSource } = row.original;
        if (installed) {
          return (
            <Badge variant="default" className="text-xs gap-1 whitespace-nowrap">
              <Check className="h-3 w-3" />
              {installedSource === "builtin" ? "Active" : "Installed"}
            </Badge>
          );
        }
        return (
          <Button
            variant="outline"
            size="sm"
            disabled={installingSlug === slug}
            onClick={(e) => {
              e.stopPropagation();
              handleInstall(slug);
            }}
          >
            {installingSlug === slug ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            Install
          </Button>
        );
      },
    },
  ];

  return (
    <>
    <PageLayout
      header={
        <>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold">Skills Catalog</h1>
              <p className="text-xs text-muted-foreground">Browse and install skills for your agents</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => { resetUpload(); setUploadOpen(true); }}
              >
                <Upload className="h-4 w-4" />
                Upload Skill
              </Button>
              <Button onClick={() => navigate({ to: "/skills/builder" })}>
                <Plus className="h-4 w-4" />
                Create Skill
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-4">
            <div className="relative" style={{ width: "16rem" }}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search skills..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <ToggleGroup type="single" value={tab} onValueChange={(v) => v && setTab(v)} variant="outline">
              <ToggleGroupItem value="all" className="px-4">All</ToggleGroupItem>
              <ToggleGroupItem value="installed" className="px-4">Installed</ToggleGroupItem>
              <ToggleGroupItem value="custom" className="px-4">Custom</ToggleGroupItem>
              <ToggleGroupItem value="catalog" className="px-4">Catalog</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </>
      }
    >
      <DataTable
        columns={columns}
        data={rows}
        filterValue={search}
        scrollable
        tableClassName="table-fixed"
        onRowClick={(row) =>
          navigate({ to: "/skills/$slug", params: { slug: row.slug } })
        }
      />
    </PageLayout>

    {/* Upload Skill Dialog */}
    <Dialog open={uploadOpen} onOpenChange={(open) => { setUploadOpen(open); if (!open) resetUpload(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Skill Pack</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="upload-name">Skill Name</Label>
            <Input
              id="upload-name"
              placeholder="my-skill"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and hyphens. Auto-filled from SKILL.md if present.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="upload-desc">Description</Label>
            <Input
              id="upload-desc"
              placeholder="What this skill does and when to use it"
              value={uploadDesc}
              onChange={(e) => setUploadDesc(e.target.value)}
            />
          </div>

          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.multiple = true;
              input.accept = ".zip,.md,.yaml,.yml,.py,.txt,.json,.sh";
              input.onchange = () => { if (input.files) processFiles(input.files); };
              input.click();
            }}
          >
            {uploadFiles.length === 0 ? (
              <>
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Drop files here or click to browse
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  .zip file or individual skill files (SKILL.md, scripts/, etc.)
                </p>
              </>
            ) : (
              <div className="text-left space-y-1">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">{uploadFiles.length} file(s) ready</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); setUploadFiles([]); setUploadName(""); setUploadDesc(""); }}
                  >
                    <X className="h-3 w-3" />
                    Clear
                  </Button>
                </div>
                <div className="max-h-32 overflow-y-auto space-y-0.5">
                  {uploadFiles.map((f) => (
                    <div key={f.path} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="truncate">{f.path}</span>
                      <span className="text-muted-foreground/50 shrink-0">
                        {f.content.length > 1024 ? `${(f.content.length / 1024).toFixed(1)}KB` : `${f.content.length}B`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUploadConfirm}
              disabled={uploading || !uploadName.trim() || uploadFiles.length === 0}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Upload className="h-4 w-4 mr-1.5" />}
              Upload Skill
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
