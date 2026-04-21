/**
 * Skill Runs observability — list view.
 *
 * Surfaces every composition invocation on the tenant (chat / scheduled /
 * catalog / webhook). Filter bar is intentionally lean for v1 — default
 * sort is started_at desc and most admin use cases are "show me the last
 * N runs, filtered by skill or status." Deeper filtering lands when the
 * run volume warrants it.
 *
 * Not wired to AppSync subscriptions yet — urql's cache + a 10s polling
 * interval on running rows covers the observability need without adding
 * a subscription type. When run volume grows, swap in
 * OnSkillRunUpdatedSubscription here.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "urql";
import { type ColumnDef } from "@tanstack/react-table";

import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SkillRunStatusBadge } from "@/components/skill-runs/StatusBadge";
import { SkillRunsQuery } from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

type SkillRunRow = {
  id: string;
  tenantId: string;
  agentId: string | null;
  invokerUserId: string;
  skillId: string;
  skillVersion: number;
  invocationSource: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  feedbackSignal: string | null;
  failureReason: string | null;
  createdAt: string;
};

export const Route = createFileRoute("/_authed/_tenant/skill-runs/")({
  component: SkillRunsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    skillId: typeof search.skillId === "string" ? search.skillId : undefined,
    status: typeof search.status === "string" ? search.status : undefined,
    invocationSource:
      typeof search.invocationSource === "string"
        ? search.invocationSource
        : undefined,
  }),
});

const STATUS_OPTIONS = [
  { value: "all", label: "Any status" },
  { value: "running", label: "Running" },
  { value: "complete", label: "Complete" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "skipped_disabled", label: "Skipped (disabled)" },
  { value: "invoker_deprovisioned", label: "Invoker deprovisioned" },
];

const SOURCE_OPTIONS = [
  { value: "all", label: "Any source" },
  { value: "chat", label: "Chat" },
  { value: "scheduled", label: "Scheduled" },
  { value: "catalog", label: "Admin catalog" },
  { value: "webhook", label: "Webhook" },
];

function SkillRunsPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const { setBreadcrumbs } = useBreadcrumbs();
  const search = Route.useSearch();

  setBreadcrumbs([{ label: "Skill Runs" }]);

  const [skillFilter, setSkillFilter] = useState(search.skillId ?? "");

  const [result] = useQuery({
    query: SkillRunsQuery,
    variables: {
      tenantId: tenantId ?? undefined,
      skillId: skillFilter || undefined,
      status: search.status && search.status !== "all" ? search.status : undefined,
      invocationSource:
        search.invocationSource && search.invocationSource !== "all"
          ? search.invocationSource
          : undefined,
      limit: 100,
    },
    pause: !tenantId,
  });

  const rows: SkillRunRow[] = result.data?.skillRuns ?? [];

  const columns = useMemo<ColumnDef<SkillRunRow>[]>(
    () => [
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <SkillRunStatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "skillId",
        header: "Skill",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.skillId}</span>
        ),
      },
      {
        accessorKey: "invocationSource",
        header: "Source",
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {row.original.invocationSource}
          </span>
        ),
      },
      {
        accessorKey: "startedAt",
        header: "Started",
        cell: ({ row }) => (
          <span className="text-xs">{relativeTime(row.original.startedAt)}</span>
        ),
      },
      {
        accessorKey: "finishedAt",
        header: "Finished",
        cell: ({ row }) =>
          row.original.finishedAt ? (
            <span className="text-xs">{relativeTime(row.original.finishedAt)}</span>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          ),
      },
      {
        accessorKey: "feedbackSignal",
        header: "Feedback",
        cell: ({ row }) => {
          const s = row.original.feedbackSignal;
          if (!s) return <span className="text-muted-foreground text-xs">—</span>;
          return (
            <span className={s === "positive" ? "text-green-600" : "text-red-600"}>
              {s === "positive" ? "👍" : "👎"}
            </span>
          );
        },
      },
    ],
    [],
  );

  if (!tenantId) return <PageSkeleton />;

  return (
    <div>
      <PageHeader title="Skill Runs" description="Every composition invocation on this tenant — chat, scheduled, catalog, webhook." />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filter by skill id…"
          className="w-64"
          value={skillFilter}
          onChange={(e) => setSkillFilter(e.target.value)}
        />
        <Select
          value={search.status ?? "all"}
          onValueChange={(v) =>
            navigate({
              to: "/skill-runs",
              search: {
                ...search,
                status: v === "all" ? undefined : v,
              },
            })
          }
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={search.invocationSource ?? "all"}
          onValueChange={(v) =>
            navigate({
              to: "/skill-runs",
              search: {
                ...search,
                invocationSource: v === "all" ? undefined : v,
              },
            })
          }
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <div
          className="rounded-lg border border-dashed p-12 text-center text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          No skill runs yet. Compositions triggered from chat, the admin catalog,
          a scheduled job, or a webhook will appear here.
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          onRowClick={(r) =>
            navigate({
              to: "/skill-runs/$runId",
              params: { runId: r.id },
            })
          }
        />
      )}
    </div>
  );
}
