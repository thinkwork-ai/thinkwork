/**
 * Plate registry (THINK-153 U7) — tenant-wide document palette editor.
 *
 * The same palette form (light/dark columns over the token vocabulary) minus
 * plate-specific fields. Reads `tenantDocumentPalette`, writes
 * `updateTenantDocumentPalette`. Operator-gated by the caller. No live preview:
 * the tenant palette is the base every plate resolves against, so previewing an
 * unsaved palette would require a plate context the compositor doesn't expose
 * pre-save (spec: skipping is acceptable).
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "urql";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@thinkwork/ui";
import {
  TenantDocumentPaletteQuery,
  UpdateTenantDocumentPaletteMutation,
} from "@/lib/graphql-queries";
import { PaletteEditor } from "./PlateEditDialog";

interface PaletteData {
  tenantDocumentPalette?: { light: string; dark: string } | null;
}

function parsePalette(value: string | undefined): Record<string, string> {
  if (typeof value !== "string" || value.length === 0) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [key, raw] of Object.entries(parsed)) {
        if (typeof raw === "string") out[key] = raw;
      }
      return out;
    }
  } catch {
    // fall through
  }
  return {};
}

function nonEmpty(palette: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(palette)) {
    if (value.trim().length > 0) out[key] = value.trim();
  }
  return out;
}

export interface TenantPaletteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  onSaved?: () => void;
}

export function TenantPaletteDialog({
  open,
  onOpenChange,
  tenantId,
  onSaved,
}: TenantPaletteDialogProps) {
  const [{ data, fetching }, refetch] = useQuery<PaletteData>({
    query: TenantDocumentPaletteQuery,
    variables: { tenantId },
    pause: !open || !tenantId,
  });
  const [{ fetching: saving }, updatePalette] = useMutation(
    UpdateTenantDocumentPaletteMutation,
  );

  const savedLight = useMemo(
    () => parsePalette(data?.tenantDocumentPalette?.light),
    [data?.tenantDocumentPalette?.light],
  );
  const savedDark = useMemo(
    () => parsePalette(data?.tenantDocumentPalette?.dark),
    [data?.tenantDocumentPalette?.dark],
  );

  const [light, setLight] = useState<Record<string, string>>(savedLight);
  const [dark, setDark] = useState<Record<string, string>>(savedDark);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLight(savedLight);
      setDark(savedDark);
      setError(null);
    }
  }, [open, savedLight, savedDark]);

  function handleChange(
    scheme: "paletteLight" | "paletteDark",
    token: string,
    value: string,
  ) {
    setError(null);
    if (scheme === "paletteLight") {
      setLight((prev) => ({ ...prev, [token]: value }));
    } else {
      setDark((prev) => ({ ...prev, [token]: value }));
    }
  }

  async function handleSave() {
    if (!tenantId) return;
    setError(null);
    const result = await updatePalette({
      input: {
        tenantId,
        light: JSON.stringify(nonEmpty(light)),
        dark: JSON.stringify(nonEmpty(dark)),
      },
    });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    refetch({ requestPolicy: "network-only" });
    onSaved?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,760px)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Tenant document palette</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <p className="text-sm text-muted-foreground">
            The base palette every document plate resolves against. Individual
            plates can override these tokens.
          </p>
          {fetching ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="tenant-palette-loading"
            >
              Loading palette…
            </p>
          ) : (
            <PaletteEditor
              paletteLight={light}
              paletteDark={dark}
              onChange={handleChange}
            />
          )}
          {error ? (
            <p
              className="text-sm text-destructive"
              data-testid="tenant-palette-error"
            >
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving || !tenantId}
            onClick={() => void handleSave()}
            data-testid="tenant-palette-save"
          >
            {saving ? "Saving…" : "Save palette"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
