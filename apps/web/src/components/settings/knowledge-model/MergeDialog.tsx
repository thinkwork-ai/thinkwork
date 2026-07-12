import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Loader2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import {
  SettingsCanonicalEntityMergePreviewQuery,
  SettingsMergeCanonicalEntitiesMutation,
} from "@/lib/settings-queries";
import type { CanonicalEntityRow } from "./IdentityList";

/**
 * Merge-repair dialog: pick a survivor and a loser canonical entity of the
 * same type, preview the merge impact, and confirm by echoing the previewed
 * impact back to the mutation. A stale preview aborts the merge server-side;
 * we surface that and offer a preview refresh.
 */
export function MergeDialog({
  open,
  onOpenChange,
  tenantId,
  entities,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  entities: CanonicalEntityRow[];
  onMerged: () => void;
}) {
  const [survivorId, setSurvivorId] = useState<string>("");
  const [loserId, setLoserId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [staleImpact, setStaleImpact] = useState(false);
  const [merging, setMerging] = useState(false);

  const mergeable = useMemo(
    () => entities.filter((entity) => entity.status !== "merged"),
    [entities],
  );
  const survivor = mergeable.find((entity) => entity.id === survivorId);
  const loserOptions = useMemo(
    () =>
      survivor
        ? mergeable.filter(
            (entity) =>
              entity.id !== survivor.id &&
              entity.entityTypeSlug === survivor.entityTypeSlug,
          )
        : [],
    [mergeable, survivor],
  );
  const loser = loserOptions.find((entity) => entity.id === loserId);

  const ready = Boolean(tenantId && survivor && loser);
  const [previewResult, reexecutePreview] = useQuery({
    query: SettingsCanonicalEntityMergePreviewQuery,
    variables: { tenantId, survivorId, loserId },
    pause: !open || !ready,
  });
  const preview = ready
    ? previewResult.data?.canonicalEntityMergePreview
    : undefined;
  const previewLoading = ready && previewResult.fetching;

  const [, mergeEntities] = useMutation(SettingsMergeCanonicalEntitiesMutation);

  const reset = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSurvivorId("");
      setLoserId("");
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

  const confirmMerge = async () => {
    if (!preview || !survivor || !loser || merging) return;
    setMerging(true);
    setError(null);
    setStaleImpact(false);
    try {
      const result = await mergeEntities({
        tenantId,
        survivorId: survivor.id,
        loserId: loser.id,
        confirmImpact: {
          sourceMappingCount: preview.sourceMappingCount,
          identityClaimCount: preview.identityClaimCount,
          memoryClaimCount: preview.memoryClaimCount,
          graphEntityCount: preview.graphEntityCount,
          loserWikiPageId: preview.loserWikiPageId ?? null,
          loserWikiPageSlug: preview.loserWikiPageSlug ?? null,
          survivorWikiPageId: preview.survivorWikiPageId ?? null,
        },
      });
      if (result.error) {
        const message = result.error.message;
        setError(message);
        if (/impact.*changed/i.test(message)) setStaleImpact(true);
        return;
      }
      onMerged();
      reset(false);
    } finally {
      setMerging(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Repair merge</DialogTitle>
          <DialogDescription>
            Merge a duplicate canonical entity (loser) into the one that should
            remain (survivor). Both must be the same entity type. The loser
            persists as a redirect.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="merge-survivor">Survivor</Label>
            <Select
              value={survivorId}
              onValueChange={(value) => {
                setSurvivorId(value);
                setLoserId("");
                setError(null);
                setStaleImpact(false);
              }}
            >
              <SelectTrigger id="merge-survivor" aria-label="Survivor entity">
                <SelectValue placeholder="Choose the entity to keep" />
              </SelectTrigger>
              <SelectContent>
                {mergeable.map((entity) => (
                  <SelectItem key={entity.id} value={entity.id}>
                    {entity.displayName} ({entity.entityTypeSlug})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="merge-loser">Loser</Label>
            <Select
              value={loserId}
              onValueChange={(value) => {
                setLoserId(value);
                setError(null);
                setStaleImpact(false);
              }}
              disabled={!survivor}
            >
              <SelectTrigger id="merge-loser" aria-label="Loser entity">
                <SelectValue
                  placeholder={
                    survivor
                      ? loserOptions.length > 0
                        ? "Choose the duplicate to merge away"
                        : "No other entities of this type in the current list"
                      : "Pick a survivor first"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {loserOptions.map((entity) => (
                  <SelectItem key={entity.id} value={entity.id}>
                    {entity.displayName} ({entity.entityTypeSlug})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {previewLoading ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Computing merge impact...
            </div>
          ) : null}
          {ready && previewResult.error ? (
            <p className="text-destructive text-sm" role="alert">
              Failed to preview merge impact: {previewResult.error.message}
            </p>
          ) : null}
          {preview && !previewLoading ? (
            <div className="rounded-md border p-3 text-sm">
              <p className="mb-2 font-medium">
                Merging “{loser?.displayName}” into “{survivor?.displayName}”
                will move:
              </p>
              <ul className="text-muted-foreground space-y-0.5 text-xs">
                <li>{preview.sourceMappingCount} source mappings</li>
                <li>{preview.identityClaimCount} identity claims</li>
                <li>{preview.memoryClaimCount} memory claims</li>
                <li>{preview.graphEntityCount} graph entities</li>
                {preview.loserWikiPageSlug ? (
                  <li>
                    Loser wiki page “{preview.loserWikiPageSlug}” will redirect
                    {preview.survivorWikiPageId
                      ? " to the survivor's page"
                      : ""}
                  </li>
                ) : null}
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
            disabled={!preview || previewLoading || merging || staleImpact}
            onClick={() => void confirmMerge()}
          >
            {merging ? (
              <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />
            ) : null}
            Confirm merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
