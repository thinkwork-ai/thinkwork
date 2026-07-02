import { useState } from "react";
import { useMutation, useQuery } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { Copy, Archive, Pencil, Plus, Star } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { ModelSelect } from "@/components/agents/ModelSelect";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  SettingsPageTitle,
  SettingsPane,
} from "@/components/settings/SettingsContent";
import {
  ArchiveEvalProfileMutation,
  CreateEvalProfileMutation,
  DuplicateEvalProfileMutation,
  EvalProfilesQuery,
  SetDefaultEvalProfileMutation,
  UpdateEvalProfileMutation,
} from "@/lib/evaluation-queries";
import { relativeTime } from "@/lib/utils";

export type EvalProfileRow = {
  id: string;
  name: string;
  model: string;
  judgeModel: string | null;
  trials: number;
  isDefault: boolean;
  archivedAt: string | null;
  updatedAt: string;
};

export function shortModelLabel(model: string | null | undefined): string {
  if (!model) return "—";
  return model
    .replace(/^us\./, "")
    .replace(/^anthropic\./, "")
    .replace(/^moonshotai\./, "")
    .replace(/^amazon\./, "")
    .replace(/-v\d+:\d+$/, "")
    .replace(/-\d{8}$/, "");
}

/**
 * Trials input guard mirroring the server's 1..9 bound — the field
 * multiplies run cost, so the UI clamps before the mutation does.
 */
export function clampTrials(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(9, Math.max(1, Math.round(value)));
}

