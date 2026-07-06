/**
 * Plate registry (THINK-153 U7) — the operator plate editor.
 *
 * Structured dialog (SetAppStyleDialog precedent) with a live, debounced
 * preview. Modes:
 *  - create: blank tenant plate,
 *  - clone: create a tenant plate pre-filled from an existing plate,
 *  - edit tenant: full field set + delete,
 *  - edit platform: palette overrides + hidden only (structural fields shown
 *    read-only); Reset + Hide/Unhide instead of delete.
 *
 * The preview drives `documentPlatePreview` with the unsaved draft config,
 * debounced ~500ms and sequence-guarded (see `applyPlatePreviewResult`): an
 * out-of-order earlier response never overwrites a later one, a diagnostics
 * response keeps the last-good HTML with a banner, and Save is disabled while
 * a save is pending.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useClient, useMutation } from "urql";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
} from "@thinkwork/ui";
import type { DocumentPlateDiagnostic } from "@/gql/graphql";
import {
  DeleteDocumentPlateMutation,
  DocumentPlatePreviewQuery,
  SaveDocumentPlateMutation,
} from "@/lib/graphql-queries";
import { PlatePreviewFrame } from "./PlatePreviewPanel";
import {
  applyPlatePreviewResult,
  initialPlatePreviewState,
  PLATE_DIRECTIVE_KINDS,
  PLATE_PALETTE_TOKENS,
  type PlateDirectiveKind,
  type PlateItem,
  type PlatePreviewState,
} from "./plate-support";

export type PlateEditMode =
  | { kind: "create" }
  | { kind: "clone"; source: PlateItem }
  | { kind: "edit"; plate: PlateItem };

interface PlateFormState {
  slug: string;
  displayName: string;
  useFor: string;
  eyebrow: string;
  titleSuffix: string;
  paletteLight: Record<string, string>;
  paletteDark: Record<string, string>;
  directives: Set<PlateDirectiveKind>;
  hidden: boolean;
}

function seedForm(mode: PlateEditMode): PlateFormState {
  const allDirectives = new Set<PlateDirectiveKind>(PLATE_DIRECTIVE_KINDS);
  if (mode.kind === "create") {
    return {
      slug: "",
      displayName: "",
      useFor: "",
      eyebrow: "",
      titleSuffix: "",
      paletteLight: {},
      paletteDark: {},
      directives: allDirectives,
      hidden: false,
    };
  }
  const source = mode.kind === "clone" ? mode.source : mode.plate;
  const directives =
    source.allowedDirectives == null
      ? allDirectives
      : new Set(source.allowedDirectives as PlateDirectiveKind[]);
  if (mode.kind === "clone") {
    // Capture the full resolved look so the clone matches visually; the new
    // plate owns these as its own palette.
    return {
      slug: "",
      displayName: `${source.displayName} copy`,
      useFor: source.useFor,
      eyebrow: source.eyebrow,
      titleSuffix: source.titleSuffix,
      paletteLight: { ...source.tokensLight },
      paletteDark: { ...source.tokensDark },
      directives,
      hidden: false,
    };
  }
  // edit — seed structural from resolved fields, palette from the tenant delta
  // (overrides), so the form edits the delta, not the resolved base.
  return {
    slug: source.slug,
    displayName: source.displayName,
    useFor: source.useFor,
    eyebrow: source.eyebrow,
    titleSuffix: source.titleSuffix,
    paletteLight: { ...(source.overrides?.paletteLight ?? {}) },
    paletteDark: { ...(source.overrides?.paletteDark ?? {}) },
    directives,
    hidden: source.hidden,
  };
}

function nonEmptyPalette(
  palette: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(palette)) {
    if (value.trim().length > 0) out[key] = value.trim();
  }
  return out;
}

export interface PlateEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: PlateEditMode;
  tenantId: string | null;
  /** Called after a successful save/delete so the list refetches. */
  onSaved: () => void;
}

