import { Badge } from "@thinkwork/ui";
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

interface DraftAppPreviewOutput {
  type?: string;
  draft?: {
    draftId?: string;
    unsaved?: boolean;
    name?: string;
    files?: Record<string, string>;
    sourceDigest?: string;
    validation?: {
      ok?: boolean;
      status?: string;
      errors?: Array<{ code?: string; message?: string }>;
    };
    dataProvenance?: {
      status?: string;
      notes?: string[];
    };
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
  const source =
    draft?.files && typeof draft.files["App.tsx"] === "string"
      ? draft.files["App.tsx"]
      : "";
  const validation = draft?.validation;
  const errors = validation?.errors ?? [];
  const canMount = Boolean(source.trim()) && validation?.ok !== false;
  const logs = errors.map((error) => ({
    level: "error" as const,
    message:
      [error.code, error.message].filter(Boolean).join(": ") ||
      "Draft preview validation failed.",
    timestamp: new Date(0),
  }));

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
      </WebPreviewNavigation>
      {draft?.dataProvenance?.notes?.length ? (
        <div className="border-b bg-background px-3 py-2 text-xs text-muted-foreground">
          {draft.dataProvenance.notes.slice(0, 2).join(" ")}
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
