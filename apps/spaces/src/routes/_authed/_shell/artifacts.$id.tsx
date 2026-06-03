import { createFileRoute } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { javascript } from "@codemirror/lang-javascript";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import CodeMirror from "@uiw/react-codemirror";
import { Braces, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { Button, cn } from "@thinkwork/ui";
import {
  AppletFailure,
  AppletLoading,
  AppletMount,
  appletSource,
  useAppletInstanceId,
} from "@/applets/mount";
import { AppArtifactSplitShell } from "@/components/apps/AppArtifactSplitShell";
import { ArtifactDetailActions } from "@/components/artifacts/ArtifactDetailActions";
import { PinToggleButton } from "@/components/artifacts/PinToggleButton";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { AdminUpdateAppletSourceMutation } from "@/lib/applet-admin-queries";
import {
  appletThemeCss,
  resolveGeneratedAppRuntimeMode,
  type AppletPayload,
  type AppletPreviewNode,
} from "@/lib/app-artifacts";
import { AppletQuery } from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_shell/artifacts/$id")({
  component: AppArtifactPage,
});

interface AppletResult {
  applet?: AppletPayload | null;
}

function AppArtifactPage() {
  const { id } = Route.useParams();
  return <AppletRouteContent appId={id} />;
}

export function AppletRouteContent({ appId }: { appId: string }) {
  const [{ data, fetching, error }, reexecuteAppletQuery] =
    useQuery<AppletResult>({
      query: AppletQuery,
      variables: { appId },
      requestPolicy: "cache-and-network",
    });
  const applet = data?.applet ?? null;
  // Operator-only Source/Config tabs. The detail route itself is NOT
  // OperatorGuard-wrapped — non-operators must still reach the artifact; only
  // the extra tabs are gated. Server re-enforces requireTenantAdmin on save.
  const { isOperator, roleResolved } = useTenant();
  const operator = roleResolved && isOperator;
  const title = applet?.applet?.name?.trim() || "Artifact";
  const source = useMemo(() => appletSource(applet), [applet]);
  const runtimeMode = resolveGeneratedAppRuntimeMode(applet?.metadata);
  const themeCss = appletThemeCss(applet);
  const latestVersion = applet?.applet?.version ?? null;
  const artifactId = applet?.applet?.artifact?.id ?? null;
  const favoritedAt = applet?.applet?.artifact?.favoritedAt ?? null;
  const instanceId = useAppletInstanceId(appId);
  const [mountedSnapshot, setMountedSnapshot] = useState<{
    appId: string;
    instanceId: string;
    source: string;
    version: number;
    themeCss: string | null;
  } | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [headerAction, setHeaderAction] = useState<ReactNode>(null);
  const handleHeaderActionChange = useCallback((action: ReactNode | null) => {
    setHeaderAction(action);
  }, []);

  // Compose the page-header action slot: any applet-defined action
  // (rendered by AppletMount) plus the artifact-management dropdown on
  // the far right. Hide the dropdown until we know the underlying
  // artifact id — the delete mutation needs it.
  const composedHeaderAction = useMemo<ReactNode>(() => {
    const detailActions = artifactId ? (
      <ArtifactDetailActions artifactId={artifactId} artifactTitle={title} />
    ) : null;
    if (!headerAction && !detailActions) return null;
    return (
      <div className="flex items-center gap-1">
        {headerAction}
        {detailActions}
      </div>
    );
  }, [artifactId, headerAction, title]);

  const titleTrailing = useMemo<ReactNode>(() => {
    if (!artifactId) return null;
    return (
      <PinToggleButton
        artifactId={artifactId}
        favoritedAt={favoritedAt}
        testId="artifact-header-pin-toggle"
      />
    );
  }, [artifactId, favoritedAt]);

  usePageHeaderActions({
    title,
    backHref: "/artifacts",
    backBehavior: "history",
    action: composedHeaderAction,
    titleTrailing,
    actionKey: composedHeaderAction
      ? `artifact-actions:${artifactId ?? "_"}:${favoritedAt ?? "_"}:${headerAction ? "1" : "0"}`
      : "",
  });

  useEffect(() => {
    const interval = window.setInterval(() => {
      reexecuteAppletQuery({ requestPolicy: "network-only" });
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [reexecuteAppletQuery]);

  useEffect(() => {
    if (!source) return;
    setHeaderAction(null);
    setMountedSnapshot((current) => {
      if (current?.appId === appId && current.themeCss === themeCss) {
        return current;
      }
      return {
        appId,
        instanceId,
        source,
        version: latestVersion ?? 1,
        themeCss,
      };
    });
  }, [appId, instanceId, latestVersion, source, themeCss]);

  if (!applet) {
    return (
      <main className="flex h-svh items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          {fetching
            ? "Loading artifact..."
            : error?.message || "Artifact not found."}
        </p>
      </main>
    );
  }

  if (!source) {
    return (
      <AppArtifactSplitShell title={title} runtimeMode={runtimeMode}>
        <AppletFailure>
          This artifact does not include a source file that can be mounted.
        </AppletFailure>
      </AppArtifactSplitShell>
    );
  }

  const hasNewerVersion =
    typeof latestVersion === "number" &&
    typeof mountedSnapshot?.version === "number" &&
    latestVersion > mountedSnapshot.version;

  const appPanel = (
    <div className="grid h-full min-h-0 min-w-0 p-4">
      {hasNewerVersion ? (
        <div className="m-4 flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-primary">
            A newer version of this artifact is available.
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="justify-self-start"
            onClick={() => {
              if (source) {
                setMountedSnapshot({
                  appId,
                  instanceId,
                  source,
                  version: latestVersion ?? 1,
                  themeCss,
                });
              }
              setReloadNonce((value) => value + 1);
            }}
          >
            <RefreshCw className="mr-2 size-4" />
            Reload
          </Button>
        </div>
      ) : null}
      {mountedSnapshot ? (
        <AppletMount
          key={`${mountedSnapshot.appId}:${mountedSnapshot.version}:${reloadNonce}`}
          appId={mountedSnapshot.appId}
          instanceId={mountedSnapshot.instanceId}
          source={mountedSnapshot.source}
          version={mountedSnapshot.version}
          onHeaderActionChange={handleHeaderActionChange}
          themeCss={mountedSnapshot.themeCss}
          // Size the iframe to its reported content height so the only
          // scrollbar lives on the surrounding AppCanvasPanel (which has
          // `overflow-y-auto`). With the default `fitContentHeight=false`
          // the iframe sizes to 100% of its parent and renders its own
          // inner scrollbar, stacking against the panel's scrollbar.
          // DraftAppletPreview and InlineAppletEmbed already use this mode;
          // saved-app side panels were missed before.
          fitContentHeight={true}
        />
      ) : (
        <AppletLoading />
      )}
    </div>
  );

  return (
    <AppArtifactSplitShell title={title} runtimeMode={runtimeMode}>
      {operator ? (
        <OperatorAppletTabs
          appId={appId}
          persistedSource={source}
          metadata={applet.metadata}
          preview={applet.applet ?? null}
          reexecuteAppletQuery={reexecuteAppletQuery}
        >
          {appPanel}
        </OperatorAppletTabs>
      ) : (
        appPanel
      )}
    </AppArtifactSplitShell>
  );
}

const APPLET_TABS = [
  { value: "app", label: "App" },
  { value: "source", label: "Source" },
  { value: "config", label: "Config" },
] as const;

type AppletTabValue = (typeof APPLET_TABS)[number]["value"];

// Operator-only Source/Config inspector wrapping the live App preview. Gated
// in the parent on `roleResolved && isOperator`; the save mutation re-enforces
// `requireTenantAdmin` server-side so a forced UI gains nothing. Uses plain
// buttons (not Radix Tabs) for tab switching — Radix Tabs crashed here under a
// duplicated-React dev dep cache, and plain buttons avoid that hook path.
function OperatorAppletTabs({
  appId,
  persistedSource,
  metadata,
  preview,
  reexecuteAppletQuery,
  children,
}: {
  appId: string;
  persistedSource: string;
  metadata: unknown;
  preview: AppletPreviewNode | null;
  reexecuteAppletQuery: (opts?: { requestPolicy?: "network-only" }) => void;
  children: ReactNode;
}) {
  const [tab, setTab] = useState<AppletTabValue>("app");
  const [draft, setDraft] = useState(persistedSource);
  const [{ fetching: saving }, updateAppletSource] = useMutation(
    AdminUpdateAppletSourceMutation,
  );

  // Reseed the editor when the persisted source changes (e.g. after a refetch
  // following save, or navigating between applets).
  useEffect(() => {
    setDraft(persistedSource);
  }, [persistedSource]);

  const dirty = draft !== persistedSource;

  const handleSave = useCallback(async () => {
    const result = await updateAppletSource({
      input: { appId, source: draft },
    });
    const payload = result.data?.adminUpdateAppletSource;
    if (result.error || !payload?.ok) {
      // SaveAppletPayload.errors is `[AWSJSON!]!` — the server returns objects
      // ({ code, message }) from appletError(), never bare strings. Read
      // `.message` (string branch kept only as a defensive fallback) so the
      // operator sees the real validation reason, not a generic message.
      const firstError = payload?.errors?.[0] as
        | { message?: string }
        | string
        | undefined;
      const message =
        (typeof firstError === "string" ? firstError : firstError?.message) ||
        result.error?.message ||
        "Could not save source.";
      toast.error(`Save failed: ${message}`);
      return;
    }
    toast.success(`Saved v${payload.version ?? ""}`.trim());
    reexecuteAppletQuery({ requestPolicy: "network-only" });
  }, [appId, draft, reexecuteAppletQuery, updateAppletSource]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="relative flex min-h-9 shrink-0 items-center justify-center gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {APPLET_TABS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="tab"
              aria-selected={tab === entry.value}
              onClick={() => setTab(entry.value)}
              className={cn(
                "rounded-md px-6 py-1 text-sm font-medium transition-colors",
                tab === entry.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {tab === "source" ? (
          <div className="absolute right-0">
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0 text-muted-foreground hover:text-foreground"
              disabled={!dirty || saving}
              onClick={() => void handleSave()}
              data-testid="applet-source-save"
            >
              <Save className="h-4 w-4" />
              Save
            </Button>
          </div>
        ) : null}
      </div>

      {/* Absolute-fill panels so each tab gets a real, full-height box (the
          applet preview iframe needs a sized container). All three stay
          mounted and toggle via `hidden` so switching tabs doesn't reload the
          running applet. */}
      <div className="relative min-h-0 flex-1">
        <div className={cn("absolute inset-0", tab === "app" ? "" : "hidden")}>
          {children}
        </div>

        <div
          className={cn("absolute inset-0", tab === "source" ? "" : "hidden")}
        >
          <div className="h-full min-h-0 overflow-hidden rounded-md border bg-black [&>div]:h-full [&_.cm-editor]:!h-full [&_.cm-scroller]:!overflow-auto">
            <CodeMirror
              value={draft}
              onChange={setDraft}
              height="100%"
              theme={vscodeDark}
              extensions={[javascript({ jsx: true, typescript: true })]}
              style={{ fontSize: "13px", backgroundColor: "black" }}
              className="[&_.cm-editor]:!bg-black [&_.cm-gutters]:!bg-black [&_.cm-activeLine]:!bg-transparent [&_.cm-activeLineGutter]:!bg-transparent"
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: false,
                bracketMatching: true,
              }}
              data-testid="applet-source-editor"
            />
          </div>
        </div>

        <div
          className={cn(
            "absolute inset-0 overflow-auto",
            tab === "config" ? "" : "hidden",
          )}
        >
          <div className="grid gap-4 [grid-template-columns:minmax(280px,360px)_minmax(0,1fr)]">
            <section className="space-y-2 rounded-md border p-4">
              <h2 className="text-sm font-semibold">Provenance</h2>
              <dl className="grid gap-2 text-sm">
                <ProvenanceRow label="App ID" value={preview?.appId ?? appId} />
                <ProvenanceRow
                  label="Version"
                  value={preview?.version != null ? `v${preview.version}` : "—"}
                />
                <ProvenanceRow
                  label="Generated"
                  value={
                    preview?.generatedAt
                      ? relativeTime(preview.generatedAt)
                      : "—"
                  }
                />
                <ProvenanceRow
                  label="Thread"
                  value={preview?.threadId ?? "None"}
                />
                <ProvenanceRow
                  label="Model"
                  value={preview?.modelId ?? "Unknown"}
                />
                <ProvenanceRow
                  label="Agent version"
                  value={preview?.agentVersion ?? "Unknown"}
                />
                <ProvenanceRow
                  label="Stdlib"
                  value={preview?.stdlibVersionAtGeneration ?? "—"}
                />
              </dl>
            </section>

            <section className="min-w-0 space-y-2 rounded-md border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Braces className="h-4 w-4 text-primary" />
                Metadata
              </div>
              <pre className="max-h-[calc(100vh-20rem)] overflow-auto rounded-md bg-muted/30 p-3 text-xs leading-relaxed">
                <code className="whitespace-pre-wrap break-words">
                  {formatJson(metadata)}
                </code>
              </pre>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProvenanceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </dt>
      <dd className="break-all font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}

function formatJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value ?? {}, null, 2);
}

// Re-export AppletMount for any external consumers that imported it from this
// route module before the extraction. Prefer importing directly from
// `@/applets/mount` for new code.
export { AppletMount } from "@/applets/mount";
