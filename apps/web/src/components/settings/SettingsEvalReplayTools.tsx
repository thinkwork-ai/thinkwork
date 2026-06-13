// Read-only MCP replay allowlist management (Trust Core U13).
//
// Replay strips all MCP tools by default, so a flagged thread that needed an
// MCP tool degrades to "I can't access tools" and the quality eval tests
// nothing. This operator surface is DEFAULT-DENY: an MCP tool is restored on
// replay ONLY if an operator adds it here. Mutating tools and the email/web
// side-effect kill-list stay blocked regardless.
//
// Add path: pick a discovered server+tool from the tenant's approved MCP
// servers (sourced from cached discovery), or enter a server+tool by hand
// when discovery has no cached list. Remove path: per-row remove with confirm.

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Input,
  Label,
} from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  AddEvalReplayAllowedToolMutation,
  EvalReplayAvailableMcpToolsQuery,
  EvalReplayToolAllowlistQuery,
  RemoveEvalReplayAllowedToolMutation,
} from "@/lib/evaluation-queries";

export interface EvalReplayAllowedToolRow {
  id: string;
  serverName: string;
  toolName: string;
  createdAt: string;
}

export interface EvalReplayMcpServerRow {
  serverName: string;
  displayName: string;
  tools: Array<{ name: string; description?: string | null }>;
}

/**
 * Group allowlist rows by server for display. Stable server order
 * (alphabetical) and stable tool order within a server.
 */
export function groupAllowlistByServer(
  rows: EvalReplayAllowedToolRow[],
): Array<{ serverName: string; tools: EvalReplayAllowedToolRow[] }> {
  const byServer = new Map<string, EvalReplayAllowedToolRow[]>();
  for (const row of rows) {
    const list = byServer.get(row.serverName) ?? [];
    list.push(row);
    byServer.set(row.serverName, list);
  }
  return [...byServer.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([serverName, tools]) => ({
      serverName,
      tools: tools.sort((a, b) => a.toolName.localeCompare(b.toolName)),
    }));
}

