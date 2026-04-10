import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Search, Check, Download, Loader2, Plus } from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  listCatalog,
  listTenantSkills,
  installSkill,
  checkUpgradeable,
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
    <PageLayout
      header={
        <>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold">Skills Catalog</h1>
              <p className="text-xs text-muted-foreground">Browse and install skills for your agents</p>
            </div>
            <div className="flex items-center gap-2">
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
  );
}
