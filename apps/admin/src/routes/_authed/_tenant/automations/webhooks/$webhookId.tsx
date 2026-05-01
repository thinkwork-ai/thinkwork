import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Play, Pause, Zap, Trash2, Loader2, Pencil, Copy, Check, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { WebhookFormDialog } from "@/components/webhooks/WebhookFormDialog";
import { relativeTime } from "@/lib/utils";
import { apiFetch as authedApiFetch } from "@/lib/api-fetch";

// API_URL retained for displaying the public webhook URL to operators —
// that endpoint is externally callable (no auth header), not an admin fetch.
const API_URL = import.meta.env.VITE_API_URL || "";

export const Route = createFileRoute("/_authed/_tenant/automations/webhooks/$webhookId")({
  component: WebhookDetailPage,
});

type WebhookDetail = {
  id: string;
  name: string;
  description: string | null;
  token: string;
  target_type: string;
  agent_id: string | null;
  routine_id: string | null;
  prompt: string | null;
  config: Record<string, unknown> | null;
  enabled: boolean;
  rate_limit: number | null;
  last_invoked_at: string | null;
  invocation_count: number;
  created_at: string;
  updated_at: string;
};

type RunRow = {
  id: string;
  invocation_source: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  context_snapshot: Record<string, unknown> | null;
  created_at: string;
};

async function apiFetch<T>(path: string, tenantId: string, options: RequestInit = {}): Promise<T> {
  const { headers, ...rest } = options;
  return authedApiFetch<T>(path, {
    ...rest,
    extraHeaders: { "x-tenant-id": tenantId, ...(headers as Record<string, string> | undefined) },
  });
}

const RUN_STATUS_COLORS: Record<string, string> = {
  queued: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  running: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  succeeded: "bg-green-500/15 text-green-600 dark:text-green-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
};

// ---------------------------------------------------------------------------
// Run Row
// ---------------------------------------------------------------------------