export function SettingsEvalProfiles() {
  const { tenantId } = useTenant();
  const [profilesResult, refetchProfiles] = useQuery({
    query: EvalProfilesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const refresh = () => refetchProfiles({ requestPolicy: "network-only" });

  const [editing, setEditing] = useState<EvalProfileRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [defaultCandidate, setDefaultCandidate] =
    useState<EvalProfileRow | null>(null);

  const [, duplicateProfile] = useMutation(DuplicateEvalProfileMutation);
  const [, archiveProfile] = useMutation(ArchiveEvalProfileMutation);
  const [, setDefaultProfile] = useMutation(SetDefaultEvalProfileMutation);

  usePageHeaderActions({
    title: "Eval Profiles",
    breadcrumbs: [
      { label: "Evaluations", href: "/settings/evaluations" },
      { label: "Profiles" },
    ],
    action: tenantId ? (
      <Button size="sm" onClick={() => setCreating(true)}>
        <Plus className="mr-1 size-4" />
        New Profile
      </Button>
    ) : undefined,
    actionKey: `eval-profiles:${tenantId ?? ""}`,
  });

  if (!tenantId) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingShimmer />
      </div>
    );
  }

  const profiles = (profilesResult.data?.evalProfiles ??
    []) as unknown as EvalProfileRow[];

  const columns: ColumnDef<EvalProfileRow>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <span className="flex items-center gap-2 text-sm font-medium">
          {row.original.name}
          {row.original.isDefault && (
            <Badge variant="secondary" className="gap-1">
              <Star className="h-3 w-3" />
              Default
            </Badge>
          )}
        </span>
      ),
    },
    {
      accessorKey: "model",
      header: "Model",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {shortModelLabel(row.original.model)}
        </span>
      ),
    },
    {
      accessorKey: "judgeModel",
      header: "Judge",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {row.original.judgeModel
            ? shortModelLabel(row.original.judgeModel)
            : "Platform default"}
        </span>
      ),
    },
    {
      accessorKey: "trials",
      header: "Trials",
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{row.original.trials}</span>
      ),
    },
    {
      id: "updated",
      header: "Updated",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {relativeTime(row.original.updatedAt)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          {!row.original.isDefault && (
            <Button
              variant="outline"
              size="icon-sm"
              title="Set as default"
              aria-label={`Set ${row.original.name} as default`}
              onClick={(event) => {
                event.stopPropagation();
                setDefaultCandidate(row.original);
              }}
            >
              <Star className="size-4" />
            </Button>
          )}
          <Button
            variant="outline"
            size="icon-sm"
            title="Edit"
            aria-label={`Edit ${row.original.name}`}
            onClick={(event) => {
              event.stopPropagation();
              setEditing(row.original);
            }}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            title="Duplicate"
            aria-label={`Duplicate ${row.original.name}`}
            onClick={async (event) => {
              event.stopPropagation();
              const res = await duplicateProfile({ id: row.original.id });
              if (res.error) alert(`Duplicate failed: ${res.error.message}`);
              refresh();
            }}
          >
            <Copy className="size-4" />
          </Button>
          {!row.original.isDefault && (
            <Button
              variant="outline"
              size="icon-sm"
              title="Archive"
              aria-label={`Archive ${row.original.name}`}
              onClick={async (event) => {
                event.stopPropagation();
                const res = await archiveProfile({ id: row.original.id });
                if (res.error) alert(`Archive failed: ${res.error.message}`);
                refresh();
              }}
            >
              <Archive className="size-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <SettingsPane className="max-w-none">
      <SettingsPageTitle
        title="Eval Profiles"
        description="A profile is the agent-under-test configuration — model, judge pin, and trial count. Runs pin a snapshot at dispatch; the default profile backs skill gates and scheduled runs."
      />
      {profilesResult.fetching ? (
        <LoadingShimmer />
      ) : profiles.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No profiles yet — the tenant default is synthesized on the first
            run. Create one to pin a model, judge, or trial count.
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={profiles}
          pageSize={25}
          onRowClick={(profile) => setEditing(profile)}
        />
      )}

      {(creating || editing) && (
        <ProfileFormDialog
          tenantId={tenantId}
          profile={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
            refresh();
          }}
        />
      )}

      {/* Set-default confirmation: the default redirects skill gates and
          scheduled runs, so it never flips on a single misclick. */}
      <Dialog
        open={defaultCandidate != null}
        onOpenChange={(open) => {
          if (!open) setDefaultCandidate(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set default profile</DialogTitle>
            <DialogDescription>
              Make “{defaultCandidate?.name}” the tenant default? Skill-update
              gates and scheduled evaluation runs will use it from the next
              launch on. Past runs keep their pinned snapshots.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDefaultCandidate(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!defaultCandidate) return;
                const res = await setDefaultProfile({
                  id: defaultCandidate.id,
                });
                if (res.error) {
                  alert(`Set default failed: ${res.error.message}`);
                }
                setDefaultCandidate(null);
                refresh();
              }}
            >
              Set as default
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPane>
  );
}

function ProfileFormDialog({
  tenantId,
  profile,
  onClose,
}: {
  tenantId: string;
  profile: EvalProfileRow | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [model, setModel] = useState(profile?.model ?? "");
  const [judgeModel, setJudgeModel] = useState(profile?.judgeModel ?? "");
  const [trials, setTrials] = useState(profile?.trials ?? 1);
  const [submitting, setSubmitting] = useState(false);
  const [, createProfile] = useMutation(CreateEvalProfileMutation);
  const [, updateProfile] = useMutation(UpdateEvalProfileMutation);

  async function handleSave() {
    setSubmitting(true);
    try {
      const res = profile
        ? await updateProfile({
            id: profile.id,
            input: {
              name: name.trim(),
              model,
              ...(judgeModel
                ? { judgeModel }
                : // Explicit null is indistinguishable from omitted for
                  // judgeModel — clearing uses the dedicated flag.
                  profile.judgeModel
                  ? { clearJudgeModel: true }
                  : {}),
              trials: clampTrials(trials),
            },
          })
        : await createProfile({
            tenantId,
            input: {
              name: name.trim(),
              model,
              ...(judgeModel ? { judgeModel } : {}),
              trials: clampTrials(trials),
            },
          });
      if (res.error) {
        alert(`Save failed: ${res.error.message}`);
        return;
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {profile ? `Edit ${profile.name}` : "New Eval Profile"}
          </DialogTitle>
          <DialogDescription>
            Runs pin a snapshot of these values at dispatch — editing a profile
            never reinterprets past runs.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eval-profile-name">Name</Label>
            <Input
              id="eval-profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Kimi baseline"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Model (agent under test)</Label>
            <ModelSelect
              value={model}
              onValueChange={setModel}
              className="w-full"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Judge model</Label>
            <p className="text-xs text-muted-foreground">
              Pins the LLM judge for rubric scoring. Leave unset to use the
              platform default; runs under different judges are flagged
              non-comparable.
            </p>
            <ModelSelect
              value={judgeModel}
              onValueChange={setJudgeModel}
              className="w-full"
            />
            {judgeModel && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setJudgeModel("")}
              >
                Clear judge pin
              </Button>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eval-profile-trials">Trials</Label>
            <p className="text-xs text-muted-foreground">
              Executions per rubric-scored case (1–9). Majority verdict wins; a
              tie renders as unstable and is excluded from the pass rate.
              Deterministic-only cases always run once.
            </p>
            <Input
              id="eval-profile-trials"
              type="number"
              min={1}
              max={9}
              value={trials}
              onChange={(event) => setTrials(Number(event.target.value))}
              className="w-24"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={submitting || !name.trim() || !model}
          >
            {submitting ? "Saving…" : profile ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
