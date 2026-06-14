import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  Badge,
  Button,
  DataTable,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  listSkillSummaries,
  type SkillSummary,
} from "@/lib/workspace-files-api";
import {
  SetSkillEvalGateMutation,
  SkillEvalGateQuery,
  SkillEvalScoreQuery,
} from "@/lib/evaluation-queries";
import { formatPassRatePct } from "@/lib/skill-eval-format";
import { SettingsTablePane } from "@/components/settings/SettingsContent";

/**
 * Per-skill score cell (U9). Each row reads its own `skillEvalScore` — urql
 * caches the per-(tenant, skill) document, so revisiting the list is cheap.
 * "Unrated" (no enabled cases) is a neutral state, never a failure; a rated
 * skill with no completed run yet shows "—" rather than 0%.
 */
function SkillEvalScoreCell({ skillSlug }: { skillSlug: string }) {
  const { tenantId } = useTenant();
  const [{ data, fetching }] = useQuery({
    query: SkillEvalScoreQuery,
    variables: { tenantId: tenantId ?? "", skillSlug },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const score = data?.skillEvalScore;

  if (!score) {
    return (
      <span className="text-muted-foreground">{fetching ? "…" : "—"}</span>
    );
  }
  if (!score.rated) {
    return <span className="text-muted-foreground">Unrated</span>;
  }
  const pct = formatPassRatePct(score.passRate);
  if (pct == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-medium tabular-nums">{pct}</span>
      {score.regression ? (
        <Badge variant="destructive">Regression</Badge>
      ) : null}
    </span>
  );
}

/**
 * Per-tenant skill-update gate control (U6). A finite threshold HOLDS a skill
 * UPDATE whose candidate version scores below it until an operator applies it
 * (or overrides). No gate = nothing blocks. Operator-only (the whole Skills
 * surface is OperatorGuard-wrapped; the mutation re-checks requireTenantAdmin).
 */
function SkillEvalGateControl() {
  const { tenantId } = useTenant();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [{ data, fetching }, refetchGate] = useQuery({
    query: SkillEvalGateQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [{ fetching: saving }, setGate] = useMutation(SetSkillEvalGateMutation);

  const gate = data?.skillEvalGate;
  const thresholdPct =
    gate?.threshold != null ? Math.round(gate.threshold * 100) : null;

  // Seed the draft from the saved threshold each time the popover opens.
  useEffect(() => {
    if (open) setDraft(thresholdPct != null ? String(thresholdPct) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save(threshold: number | null) {
    if (!tenantId) return;
    const result = await setGate({ tenantId, threshold });
    if (result.error) {
      toast.error(`Could not update the gate: ${result.error.message}`);
      return;
    }
    refetchGate({ requestPolicy: "network-only" });
    setOpen(false);
    toast.success(
      threshold == null
        ? "Skill-update gate turned off."
        : `Skill-update gate set to ${Math.round(threshold * 100)}%.`,
    );
  }

  const parsed = Number(draft);
  const draftValid =
    draft.trim().length > 0 &&
    Number.isFinite(parsed) &&
    parsed >= 0 &&
    parsed <= 100;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" data-testid="skill-gate-trigger">
          {fetching && !gate ? (
            <Spinner className="size-3.5" />
          ) : (
            <>
              Update gate:{" "}
              <span className="font-semibold tabular-nums">
                {thresholdPct != null ? `${thresholdPct}%` : "Off"}
              </span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="skill-gate-threshold">Skill-update gate</Label>
            <p className="text-xs text-muted-foreground">
              Hold a skill update when its candidate version scores below this
              until an operator applies it. Unrated skills are never held.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="skill-gate-threshold"
              data-testid="skill-gate-input"
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              placeholder="e.g. 80"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">% passing</span>
          </div>
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="skill-gate-off"
              disabled={saving || !gate?.enabled}
              onClick={() => void save(null)}
            >
              Turn off
            </Button>
            <Button
              type="button"
              size="sm"
              data-testid="skill-gate-save"
              disabled={saving || !draftValid}
              onClick={() => void save(parsed / 100)}
            >
              {saving ? <Spinner className="size-3.5" /> : "Save"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

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
        size: 240,
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
      {
        id: "score",
        header: "Eval score",
        size: 140,
        cell: ({ row }) => <SkillEvalScoreCell skillSlug={row.original.slug} />,
      },
    ],
    [],
  );

  return (
    <SettingsTablePane
      title="Skill Library"
      description="Browse, install, and manage the skills your agents can use."
      loading={!skills && !error}
      toolbar={
        <div className="flex w-full items-center justify-between gap-3">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <Input
              placeholder="Search skills…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          )}
          <SkillEvalGateControl />
        </div>
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
