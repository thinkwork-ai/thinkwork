import { useState } from "react";
import { ExternalLink, Loader2, Palette, Save, Upload } from "lucide-react";
import { useMutation } from "urql";
import { Badge, Button, Textarea } from "@thinkwork/ui";
import {
  AppletFailure,
  AppletMount,
  useAppletInstanceId,
} from "@/applets/mount";
import {
  appletThemeCssFromMetadata,
  buildAppletTheme,
} from "@/applets/theme-tokens";
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewConsole,
  WebPreviewNavigation,
} from "@/components/ai-elements/web-preview";
import { PromoteDraftAppletMutation } from "@/lib/graphql-queries";

interface DraftAppPreviewOutput {
  type?: string;
  draft?: {
    draftId?: string;
    unsaved?: boolean;
    computerId?: string;
    name?: string;
    files?: Record<string, string>;
    metadata?: Record<string, unknown>;
    sourceDigest?: string;
    promotionProof?: string | null;
    promotionProofExpiresAt?: string | null;
    validation?: {
      ok?: boolean;
      status?: string;
      errors?: Array<{ code?: string; message?: string }>;
    };
    dataProvenance?: {
      status?: string;
      notes?: string[];
    };
    shadcnProvenance?: Record<string, unknown>;
  };
}

interface DraftAppletPreviewProps {
  output: unknown;
}

