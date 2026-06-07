import { useState } from "react";
import { ExternalLink, Loader2, Save } from "lucide-react";
import { useMutation } from "urql";
import { Badge, Button } from "@thinkwork/ui";
import {
  AppletFailure,
  AppletMount,
  useAppletInstanceId,
} from "@/applets/mount";
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