export function SettingsEvalReplayTools() {
  const { tenantId } = useTenant();
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<EvalReplayAllowedToolRow | null>(
    null,
  );

  const [allowlistResult, refetchAllowlist] = useQuery({
    query: EvalReplayToolAllowlistQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [availableResult, refetchAvailable] = useQuery({
    query: EvalReplayAvailableMcpToolsQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const [, removeTool] = useMutation(RemoveEvalReplayAllowedToolMutation);

  const allowlist = (allowlistResult.data?.evalReplayToolAllowlist ??
    []) as EvalReplayAllowedToolRow[];
  const available = (availableResult.data?.evalReplayAvailableMcpTools ??
    []) as EvalReplayMcpServerRow[];

  const grouped = useMemo(() => groupAllowlistByServer(allowlist), [allowlist]);

  // urql's document cache doesn't invalidate across operations.
  const refetchAll = () => {
    refetchAllowlist({ requestPolicy: "network-only" });
    refetchAvailable({ requestPolicy: "network-only" });
  };

  const handleRemove = async () => {
    if (!removing) return;
    const res = await removeTool({ id: removing.id });
    if (res.error) {
      toast.error(`Remove failed: ${res.error.message}`);
    } else {
      toast.success(`Removed ${removing.serverName}/${removing.toolName}.`);
      refetchAll();
    }
    setRemoving(null);
  };

  usePageHeaderActions({
    title: "Replay Tools",
    breadcrumbs: [
      { label: "Evaluations", href: "/settings/evaluations" },
      { label: "Replay Tools" },
    ],
    action: tenantId ? (
      <Button
        variant="ghost"
        size="icon-sm"
        title="Allow a tool"
        aria-label="Allow a tool"
        onClick={() => setAddOpen(true)}
      >
        <Plus className="size-4" />
      </Button>
    ) : undefined,
    actionKey: `eval-replay-tools:${tenantId ?? ""}`,
  });

  if (!tenantId) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingShimmer />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 p-6">
      <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            Read-only MCP tools on replay
          </p>
          <p className="mt-1">
            Replay blocks all MCP tools by default. Add the read-only tools a
            flagged thread needs so its replay can actually run. Mutating tools
            and email/web side effects stay blocked even if listed here.
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {allowlistResult.fetching && !allowlistResult.data ? (
          <div className="flex h-full items-center justify-center">
            <LoadingShimmer />
          </div>
        ) : grouped.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No tools allowed yet. Replay carries no MCP tools until you add one.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {grouped.map((group) => (
              <div
                key={group.serverName}
                className="rounded-md border border-border"
              >
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <span className="font-mono text-sm font-medium">
                    {group.serverName}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {group.tools.length} tool
                    {group.tools.length === 1 ? "" : "s"}
                  </Badge>
                </div>
                <ul className="divide-y divide-border">
                  {group.tools.map((tool) => (
                    <li
                      key={tool.id}
                      className="flex items-center justify-between px-3 py-2"
                    >
                      <span className="font-mono text-sm">{tool.toolName}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        title="Remove tool"
                        aria-label={`Remove ${group.serverName}/${tool.toolName}`}
                        onClick={() => setRemoving(tool)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <AddReplayToolDialog
        tenantId={tenantId}
        open={addOpen}
        onOpenChange={setAddOpen}
        available={available}
        existing={allowlist}
        onAdded={refetchAll}
      />

      <AlertDialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove tool</AlertDialogTitle>
            <AlertDialogDescription>
              Remove{" "}
              <span className="font-mono">
                {removing?.serverName}/{removing?.toolName}
              </span>{" "}
              from the replay allowlist? Future replays will no longer have
              access to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddReplayToolDialog({
  tenantId,
  open,
  onOpenChange,
  available,
  existing,
  onAdded,
}: {
  tenantId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  available: EvalReplayMcpServerRow[];
  existing: EvalReplayAllowedToolRow[];
  onAdded: () => void;
}) {
  const [serverName, setServerName] = useState("");
  const [toolName, setToolName] = useState("");
  const [{ fetching: adding }, addTool] = useMutation(
    AddEvalReplayAllowedToolMutation,
  );

  const existingKeys = useMemo(
    () => new Set(existing.map((row) => `${row.serverName} ${row.toolName}`)),
    [existing],
  );

  const selectedServer = available.find((s) => s.serverName === serverName);
  // Discovered tools for the selected server that aren't already allowed.
  const discoveredTools = (selectedServer?.tools ?? []).filter(
    (tool) => !existingKeys.has(`${serverName} ${tool.name}`),
  );

  const reset = () => {
    setServerName("");
    setToolName("");
  };

  const trimmedServer = serverName.trim();
  const trimmedTool = toolName.trim();
  const duplicate = existingKeys.has(`${trimmedServer} ${trimmedTool}`);
  const canSubmit = !!trimmedServer && !!trimmedTool && !duplicate && !adding;

  const handleAdd = async () => {
    if (!trimmedServer || !trimmedTool) return;
    const res = await addTool({
      tenantId,
      serverName: trimmedServer,
      toolName: trimmedTool,
    });
    if (res.error) {
      toast.error(`Add failed: ${res.error.message}`);
      return;
    }
    toast.success(`Allowed ${trimmedServer}/${trimmedTool} on replay.`);
    onOpenChange(false);
    reset();
    onAdded();
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Allow a read-only tool</AlertDialogTitle>
          <AlertDialogDescription>
            Pick a server and tool, or type them by hand if the server has no
            discovered tool list. Only allow tools that read — never ones that
            write or send.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="replay-tool-server">Server</Label>
            <Input
              id="replay-tool-server"
              list="replay-tool-servers"
              value={serverName}
              placeholder="lastmile--crm"
              onChange={(event) => {
                setServerName(event.target.value);
                setToolName("");
              }}
            />
            <datalist id="replay-tool-servers">
              {available.map((server) => (
                <option key={server.serverName} value={server.serverName}>
                  {server.displayName}
                </option>
              ))}
            </datalist>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="replay-tool-name">Tool</Label>
            <Input
              id="replay-tool-name"
              list="replay-tool-names"
              value={toolName}
              placeholder="opportunities_list"
              onChange={(event) => setToolName(event.target.value)}
            />
            <datalist id="replay-tool-names">
              {discoveredTools.map((tool) => (
                <option key={tool.name} value={tool.name}>
                  {tool.description ?? tool.name}
                </option>
              ))}
            </datalist>
            {duplicate && (
              <p className="text-xs text-destructive">
                That tool is already allowed.
              </p>
            )}
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={adding}>Cancel</AlertDialogCancel>
          <Button onClick={handleAdd} disabled={!canSubmit}>
            {adding ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Allow tool"
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