function RunRowCard({ run }: { run: RunRow }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-md">
      <button
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <Badge variant="secondary" className={`text-xs capitalize ${RUN_STATUS_COLORS[run.status] || ""}`}>
          {run.status}
        </Badge>
        <span className="text-xs text-muted-foreground flex-1">
          {run.started_at ? relativeTime(run.started_at) : "Queued"}
        </span>
      </button>
      {expanded && (run.context_snapshot || run.error) && (
        <div className="px-3 pb-3 border-t">
          {run.context_snapshot && (
            <pre className="text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-3 mt-2 max-h-48 overflow-y-auto font-mono">
              {JSON.stringify(run.context_snapshot, null, 2)}
            </pre>
          )}
          {run.error && (
            <pre className="text-sm whitespace-pre-wrap text-destructive bg-destructive/5 rounded-md p-3 mt-2">
              {run.error}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy Button
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Edit Button
// ---------------------------------------------------------------------------

function EditWebhookButton({ webhook, tenantId, onSaved }: { webhook: WebhookDetail; tenantId: string; onSaved: (w: WebhookDetail) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4 mr-1" /> Edit
      </Button>
      <WebhookFormDialog
        open={open}
        onOpenChange={setOpen}
        mode="edit"
        tenantId={tenantId}
        initial={{
          name: webhook.name,
          description: webhook.description || undefined,
          target_type: webhook.target_type,
          agent_id: webhook.agent_id || undefined,
          routine_id: webhook.routine_id || undefined,
          prompt: webhook.prompt || undefined,
          rate_limit: webhook.rate_limit || 60,
        }}
        onSubmit={async (data) => {
          const updated = await apiFetch<WebhookDetail>(`/api/webhooks/${webhook.id}`, tenantId, {
            method: "PUT",
            body: JSON.stringify(data),
          });
          onSaved(updated);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function WebhookDetailPage() {
  const { webhookId } = Route.useParams();
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [webhook, setWebhook] = useState<WebhookDetail | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [routineName, setRoutineName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useBreadcrumbs([
    { label: "Webhooks", href: "/automations/webhooks" },
    { label: webhook?.name || "..." },
  ]);

  const fetchData = useCallback(async () => {
    if (!tenantId) return;
    try {
      const [webhookData, runsData] = await Promise.all([
        apiFetch<WebhookDetail>(`/api/webhooks/${webhookId}`, tenantId),
        apiFetch<RunRow[]>(`/api/webhooks/${webhookId}/history?limit=50`, tenantId),
      ]);
      setWebhook(webhookData);
      setRuns(runsData);
      setError(null);

      if (webhookData.agent_id) {
        try {
          const agent = await apiFetch<{ name: string }>(`/api/agents/${webhookData.agent_id}`, tenantId);
          setAgentName(agent.name);
        } catch { setAgentName(null); }
      }
      if (webhookData.routine_id) {
        try {
          const routine = await apiFetch<{ name: string }>(`/api/routines/${webhookData.routine_id}`, tenantId);
          setRoutineName(routine.name);
        } catch { setRoutineName(null); }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tenantId, webhookId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const webhookUrl = webhook ? `${API_URL}/webhooks/${webhook.token}` : "";

  async function handleToggle() {
    if (!tenantId || !webhook) return;
    setToggling(true);
    try {
      const updated = await apiFetch<WebhookDetail>(`/api/webhooks/${webhookId}`, tenantId, {
        method: "PUT",
        body: JSON.stringify({ enabled: !webhook.enabled }),
      });
      setWebhook(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setToggling(false);
    }
  }

  async function handleTest() {
    if (!tenantId) return;
    setTesting(true);
    try {
      await apiFetch(`/api/webhooks/${webhookId}/test`, tenantId, { method: "POST" });
      setTimeout(fetchData, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  async function handleRegenerateToken() {
    if (!tenantId) return;
    setRegenerating(true);
    try {
      const updated = await apiFetch<WebhookDetail>(`/api/webhooks/${webhookId}/regenerate-token`, tenantId, {
        method: "POST",
      });
      setWebhook(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegenerating(false);
    }
  }

  async function handleDelete() {
    if (!tenantId) return;
    try {
      await apiFetch(`/api/webhooks/${webhookId}`, tenantId, { method: "DELETE" });
      navigate({ to: "/automations/webhooks" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!tenantId || loading) return <PageSkeleton />;
  if (!webhook) return <div className="p-6 text-destructive">Webhook not found</div>;

  return (
    <div className="flex flex-col -m-6" style={{ height: "calc(100% + 48px)" }}>
      {/* Fixed header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border bg-background">
        <PageHeader
          title={webhook.name}
          description={webhook.description || `${webhook.target_type === "agent" ? "Agent" : "Routine"} webhook`}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate({ to: "/automations/webhooks" })}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <EditWebhookButton webhook={webhook} tenantId={tenantId} onSaved={setWebhook} />
              <Button variant="outline" size="sm" onClick={handleToggle} disabled={toggling}>
                {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> : webhook.enabled ? <><Pause className="h-4 w-4 mr-1" /> Disable</> : <><Play className="h-4 w-4 mr-1" /> Enable</>}
              </Button>
              <Button size="sm" onClick={handleTest} disabled={testing}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Zap className="h-4 w-4 mr-1" /> Test</>}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm"><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete webhook?</AlertDialogTitle>
                    <AlertDialogDescription>This will permanently delete the webhook. Run history will be preserved.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          }
        />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 min-h-0">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Webhook URL */}
        <Card className="gap-2 py-3">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Webhook URL</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm bg-muted/50 rounded-md px-3 py-2 font-mono break-all">
                {webhookUrl}
              </code>
              <CopyButton text={webhookUrl} />
            </div>
            <div className="flex items-center gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={regenerating}>
                    {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                    Regenerate Token
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Regenerate token?</AlertDialogTitle>
                    <AlertDialogDescription>This will invalidate the current webhook URL. Any services using the old URL will stop working.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRegenerateToken}>Regenerate</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <span className="text-xs text-muted-foreground">POST requests only. No authentication header needed.</span>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="gap-2 py-3">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Target</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Type</span>
                <Badge variant="secondary" className="text-xs capitalize">{webhook.target_type}</Badge>
              </div>
              {webhook.agent_id && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Agent</span>
                  <Badge variant="outline" className="text-xs">{agentName ?? webhook.agent_id.slice(0, 8) + "..."}</Badge>
                </div>
              )}
              {webhook.routine_id && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Routine</span>
                  <Badge variant="outline" className="text-xs">{routineName ?? webhook.routine_id.slice(0, 8) + "..."}</Badge>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Rate Limit</span>
                <span>{webhook.rate_limit ?? 60}/min</span>
              </div>
            </CardContent>
          </Card>

          <Card className="gap-2 py-3">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                {webhook.enabled ? (
                  <span className="text-green-600 dark:text-green-400 flex items-center gap-1"><Play className="h-3 w-3 fill-current" /> Active</span>
                ) : (
                  <span className="text-muted-foreground flex items-center gap-1"><Pause className="h-3 w-3" /> Disabled</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Invocations</span>
                <span>{webhook.invocation_count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Invoked</span>
                <span>{webhook.last_invoked_at ? relativeTime(webhook.last_invoked_at) : "Never"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{relativeTime(webhook.created_at)}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {webhook.prompt && (
          <Card className="gap-2 py-3">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Prompt</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-3">{webhook.prompt}</pre>
            </CardContent>
          </Card>
        )}

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Invocation History</h2>
            <Button variant="outline" size="sm" onClick={fetchData}>Refresh</Button>
          </div>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No invocations yet.</p>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <RunRowCard key={run.id} run={run} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
