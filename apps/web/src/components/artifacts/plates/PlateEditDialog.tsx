/**
 * Plate registry (THINK-153 U7) — the operator plate editor.
 *
 * Structured dialog (SetAppStyleDialog precedent). Modes:
 *  - create: blank tenant plate,
 *  - clone: create a tenant plate pre-filled from an existing plate,
 *  - edit tenant: full field set + delete,
 *  - edit platform: palette overrides + hidden only (structural fields shown
 *    read-only); Reset + Hide/Unhide instead of delete.
 *
 * Slug and display name sit above the Content/Style tabs — they're required
 * on create/clone, so they must be visible regardless of the active tab.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@thinkwork/ui";
import type { DocumentPlateDiagnostic } from "@/gql/graphql";
import {
  DeleteDocumentPlateMutation,
  PlateConformanceQuery,
  SaveDocumentPlateMutation,
} from "@/lib/graphql-queries";
import { parseConformanceSummary } from "./PlateConformancePanel";
import { PlateContentTab } from "./PlateContentTab";
import {
  analysisRowsFromContract,
  buildContractPayload,
  duplicateSectionRowKeys,
  PLATE_DIRECTIVE_KINDS,
  PLATE_PALETTE_TOKENS,
  sectionRowsFromContract,
  type AnalysisRowState,
  type PlateDirectiveKind,
  type PlateItem,
  type SectionRowState,
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
  /** Content contract rows (THINK-188): floor + additions, editor order. */
  sections: SectionRowState[];
  analysesRows: AnalysisRowState[];
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
      sections: [],
      analysesRows: [],
    };
  }
  const source = mode.kind === "clone" ? mode.source : mode.plate;
  const directives =
    source.allowedDirectives == null
      ? allDirectives
      : new Set(source.allowedDirectives as PlateDirectiveKind[]);
  if (mode.kind === "clone") {
    // Capture the full resolved look so the clone matches visually; the new
    // plate owns these as its own palette — and owns the source's resolved
    // contract outright (a tenant plate has no floor).
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
      sections: sectionRowsFromContract(source.sections, true),
      analysesRows: analysisRowsFromContract(source.analyses, true),
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
    // Full ownership on edit: every contract row is editable — renamable,
    // reorderable, removable — regardless of origin. Saving a platform plate
    // sends the whole contract with ownContract: true; Reset restores the
    // platform definition.
    sections: sectionRowsFromContract(source.sections, true),
    analysesRows: analysisRowsFromContract(source.analyses, true),
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

  // THINK-189 R8: measured section stats for existing plates (edit mode
  // only — new/cloned plates have no corpus). Display-only evidence.
  const [conformanceResult] = useQuery<{ plateConformance?: unknown }>({
    query: PlateConformanceQuery,
    variables: {
      tenantId,
      slug: isEdit ? (mode as { plate: PlateItem }).plate.slug : "",
    },
    requestPolicy: "cache-and-network",
    pause: !open || !isEdit,
  });
  const measuredBySection = useMemo(() => {
    const summary = parseConformanceSummary(
      conformanceResult.data?.plateConformance ?? null,
    );
    if (!summary || summary.reportCount === 0) return null;
    return Object.fromEntries(summary.sections.map((s) => [s.sectionId, s]));
  }, [conformanceResult.data]);

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
    if (
      form.sections.some((row) => row.source === "tenant" && !row.title.trim())
    ) {
      setError("Every section needs a title.");
      return;
    }
    if (duplicateSectionRowKeys(form.sections).size > 0) {
      setError("Section titles must be unique — see the flagged rows.");
      return;
    }
    const tenantAnalyses = form.analysesRows.filter(
      (a) => a.source === "tenant",
    );
    if (tenantAnalyses.some((a) => !a.key)) {
      setError("Every analysis needs a name.");
      return;
    }
    if (
      new Set(tenantAnalyses.map((a) => a.key)).size !== tenantAnalyses.length
    ) {
      setError("Analysis names must be unique.");
      return;
    }

    const paletteLight = JSON.stringify(nonEmptyPalette(form.paletteLight));
    const paletteDark = JSON.stringify(nonEmptyPalette(form.paletteDark));
    // Wipe guard (THINK-188): the save ALWAYS carries the full current
    // contract state — the server rebuilds row config from this input, so a
    // style-only save that omitted it would delete stored contract deltas.
    // Rows are all tenant-owned in the editor (full ownership on edit), so
    // the payload is always the full contract; platform saves flag it with
    // ownContract so the server stores it verbatim instead of floor-merging.
    const contract = buildContractPayload(
      form.sections,
      form.analysesRows,
      false,
    );

    const input = isPlatform
      ? {
          tenantId,
          slug: (mode as { plate: PlateItem }).plate.slug,
          paletteLight,
          paletteDark,
          hidden: form.hidden,
          ownContract: true,
          ...contract,
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
          ...contract,
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
      <DialogContent className="max-h-[min(92vh,860px)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-1 gap-0 overflow-hidden">
          {/* Form column: identity fields above the Style | Content tabs
              (THINK-188 U5) — slug/name are required on create/clone, so they
              stay visible regardless of the active tab. */}
          <div
            className="min-h-0 space-y-4 overflow-y-auto p-6"
            data-testid="plate-edit-form"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            </div>

            <Tabs defaultValue="content">
              <TabsList
                variant="line"
                className="w-full justify-start border-b"
              >
                <TabsTrigger
                  value="content"
                  className="flex-none px-3"
                  data-testid="plate-tab-content"
                >
                  Content
                </TabsTrigger>
                <TabsTrigger
                  value="style"
                  className="flex-none px-3"
                  data-testid="plate-tab-style"
                >
                  Style
                </TabsTrigger>
              </TabsList>
              <TabsContent value="style" className="mt-4 space-y-5">
                {isPlatform ? (
                  <p
                    className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
                    data-testid="plate-platform-note"
                  >
                    This is a platform plate. You can override its palette and
                    hide it, but its name, copy, and available components are
                    managed by ThinkWork.
                  </p>
                ) : null}

                <div className="space-y-3">
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
                  <div className="text-sm font-medium">
                    Available components
                  </div>
                  <div
                    className="flex flex-wrap gap-4"
                    data-testid="plate-directives"
                  >
                    {PLATE_DIRECTIVE_KINDS.map((kind) => (
                      <label
                        key={kind}
                        className="flex items-center gap-2 text-sm"
                      >
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
              </TabsContent>
              <TabsContent value="content" className="mt-4">
                <PlateContentTab
                  sections={form.sections}
                  analyses={form.analysesRows}
                  isPlatform={isPlatform}
                  allowedDirectives={allowedDirectives}
                  measured={measuredBySection}
                  onSectionsChange={(rows) => setField("sections", rows)}
                  onAnalysesChange={(rows) => setField("analysesRows", rows)}
                />
              </TabsContent>
            </Tabs>

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
