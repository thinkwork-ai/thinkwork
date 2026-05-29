import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Sparkles } from "lucide-react";
import { DataTable, Input, Skeleton } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { listSkillSlugs } from "@/lib/workspace-files-api";
import {
  SettingsHeader,
  SettingsPane,
  SettingsTablePane,
} from "@/components/settings/SettingsContent";

type SkillRow = { slug: string };

export function SettingsSkills() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [slugs, setSlugs] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setError(null);
    listSkillSlugs()
      .then((s) => !cancelled && setSlugs(s))
      .catch(
        (e) =>
          !cancelled &&
          setError(e instanceof Error ? e.message : "Failed to load skills"),
      );
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const rows = useMemo<SkillRow[]>(
    () => (slugs ?? []).map((slug) => ({ slug })),
    [slugs],
  );

  const columns = useMemo<ColumnDef<SkillRow>[]>(
    () => [
      {
        accessorKey: "slug",
        header: "Skill",
        cell: ({ row }) => (
          <span className="flex items-center gap-2 font-medium">
            <Sparkles className="size-4 shrink-0 text-muted-foreground" />
            {row.original.slug}
          </span>
        ),
      },
    ],
    [],
  );

  if (!slugs && !error) {
    return (
      <SettingsPane className="max-w-5xl">
        <SettingsHeader title="Skills" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </SettingsPane>
    );
  }

  return (
    <SettingsTablePane
      title="Skills"
      description="The tenant skill catalog. Open a skill to edit its files."
      toolbar={
        error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <Input
            placeholder="Search skills…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        )
      }
    >
      <DataTable
        columns={columns}
        data={rows}
        filterValue={search}
        filterColumn="slug"
        scrollable
        allowHorizontalScroll={false}
        pageSize={25}
        tableClassName="table-fixed"
        onRowClick={(row) =>
          navigate({
            to: "/settings/skills/$skillSlug",
            params: { skillSlug: row.slug },
          })
        }
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            No skills in the catalog yet.
          </div>
        }
      />
    </SettingsTablePane>
  );
}