export function PlateEditDialog({
  open,
  onOpenChange,
  mode,
  tenantId,
  onSaved,
}: PlateEditDialogProps) {
  const client = useClient();
  const [{ fetching: saving }, savePlate] = useMutation(
    SaveDocumentPlateMutation,
  );
  const [{ fetching: deleting }, deletePlate] = useMutation(
    DeleteDocumentPlateMutation,
  );

  const isPlatform = mode.kind === "edit" && mode.plate.origin === "platform";
  const isEdit = mode.kind === "edit";
  const structuralEditable = !isPlatform;

  const [form, setForm] = useState<PlateFormState>(() => seedForm(mode));
  const [diagnostics, setDiagnostics] = useState<DocumentPlateDiagnostic[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Reseed whenever the dialog opens (or the target plate changes).
  const modeKey =
    mode.kind === "create"
      ? "create"
      : mode.kind === "clone"
        ? `clone:${mode.source.slug}`
        : `edit:${mode.plate.slug}`;
  useEffect(() => {
    if (open) {
      setForm(seedForm(mode));
      setDiagnostics([]);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, modeKey]);

  const allChecked = form.directives.size === PLATE_DIRECTIVE_KINDS.length;
  const allowedDirectives = allChecked
    ? null
    : PLATE_DIRECTIVE_KINDS.filter((kind) => form.directives.has(kind));

  // Draft config for the live preview. Platform plates accept palette only —
  // sending structural fields would be rejected server-side (they're read-only
  // in this mode anyway), so omit them.
  const draftConfig = useMemo(() => {
    const paletteLight = JSON.stringify(nonEmptyPalette(form.paletteLight));
    const paletteDark = JSON.stringify(nonEmptyPalette(form.paletteDark));
    if (isPlatform) {
      return { paletteLight, paletteDark };
    }
    return {
      displayName: form.displayName || undefined,
      useFor: form.useFor || undefined,
      eyebrow: form.eyebrow || undefined,
      titleSuffix: form.titleSuffix || undefined,
      paletteLight,
      paletteDark,
      allowedDirectives,
    };
  }, [
    isPlatform,
    form.paletteLight,
    form.paletteDark,
    form.displayName,
    form.useFor,
    form.eyebrow,
    form.titleSuffix,
    allowedDirectives,
  ]);

  const previewSlug =
    form.slug || (isEdit ? (mode as { plate: PlateItem }).plate.slug : "");
  const { state: preview, pending } = usePlateLivePreview({
    client,
    tenantId,
    slug: open && previewSlug ? previewSlug : null,
    draftConfig,
  });

  function setField<K extends keyof PlateFormState>(
    key: K,
    value: PlateFormState[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  }

  function setPaletteToken(
    scheme: "paletteLight" | "paletteDark",
    token: string,
    value: string,
  ) {
    setForm((prev) => ({
      ...prev,
      [scheme]: { ...prev[scheme], [token]: value },
    }));
    setError(null);
  }

  function toggleDirective(kind: PlateDirectiveKind, checked: boolean) {
    setForm((prev) => {
      const next = new Set(prev.directives);
      if (checked) next.add(kind);
      else next.delete(kind);
      return { ...prev, directives: next };
    });
    setError(null);
  }

  async function handleSave() {
    if (!tenantId) return;
    setError(null);
    setDiagnostics([]);

    const slug = form.slug.trim();
    if (!isEdit && !slug) {
      setError("Enter a slug for the new plate.");
      return;
    }
    if (structuralEditable && !form.displayName.trim()) {
      setError("Enter a display name.");
      return;
    }
    if (structuralEditable && !form.useFor.trim()) {
      setError("Enter a “use for” description.");
      return;
    }

    const paletteLight = JSON.stringify(nonEmptyPalette(form.paletteLight));
    const paletteDark = JSON.stringify(nonEmptyPalette(form.paletteDark));

    const input = isPlatform
      ? {
          tenantId,
          slug: (mode as { plate: PlateItem }).plate.slug,
          paletteLight,
          paletteDark,
          hidden: form.hidden,
        }
      : {
          tenantId,
          slug: isEdit ? (mode as { plate: PlateItem }).plate.slug : slug,
          displayName: form.displayName.trim(),
          useFor: form.useFor.trim(),
          eyebrow: form.eyebrow.trim(),
          titleSuffix: form.titleSuffix.trim(),
          paletteLight,
          paletteDark,
          allowedDirectives,
          hidden: form.hidden,
        };

    const result = await savePlate({ input });
    if (result.error) {
      const diags = extractDiagnostics(result.error);
      if (diags.length > 0) {
        setDiagnostics(diags);
        setError("This plate has validation issues — see below.");
      } else {
        setError(result.error.message);
      }
      return;
    }
    onSaved();
    onOpenChange(false);
  }

  async function handleReset() {
    if (!tenantId || !isPlatform) return;
    setError(null);
    // Empty palettes + hidden=false resets the platform plate to defaults.
    const result = await savePlate({
      input: {
        tenantId,
        slug: (mode as { plate: PlateItem }).plate.slug,
        paletteLight: "{}",
        paletteDark: "{}",
        hidden: false,
      },
    });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    onSaved();
    onOpenChange(false);
  }

  async function handleDelete() {
    if (!tenantId || mode.kind !== "edit") return;
    setError(null);
    const result = await deletePlate({ tenantId, slug: mode.plate.slug });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    const payload = result.data?.deleteDocumentPlate;
    if (payload && !payload.ok) {
      // Server refuses tenant plates still referenced by artifacts — surface
      // the "hide instead" guidance verbatim.
      setError(payload.error ?? "This plate can't be deleted.");
      return;
    }
    onSaved();
    onOpenChange(false);
  }

  const busy = saving || deleting;
  const title =
    mode.kind === "create"
      ? "New plate"
      : mode.kind === "clone"
        ? `Clone ${mode.source.displayName}`
        : isPlatform
          ? `Edit ${mode.plate.displayName}`
          : `Edit ${mode.plate.displayName}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,860px)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Form column */}
          <div
            className="min-h-0 space-y-5 overflow-y-auto border-b border-border p-6 md:border-b-0 md:border-r"
            data-testid="plate-edit-form"
          >
            {isPlatform ? (
              <p
                className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
                data-testid="plate-platform-note"
              >
                This is a platform plate. You can override its palette and hide
                it, but its name, copy, and available components are managed by
                ThinkWork.
              </p>
            ) : null}

            <div className="space-y-3">
              {!isEdit ? (
                <Field label="Slug" htmlFor="plate-slug">
                  <Input
                    id="plate-slug"
                    value={form.slug}
                    onChange={(e) => setField("slug", e.target.value)}
                    placeholder="quarterly-report"
                    data-testid="plate-field-slug"
                  />
                </Field>
              ) : null}
              <Field label="Display name" htmlFor="plate-display-name">
                <Input
                  id="plate-display-name"
                  value={form.displayName}
                  onChange={(e) => setField("displayName", e.target.value)}
                  disabled={!structuralEditable}
                  data-testid="plate-field-display-name"
                />
              </Field>
              <Field label="Use for" htmlFor="plate-use-for">
                <Input
                  id="plate-use-for"
                  value={form.useFor}
                  onChange={(e) => setField("useFor", e.target.value)}
                  disabled={!structuralEditable}
                  placeholder="Board reports, investor updates"
                  data-testid="plate-field-use-for"
                />
              </Field>
              <Field label="Eyebrow" htmlFor="plate-eyebrow">
                <Input
                  id="plate-eyebrow"
                  value={form.eyebrow}
                  onChange={(e) => setField("eyebrow", e.target.value)}
                  disabled={!structuralEditable}
                  data-testid="plate-field-eyebrow"
                />
              </Field>
              <Field label="Title suffix" htmlFor="plate-title-suffix">
                <Input
                  id="plate-title-suffix"
                  value={form.titleSuffix}
                  onChange={(e) => setField("titleSuffix", e.target.value)}
                  disabled={!structuralEditable}
                  data-testid="plate-field-title-suffix"
                />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Available components</div>
              <div
                className="flex flex-wrap gap-4"
                data-testid="plate-directives"
              >
                {PLATE_DIRECTIVE_KINDS.map((kind) => (
                  <label key={kind} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.directives.has(kind)}
                      onCheckedChange={(checked) =>
                        toggleDirective(kind, checked === true)
                      }
                      disabled={!structuralEditable}
                      data-testid={`plate-directive-${kind}`}
                    />
                    {kind}
                  </label>
                ))}
              </div>
              {allChecked ? (
                <p className="text-xs text-muted-foreground">
                  All components available to documents in this plate.
                </p>
              ) : null}
            </div>

            <PaletteEditor
              paletteLight={form.paletteLight}
              paletteDark={form.paletteDark}
              onChange={setPaletteToken}
            />

            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.hidden}
                onCheckedChange={(checked) => setField("hidden", checked)}
                data-testid="plate-field-hidden"
              />
              Hidden (agents can&apos;t pick this plate)
            </label>

            {error ? (
              <p
                className="text-sm text-destructive"
                data-testid="plate-edit-error"
              >
                {error}
              </p>
            ) : null}

            {diagnostics.length > 0 ? (
              <div
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                data-testid="plate-edit-diagnostics"
              >
                <ul className="list-disc pl-4">
                  {diagnostics.map((d, i) => (
                    <li key={`${d.code}-${i}`}>{d.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {/* Live preview column */}
          <div className="min-h-0 overflow-hidden p-6">
            <PlatePreviewFrame
              title={form.displayName || previewSlug || "Preview"}
              slug={previewSlug || null}
              html={preview.html}
              diagnostics={preview.diagnostics}
              pending={pending}
              className="h-full rounded-lg border border-border"
            />
          </div>
        </div>

        {/* The DialogFooter base assumes a p-4 DialogContent and offsets with
            -mx-4/-mb-4; this dialog is p-0, so neutralize the offsets or the
            footer buttons sit flush against the dialog edge. */}
        <DialogFooter className="mx-0 mb-0 flex-wrap gap-2 border-t border-border px-6 py-4">
          {isPlatform ? (
            <div className="mr-auto flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void handleReset()}
                data-testid="plate-reset"
              >
                Reset to default
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void (async () => {
                    setField("hidden", !form.hidden);
                  })()
                }
                data-testid="plate-toggle-hidden"
              >
                {form.hidden ? "Unhide" : "Hide"}
              </Button>
            </div>
          ) : isEdit ? (
            <Button
              type="button"
              variant="outline"
              className="mr-auto text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => void handleDelete()}
              data-testid="plate-delete"
            >
              Delete
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || !tenantId}
            onClick={() => void handleSave()}
            data-testid="plate-save"
          >
            {saving ? "Saving…" : "Save plate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export function PaletteEditor({
  paletteLight,
  paletteDark,
  onChange,
}: {
  paletteLight: Record<string, string>;
  paletteDark: Record<string, string>;
  onChange: (
    scheme: "paletteLight" | "paletteDark",
    token: string,
    value: string,
  ) => void;
}) {
  return (
    <div className="space-y-2" data-testid="plate-palette">
      <div className="text-sm font-medium">Palette overrides</div>
      <p className="text-xs text-muted-foreground">
        Leave a token blank to inherit the tenant palette. Only these tokens are
        available.
      </p>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-xs">
        <div />
        <div className="font-medium text-muted-foreground">Light</div>
        <div className="font-medium text-muted-foreground">Dark</div>
        {PLATE_PALETTE_TOKENS.map((token) => (
          <PaletteRow
            key={token}
            token={token}
            light={paletteLight[token] ?? ""}
            dark={paletteDark[token] ?? ""}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  );
}

function toHex(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : "#000000";
}

function PaletteRow({
  token,
  light,
  dark,
  onChange,
}: {
  token: string;
  light: string;
  dark: string;
  onChange: (
    scheme: "paletteLight" | "paletteDark",
    token: string,
    value: string,
  ) => void;
}) {
  return (
    <>
      <code className="font-mono text-[11px] text-muted-foreground">
        {token}
      </code>
      <PaletteInput
        value={light}
        onChange={(value) => onChange("paletteLight", token, value)}
        testId={`plate-token-light-${token}`}
      />
      <PaletteInput
        value={dark}
        onChange={(value) => onChange("paletteDark", token, value)}
        testId={`plate-token-dark-${token}`}
      />
    </>
  );
}

function PaletteInput({
  value,
  onChange,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  testId: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={toHex(value)}
        onChange={(e) => onChange(e.target.value)}
        className="size-7 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
        aria-label={`${testId} color`}
        data-testid={`${testId}-color`}
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="inherit"
        className="h-8 font-mono text-xs"
        data-testid={testId}
      />
    </div>
  );
}

// ─── Live preview (debounced + sequence-guarded) ──────────────────────────

interface UsePlateLivePreviewArgs {
  client: ReturnType<typeof useClient>;
  tenantId: string | null;
  slug: string | null;
  draftConfig: Record<string, unknown>;
}

function usePlateLivePreview({
  client,
  tenantId,
  slug,
  draftConfig,
}: UsePlateLivePreviewArgs): {
  state: PlatePreviewState;
  pending: boolean;
} {
  const [state, setState] = useState<PlatePreviewState>(
    initialPlatePreviewState,
  );
  const [pending, setPending] = useState(false);
  const requestIdRef = useRef(0);

  // Stable key so the effect only re-fires when the request actually changes.
  const key = JSON.stringify({ tenantId, slug, draftConfig });

  useEffect(() => {
    if (!slug) {
      setState(initialPlatePreviewState);
      setPending(false);
      return;
    }
    const handle = setTimeout(() => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setPending(true);
      void client
        .query(
          DocumentPlatePreviewQuery,
          { tenantId, slug, draftConfig },
          { requestPolicy: "network-only" },
        )
        .toPromise()
        .then((result) => {
          const preview = result.data?.documentPlatePreview;
          const diagnostics: DocumentPlateDiagnostic[] =
            preview?.diagnostics ??
            (result.error
              ? [{ code: "ERROR", message: result.error.message }]
              : []);
          setState((prev) =>
            applyPlatePreviewResult(prev, {
              requestId,
              html: preview?.html ?? null,
              diagnostics,
            }),
          );
        })
        .finally(() => {
          // Only the latest request clears the pending indicator.
          if (requestId === requestIdRef.current) setPending(false);
        });
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { state, pending };
}

function extractDiagnostics(error: unknown): DocumentPlateDiagnostic[] {
  if (!error || typeof error !== "object") return [];
  const graphQLErrors = (error as { graphQLErrors?: unknown[] }).graphQLErrors;
  if (!Array.isArray(graphQLErrors)) return [];
  for (const gqlError of graphQLErrors) {
    const extensions = (gqlError as { extensions?: Record<string, unknown> })
      ?.extensions;
    if (extensions?.code === "PLATE_VALIDATION_FAILED") {
      const diags = extensions.diagnostics;
      if (Array.isArray(diags)) {
        return diags
          .filter(
            (d): d is DocumentPlateDiagnostic =>
              !!d &&
              typeof d === "object" &&
              typeof (d as DocumentPlateDiagnostic).message === "string",
          )
          .map((d) => ({
            code: (d as DocumentPlateDiagnostic).code ?? "VALIDATION",
            message: (d as DocumentPlateDiagnostic).message,
          }));
      }
    }
  }
  return [];
}
