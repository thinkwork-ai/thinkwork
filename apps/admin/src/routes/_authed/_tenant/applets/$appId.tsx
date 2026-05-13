import { createFileRoute, useNavigate } from "@tanstack/react-router";
import CodeMirror from "@uiw/react-codemirror";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { ArrowLeft, Braces, Code2, ExternalLink, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { AdminAppletPreview } from "@/components/applets/AdminAppletPreview";
import { Button } from "@/components/ui/button";
import {
  AdminAppletQuery,
  AdminUpdateAppletSourceMutation,
} from "@/lib/graphql-queries";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { languageForFile } from "@/lib/codemirror-language";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/applets/$appId")({
  component: AppletDetailPage,
});

function AppletDetailPage() {
  const { appId } = Route.useParams();
  const navigate = useNavigate();
  const [source, setSource] = useState("");
  const [activeTab, setActiveTab] = useState("app");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);
  const [result, reexecuteQuery] = useQuery({
    query: AdminAppletQuery,
    variables: { appId },
    requestPolicy: "cache-and-network",
  });
  const [saveResult, updateAppletSource] = useMutation(
    AdminUpdateAppletSourceMutation,
  );

  const payload = result.data?.adminApplet;
  const applet = payload?.applet;
  const persistedSource = payload?.source ?? "";
  const sourceDirty = source !== persistedSource;
  const appUrl = useMemo(
    () => (applet ? liveArtifactUrl(applet.appId) : ""),
    [applet],
  );

  useEffect(() => {
    setSource(persistedSource);
    setSaveError(null);
    setSaveOk(null);
  }, [persistedSource]);

  useBreadcrumbs([
    { label: "Artifacts", href: "/applets" },
    { label: applet?.name ?? "Artifact" },
  ]);

  if (result.fetching && !result.data) return <PageSkeleton />;

  if (!payload || !applet) {
    return (
      <PageLayout
        header={
          <PageHeader title="App not found">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate({ to: "/applets" })}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Apps
            </Button>
          </PageHeader>
        }
      >
        <EmptyState
          icon={Code2}
          title="App unavailable"
          description="The app may have been deleted or the current account cannot inspect it."
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      contentClassName={
        activeTab === "app" || activeTab === "source"
          ? "!overflow-hidden !pb-4"
          : undefined
      }
      header={
        <PageHeader
          title={applet.name}
          actions={
            <Button variant="outline" size="sm" asChild>
              <a href={appUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open Live
              </a>
            </Button>
          }
        />
      }
    >
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="h-full min-h-0 gap-4"
      >
        <div className="relative flex min-h-9 shrink-0 items-center justify-center gap-3">
          <TabsList>
            <TabsTrigger value="app" className="px-6">
              App
            </TabsTrigger>
            <TabsTrigger value="source" className="px-6">
              Source
            </TabsTrigger>
            <TabsTrigger value="config" className="px-6">
              Config
            </TabsTrigger>
          </TabsList>
          {activeTab === "source" ? (
            <div className="absolute right-0 flex items-center gap-3">
              {saveError ? (
                <span className="text-xs text-destructive" role="alert">
                  {saveError}
                </span>
              ) : saveOk ? (
                <span className="text-xs text-muted-foreground">{saveOk}</span>
              ) : null}
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0 text-muted-foreground hover:text-foreground"
                disabled={!sourceDirty || saveResult.fetching}
                onClick={() =>
                  void saveSource({
                    appId: applet.appId,
                    source,
                    updateAppletSource,
                    reexecuteQuery,
                    setSaveError,
                    setSaveOk,
                  })
                }
              >
                <Save className="h-4 w-4" />
                Save
              </Button>
            </div>
          ) : null}
        </div>

        <TabsContent value="app" className="min-h-0 overflow-hidden">
          <AdminAppletPreview
            source={source}
            version={applet.version ?? 1}
            title={applet.name}
          />
        </TabsContent>

        <TabsContent value="source" className="min-h-0 overflow-hidden">
          <section className="h-full min-h-0">
            <div className="h-full min-h-0 overflow-hidden rounded-md border bg-black [&>div]:h-full [&_.cm-editor]:!h-full [&_.cm-scroller]:!overflow-auto">
              <CodeMirror
                value={source}
                onChange={(value) => {
                  setSource(value);
                  setSaveError(null);
                  setSaveOk(null);
                }}
                height="100%"
                theme={vscodeDark}
                extensions={languageForFile("App.tsx")}
                style={{ fontSize: "13px", backgroundColor: "black" }}
                className="[&_.cm-editor]:!bg-black [&_.cm-gutters]:!bg-black [&_.cm-activeLine]:!bg-transparent [&_.cm-activeLineGutter]:!bg-transparent"
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLine: false,
                  bracketMatching: true,
                }}
              />
            </div>
          </section>
        </TabsContent>

        <TabsContent value="config" className="min-h-0">
          <div className="grid gap-4 overflow-x-auto [grid-template-columns:minmax(280px,360px)_minmax(0,1fr)]">
            <section className="space-y-2 rounded-md border p-4">
              <h2 className="text-sm font-semibold">Provenance</h2>
              <dl className="grid gap-2 text-sm">
                <Detail label="App ID" value={applet.appId} />
                <Detail label="Version" value={`v${applet.version}`} />
                <Detail
                  label="Generated"
                  value={relativeTime(applet.generatedAt)}
                />
                <Detail label="Thread" value={applet.threadId ?? "None"} />
                <Detail
                  label="Agent"
                  value={applet.artifact.agentId ?? "None"}
                />
                <Detail label="Model" value={applet.modelId ?? "Unknown"} />
                <Detail
                  label="Stdlib"
                  value={applet.stdlibVersionAtGeneration}
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
                  {formatJson(payload.metadata)}
                </code>
              </pre>
            </section>
          </div>
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}

async function saveSource({
  appId,
  source,
  updateAppletSource,
  reexecuteQuery,
  setSaveError,
  setSaveOk,
}: {
  appId: string;
  source: string;
  updateAppletSource: (variables: {
    input: { appId: string; source: string };
  }) => Promise<{
    data?: {
      adminUpdateAppletSource?: {
        ok: boolean;
        version?: number | null;
        errors?: Array<{ message?: string } | null> | null;
      } | null;
    } | null;
    error?: { message: string };
  }>;
  reexecuteQuery: (opts?: { requestPolicy?: "network-only" }) => void;
  setSaveError: (message: string | null) => void;
  setSaveOk: (message: string | null) => void;
}) {
  setSaveError(null);
  setSaveOk(null);
  const result = await updateAppletSource({
    input: { appId, source },
  });
  const payload = result.data?.adminUpdateAppletSource;
  if (result.error || !payload?.ok) {
    setSaveError(
      payload?.errors?.[0]?.message ||
        result.error?.message ||
        "Could not save source.",
    );
    return;
  }
  setSaveOk(`Saved v${payload.version ?? ""}`.trim());
  reexecuteQuery({ requestPolicy: "network-only" });
}

function liveArtifactUrl(appId: string) {
  const configured = String(import.meta.env.VITE_COMPUTER_URL ?? "").trim();
  const base = configured || inferComputerOrigin();
  return `${base.replace(/\/+$/, "")}/artifacts/${encodeURIComponent(appId)}`;
}

function inferComputerOrigin() {
  if (window.location.hostname.startsWith("admin.")) {
    return window.location.origin.replace("//admin.", "//computer.");
  }
  return "https://computer.thinkwork.ai";
}

function Detail({ label, value }: { label: string; value: string }) {
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
