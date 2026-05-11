import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "urql";
import { BookOpen } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, DataTable, Input, Spinner, Tabs, TabsList, TabsTrigger } from "@thinkwork/ui";
import { ComputerKnowledgeBasesQuery } from "@/lib/graphql-queries";
import { useTenant } from "@/context/TenantContext";
import { MEMORY_TABS } from "./memory";

type KbRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  documentCount: number;
  lastSyncAt: string | null;
};

const COMPACT_TABLE_CELL = "flex h-10 min-w-0 items-center px-2";

interface KnowledgeBasesResult {
  knowledgeBases?: any[] | null;
}

export const Route = createFileRoute("/_authed/_shell/memory/kbs")({
  component: KbsIndexPage,
});

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ready: "bg-green-500/20 text-green-400",
    syncing: "bg-yellow-500/20 text-yellow-400",
    failed: "bg-red-500/20 text-red-400",
  };
  return (
    <Badge className={`${colors[status] ?? "bg-muted text-muted-foreground"} font-normal text-xs`}>
      {status}
    </Badge>
  );
}

function KbsIndexPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeTab =
    [...MEMORY_TABS]
      .reverse()
      .find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`))?.to ?? "";
  const [search, setSearch] = useState("");

  const [result] = useQuery<KnowledgeBasesResult>({
    query: ComputerKnowledgeBasesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const rows: KbRow[] = useMemo(() => {
    const kbs = result.data?.knowledgeBases ?? [];
    return kbs
      .map((kb: any) => ({
        id: kb.id,
        name: kb.name,
        slug: kb.slug,
        description: kb.description,
        status: kb.status,
        documentCount: kb.documentCount ?? 0,
        lastSyncAt: kb.lastSyncAt,
      }))
      .filter((kb) => !search || kb.name.toLowerCase().includes(search.toLowerCase()));
  }, [result.data, search]);

  const columns: ColumnDef<KbRow>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} gap-1.5 font-medium`}>
            <BookOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate">{row.original.name}</span>
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        size: 100,
        cell: ({ row }) => (
          <span className={COMPACT_TABLE_CELL}>
            <StatusBadge status={row.original.status} />
          </span>
        ),
      },
      {
        accessorKey: "documentCount",
        header: "Docs",
        size: 70,
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} text-sm text-muted-foreground`}>
            {row.original.documentCount}
          </span>
        ),
      },
      {
        accessorKey: "lastSyncAt",
        header: "Last Sync",
        size: 120,
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} text-sm text-muted-foreground`}>
            {relativeTime(row.original.lastSyncAt)}
          </span>
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} text-sm text-muted-foreground`}>
            <span className="truncate">{row.original.description || "—"}</span>
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="relative flex shrink-0 items-center gap-3 px-4 py-3">
        <Input
          placeholder="Search knowledge bases..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-fit min-w-56 max-w-full"
        />
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="pointer-events-auto">
            <Tabs value={activeTab}>
              <TabsList>
                {MEMORY_TABS.map((tab) => (
                  <TabsTrigger
                    key={tab.to}
                    value={tab.to}
                    asChild
                    className="px-3 text-xs"
                  >
                    <Link to={tab.to}>{tab.label}</Link>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 px-4">
        {result.fetching && !result.data ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Spinner /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground max-w-sm">
              {search
                ? "No knowledge bases match your search."
                : "Your tenant has no knowledge bases yet — ask your operator to create one."}
            </p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            onRowClick={(row) =>
              navigate({ to: "/memory/kbs/$kbId", params: { kbId: row.id } })
            }
            scrollable
            compact
            pageSize={25}
          />
        )}
      </div>
    </div>
  );
}