export function DraftAppletPreview({ output }: DraftAppletPreviewProps) {
  const payload = draftPreviewOutput(output);
  const draft = payload?.draft;
  const draftId = draft?.draftId ?? "draft";
  const instanceId = useAppletInstanceId(draftId);
  const [, promoteDraftApplet] = useMutation(PromoteDraftAppletMutation);
  const [saving, setSaving] = useState(false);
  const [savedAppId, setSavedAppId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  const [themeInput, setThemeInput] = useState("");
  const [themeError, setThemeError] = useState<string | null>(null);
  const [uploadedThemeCss, setUploadedThemeCss] = useState<string | null>(null);
  const metadataThemeCss = appletThemeCssFromMetadata(draft?.metadata);
  const activeThemeCss = uploadedThemeCss ?? metadataThemeCss;
  const source =
    draft?.files && typeof draft.files["App.tsx"] === "string"
      ? draft.files["App.tsx"]
      : "";
  const validation = draft?.validation;
  const errors = validation?.errors ?? [];
  const canMount = Boolean(source.trim()) && validation?.ok !== false;
  const canPromote =
    canMount &&
    !savedAppId &&
    Boolean(
      draft?.draftId &&
      draft.computerId &&
      draft.sourceDigest &&
      draft.promotionProof &&
      draft.promotionProofExpiresAt &&
      draft.metadata &&
      typeof draft.metadata.threadId === "string" &&
      draft.metadata.threadId.trim(),
    );
  const logs = errors.map((error) => ({
    level: "error" as const,
    message:
      [error.code, error.message].filter(Boolean).join(": ") ||
      "Draft preview validation failed.",
    timestamp: new Date(0),
  }));

  async function handleSave() {
    if (!draft || !canPromote) return;
    const appletTheme = activeThemeCss
      ? buildAppletTheme(activeThemeCss)
      : null;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await promoteDraftApplet({
        input: {
          draftId: draft.draftId,
          computerId: draft.computerId,
          threadId: draft.metadata?.threadId,
          name: draft.name ?? "Generated app preview",
          files: draft.files,
          metadata: {
            ...draft.metadata,
            dataProvenance: draft.dataProvenance,
            shadcnProvenance: draft.shadcnProvenance,
            ...(appletTheme ? { appletTheme } : {}),
          },
          sourceDigest: draft.sourceDigest,
          promotionProof: draft.promotionProof,
          promotionProofExpiresAt: draft.promotionProofExpiresAt,
        },
      });
      const payload = result.data?.promoteDraftApplet;
      if (result.error || !payload?.ok || !payload.appId) {
        setSaveError(
          payload?.errors?.[0]?.message ??
            result.error?.message ??
            "Could not save this draft preview.",
        );
        return;
      }
      setSavedAppId(payload.appId);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Could not save draft.",
      );
    } finally {
      setSaving(false);
    }
  }

  function applyThemeCss(nextCss: string) {
    const appletTheme = buildAppletTheme(nextCss);
    if (!appletTheme) {
      setThemeError(
        "Paste the globals.css theme block from shadcn Create, including :root or .dark variables.",
      );
      return;
    }
    setUploadedThemeCss(appletTheme.css);
    setThemeInput(appletTheme.css);
    setThemeError(null);
  }

  async function handleThemeFile(file: File | undefined) {
    if (!file) return;
    try {
      applyThemeCss(await file.text());
    } catch {
      setThemeError("Could not read that theme file.");
    }
  }

  return (
    <WebPreview
      className="my-3 min-h-[460px] overflow-hidden rounded-md border-border/70 bg-background shadow-none"
      data-testid="draft-applet-preview"
      defaultUrl={`draft://${draftId}`}
    >
      <WebPreviewNavigation className="min-h-11 justify-between gap-3 bg-muted/30 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="secondary" className="rounded-md">
            Draft
          </Badge>
          <Badge variant="outline" className="rounded-md">
            Unsaved
          </Badge>
          <span className="truncate text-sm font-medium">
            {draft?.name ?? "Generated app preview"}
          </span>
        </div>
        {draft?.dataProvenance?.status ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {draft.dataProvenance.status}
          </span>
        ) : null}
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={activeThemeCss ? "secondary" : "ghost"}
            className="gap-2"
            onClick={() => setThemeEditorOpen((value) => !value)}
          >
            <Palette className="size-4" />
            Theme
          </Button>
          {savedAppId ? (
            <Button asChild size="sm" variant="secondary" className="gap-2">
              <a href={`/artifacts/${savedAppId}`}>
                <ExternalLink className="size-4" />
                Open saved
              </a>
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="gap-2"
              disabled={!canPromote || saving}
              onClick={() => void handleSave()}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save
            </Button>
          )}
        </div>
      </WebPreviewNavigation>
      {draft?.dataProvenance?.notes?.length ? (
        <div className="border-b bg-background px-3 py-2 text-xs text-muted-foreground">
          {draft.dataProvenance.notes.slice(0, 2).join(" ")}
        </div>
      ) : null}
      {themeEditorOpen ? (
        <div className="space-y-3 border-b bg-background px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              Paste or upload the Theme code copied from shadcn Create.
            </div>
            <label>
              <input
                type="file"
                accept=".css,text/css,text/plain"
                className="sr-only"
                onChange={(event) =>
                  void handleThemeFile(event.currentTarget.files?.[0])
                }
              />
              <span className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent hover:text-accent-foreground">
                <Upload className="size-3.5" />
                Upload CSS
              </span>
            </label>
          </div>
          <Textarea
            value={themeInput}
            onChange={(event) => setThemeInput(event.currentTarget.value)}
            placeholder=":root { --background: oklch(...); --chart-1: oklch(...); }"
            className="min-h-32 font-mono text-xs"
          />
          {themeError ? (
            <div className="text-xs text-destructive" role="alert">
              {themeError}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {activeThemeCss
                ? "Theme tokens are applied to this preview."
                : ""}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setUploadedThemeCss(null);
                  setThemeInput("");
                  setThemeError(null);
                }}
              >
                Clear
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => applyThemeCss(themeInput)}
              >
                Apply Theme
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {saveError ? (
        <div
          className="border-b bg-destructive/10 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {saveError}
        </div>
      ) : null}
      <WebPreviewBody className="min-h-[380px] bg-background">
        {canMount ? (
          <AppletMount
            appId={draftId}
            instanceId={instanceId}
            source={source}
            version={1}
            hideRefreshControl
            fitContentHeight
            themeCss={activeThemeCss}
          />
        ) : (
          <AppletFailure>
            {errors[0]?.message ??
              "This draft preview does not include mountable App.tsx source."}
          </AppletFailure>
        )}
      </WebPreviewBody>
      <WebPreviewConsole logs={logs} />
    </WebPreview>
  );
}

export function isDraftAppPreviewOutput(
  output: unknown,
): output is DraftAppPreviewOutput {
  return Boolean(draftPreviewOutput(output));
}

function draftPreviewOutput(output: unknown): DraftAppPreviewOutput | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }
  const value = output as DraftAppPreviewOutput;
  if (value.type !== "draft_app_preview") return null;
  if (!value.draft || typeof value.draft !== "object") return null;
  return value;
}
