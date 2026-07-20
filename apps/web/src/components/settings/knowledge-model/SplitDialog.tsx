import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Loader2 } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@thinkwork/ui";
import { SplitHalf } from "@/gql/graphql";
import {
  SettingsCanonicalEntitySplitPreviewQuery,
  SettingsSplitCanonicalEntityMutation,
} from "@/lib/settings-queries";
import type { CanonicalEntityRow } from "./IdentityList";

/**
 * Split dialog (THINK-321 U8, R13/AE5): the inverse repair tool to merge,
 * mirroring its preview/confirm-echo contract. The operator partitions the
 * entity's source mappings between half A (keeps this canonical entity) and
 * half B (a new canonical entity they name); wiki/kg content re-derives on
 * the next compile — there is deliberately no content-partitioning UI. A
 * stale preview aborts server-side; we surface that and offer a refresh.
 */
export function SplitDialog({
  open,
  onOpenChange,
  tenantId,
  entity,
  onSplit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  entity: CanonicalEntityRow | null;
  onSplit: () => void;
}) {
  const [halves, setHalves] = useState<Record<string, SplitHalf>>({});
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [staleImpact, setStaleImpact] = useState(false);
  const [splitting, setSplitting] = useState(false);

  const mappings = entity?.sourceMappings ?? [];
  const assignments = useMemo(
    () =>
      mappings.map((mapping) => ({
        mappingId: mapping.id,
        half: halves[mapping.id] ?? SplitHalf.A,
      })),
    [mappings, halves],
  );
  const countB = assignments.filter((a) => a.half === SplitHalf.B).length;
  const countA = assignments.length - countB;
  // A valid split needs at least one mapping on each half.
  const partitionValid = countA > 0 && countB > 0;

  const ready = Boolean(tenantId && entity && partitionValid);
  const [previewResult, reexecutePreview] = useQuery({
    query: SettingsCanonicalEntitySplitPreviewQuery,
    variables: {
      tenantId,
      canonicalEntityId: entity?.id ?? "",
      assignments,
    },
    pause: !open || !ready,
  });
  const preview = ready
    ? previewResult.data?.canonicalEntitySplitPreview
    : undefined;
  const previewLoading = ready && previewResult.fetching;

  const [, splitEntity] = useMutation(SettingsSplitCanonicalEntityMutation);

  const reset = (nextOpen: boolean) => {
    if (!nextOpen) {
      setHalves({});
      setNewName("");
      setError(null);
      setStaleImpact(false);
    }
    onOpenChange(nextOpen);
  };

  const refreshPreview = () => {
    setError(null);
    setStaleImpact(false);
    reexecutePreview({ requestPolicy: "network-only" });
  };

  const setHalf = (mappingId: string, half: SplitHalf) => {
    setHalves((current) => ({ ...current, [mappingId]: half }));
    setError(null);
    setStaleImpact(false);
  };

  const confirmSplit = async () => {
    if (!entity || !preview || !newName.trim() || splitting) return;
    setSplitting(true);
    setError(null);
    setStaleImpact(false);
    try {
      const result = await splitEntity({
        tenantId,
        canonicalEntityId: entity.id,
        assignments,
        newEntityDisplayName: newName.trim(),
        // Echo the previewed impact exactly — the server recomputes inside
        // the transaction and aborts on drift (mirrors merge).
        confirmImpact: {
          mappingCountA: preview.mappingCountA,
          mappingCountB: preview.mappingCountB,
          claimCountFollowingB: preview.claimCountFollowingB,
          claimCountRemainingA: preview.claimCountRemainingA,
          memoryClaimCount: preview.memoryClaimCount,
          graphEntityCount: preview.graphEntityCount,
          wikiPageId: preview.wikiPageId ?? null,
        },
      });
      if (result.error) {
        const message = result.error.message;
        setError(message);
        if (/impact.*changed/i.test(message)) setStaleImpact(true);
        return;
      }
      onSplit();
      reset(false);
    } finally {
      setSplitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Split entity</DialogTitle>
          <DialogDescription>
            Undo a wrong merge by assigning each source mapping to the entity
            that should keep it. Keep keeps “{entity?.displayName}”; Move sends
            the mapping to a new entity. Wiki and graph content re-derives on
            the next compile.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {mappings.length < 2 ? (
            <p className="text-muted-foreground text-sm">
              Splitting needs at least two source mappings to divide.
            </p>
          ) : (
            <ul className="space-y-1.5" aria-label="Source mapping assignment">
              {mappings.map((mapping) => {
                const half = halves[mapping.id] ?? SplitHalf.A;
                return (
                  <li
                    key={mapping.id}
                    className="flex items-center gap-2 text-xs"
                  >
                    <Badge variant="outline" className="text-xs">
                      {mapping.sourceSystem}
                    </Badge>
                    <span className="text-muted-foreground min-w-0 flex-1 truncate">
                      {mapping.namespace ? `${mapping.namespace} / ` : ""}
                      {mapping.externalId}
                    </span>
                    <div
                      className="flex shrink-0 overflow-hidden rounded-md border"
                      role="group"
                      aria-label={`Assignment for ${mapping.sourceSystem} ${mapping.externalId}`}
                    >
                      <button
                        type="button"
                        aria-pressed={half === SplitHalf.A}
                        className={
                          half === SplitHalf.A
                            ? "bg-primary text-primary-foreground px-2 py-1"
                            : "hover:bg-muted px-2 py-1"
                        }
                        onClick={() => setHalf(mapping.id, SplitHalf.A)}
                      >
                        Keep
                      </button>
                      <button
                        type="button"
                        aria-pressed={half === SplitHalf.B}
                        className={
                          half === SplitHalf.B
                            ? "bg-primary text-primary-foreground px-2 py-1"
                            : "hover:bg-muted px-2 py-1"
                        }
                        onClick={() => setHalf(mapping.id, SplitHalf.B)}
                      >
                        Move
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="split-new-name">New entity name</Label>
            <Input
              id="split-new-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Name for the moved mappings' entity"
            />
          </div>

          {!partitionValid && mappings.length >= 2 ? (
            <p className="text-muted-foreground text-sm">
              Move at least one mapping to the new entity (and keep at least
              one) to preview the split.
            </p>
          ) : null}

          {previewLoading ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Computing split impact...
            </div>
          ) : null}
          {ready && previewResult.error ? (
            <p className="text-destructive text-sm" role="alert">
              Failed to preview split impact: {previewResult.error.message}
            </p>
          ) : null}
          {preview && !previewLoading ? (
            <div className="rounded-md border p-3 text-sm">
              <p className="mb-2 font-medium">Splitting will:</p>
              <ul className="text-muted-foreground space-y-0.5 text-xs">
                <li>
                  Keep {preview.mappingCountA} mapping
                  {preview.mappingCountA === 1 ? "" : "s"} on “
                  {entity?.displayName}”
                </li>
                <li>
                  Move {preview.mappingCountB} mapping
                  {preview.mappingCountB === 1 ? "" : "s"} to the new entity
                </li>
                <li>
                  {preview.claimCountFollowingB} identity claims follow the new
                  entity; {preview.claimCountRemainingA} stay
                </li>
                <li>
                  {preview.memoryClaimCount} memory claims and{" "}
                  {preview.graphEntityCount} graph entities stay and re-derive
                  on the next compile
                </li>
              </ul>
            </div>
          ) : null}

          {error ? (
            <div className="space-y-2" role="alert">
              <p className="text-destructive text-sm">{error}</p>
              {staleImpact ? (
                <Button variant="outline" size="sm" onClick={refreshPreview}>
                  Refresh preview
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => reset(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={
              !preview ||
              previewLoading ||
              !newName.trim() ||
              splitting ||
              staleImpact
            }
            onClick={() => void confirmSplit()}
          >
            {splitting ? (
              <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />
            ) : null}
            Confirm split
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
