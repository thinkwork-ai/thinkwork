import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, Input } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  listSkillSummaries,
  type SkillSummary,
} from "@/lib/workspace-files-api";
import { SettingsTablePane } from "@/components/settings/SettingsContent";

export function SettingsSkills() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setError(null);
    listSkillSummaries()
      .then((s) => !cancelled && setSkills(s))
      .catch(
        (e) =>
          !cancelled &&
          setError(e instanceof Error ? e.message : "Failed to load skills"),
      );
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const rows = useMemo<SkillSummary[]>(() => skills ?? [], [skills]);

  const columns = useMemo<ColumnDef<SkillSummary>[]>(
    () => [
      {
        accessorKey: "slug",
        header: "Skill",
        size: 280,
        cell: ({ row }) => (
          <span className="block truncate font-medium">
            {row.original.displayName?.trim() || row.original.slug}
          </span>
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <span className="block truncate text-muted-foreground">
            {row.original.description?.trim() || "—"}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <SettingsTablePane
      title="Skills"
      loading={!skills && !error}
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
