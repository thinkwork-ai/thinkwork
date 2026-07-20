import { useState } from "react";
import { useMutation } from "urql";
import { Loader2 } from "lucide-react";
import {
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
import { SettingsAuthorEntitySourceMappingMutation } from "@/lib/settings-queries";
import type { CanonicalEntityRow } from "./IdentityList";

const REFUSAL_MESSAGES: Record<string, string> = {
  entity_not_found: "This canonical entity no longer exists.",
  entity_not_active: "Only active entities can receive new mappings.",
  invalid_input: "Source system and external id are required.",
};

/**
 * Crosswalk link authoring (THINK-321 U8, R12): bind a source-system record
 * to a canonical entity by hand. The server writes the mapping with
 * created_by='operator' plus a `link` audit event; a source identity that
 * is already linked (possibly to another entity) comes back as a typed
 * already_linked refusal — revoke the existing link first if it is wrong.
 */
export function AuthorMappingDialog({
  open,
  onOpenChange,
  tenantId,
  entity,
  onAuthored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  entity: CanonicalEntityRow | null;
  onAuthored: () => void;
}) {
  const [sourceSystem, setSourceSystem] = useState("");
  const [namespace, setNamespace] = useState("");
  const [externalId, setExternalId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [, authorMapping] = useMutation(
    SettingsAuthorEntitySourceMappingMutation,
  );

  const reset = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSourceSystem("");
      setNamespace("");
      setExternalId("");
      setError(null);
    }
    onOpenChange(nextOpen);
  };

  const submit = async () => {
    if (!entity || !sourceSystem.trim() || !externalId.trim() || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await authorMapping({
        tenantId,
        canonicalEntityId: entity.id,
        sourceSystem: sourceSystem.trim(),
        namespace: namespace.trim() || null,
        externalId: externalId.trim(),
      });
      if (result.error) {
        setError(result.error.message);
        return;
      }
      const payload = result.data?.authorEntitySourceMapping;
      if (payload?.status === "already_linked") {
        setError(
          "That source record is already linked to a canonical entity. Revoke the existing mapping first if it is wrong.",
        );
        return;
      }
      if (payload?.status === "refused") {
        setError(
          REFUSAL_MESSAGES[payload.reason ?? ""] ??
            `Mapping refused: ${payload.reason ?? "unknown reason"}`,
        );
        return;
      }
      onAuthored();
      reset(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add source mapping</DialogTitle>
          <DialogDescription>
            Bind a source-system record to “{entity?.displayName}”. The link is
            recorded as operator-authored in the audit trail.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="author-source-system">Source system</Label>
            <Input
              id="author-source-system"
              value={sourceSystem}
              onChange={(event) => setSourceSystem(event.target.value)}
              placeholder="e.g. lastmile, twenty"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="author-namespace">Namespace (optional)</Label>
            <Input
              id="author-namespace"
              value={namespace}
              onChange={(event) => setNamespace(event.target.value)}
              placeholder="Sub-namespace inside the source system"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="author-external-id">External id</Label>
            <Input
              id="author-external-id"
              value={externalId}
              onChange={(event) => setExternalId(event.target.value)}
              placeholder="The record's id in the source system"
            />
          </div>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => reset(false)}>
            Cancel
          </Button>
          <Button
            disabled={!sourceSystem.trim() || !externalId.trim() || saving}
            onClick={() => void submit()}
          >
            {saving ? (
              <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />
            ) : null}
            Add mapping
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
