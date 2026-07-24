import { useCallback, useEffect, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { ExternalLink, Eye, EyeOff, Plus, RefreshCw } from "lucide-react";
import { TooltipIconButton, cn } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { listMcpServers } from "@/lib/mcp-api";
import {
  SettingsMemory,
  type MemoryRawUnitsController,
  type MemoryRefreshController,
} from "@/components/settings/SettingsMemory";
import {
  SettingsKnowledgeBases,
  type KnowledgeBasesHeaderController,
} from "@/components/settings/SettingsKnowledgeBases";

const RECORDS = "/settings/memory/records";
const KNOWLEDGE_BASES = "/settings/memory/knowledge-bases";

const BRAIN_CONSOLE_URL = "https://brain.thinkwork.ai";
const BRAIN_CONNECTOR_SLUG = "digital-twin";

type MemoryTab = "memory" | "knowledge-bases";

function tabForPath(pathname: string): MemoryTab {
  if (pathname.startsWith(KNOWLEDGE_BASES)) return "knowledge-bases";
  // THINK-339 U15: the Company Brain and Ontology tabs moved to the
  // standalone console (brain.thinkwork.ai) — Memory records are the
  // landing tab again; the bare /settings/memory path renders them.
  return "memory";
}

/**
 * Company Brain moved to the standalone console (THINK-339 U15). When the
 * tenant has an active Brain MCP registration (the approved `digital-twin`
 * connector row), a small link-out card takes operators there. No
 * registration (or any lookup failure) = no card.
 */
function useBrainConsoleAvailable(): boolean {
  const { tenant } = useTenant();
  const tenantSlug = tenant?.slug ?? null;
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!tenantSlug) return;
    let cancelled = false;
    listMcpServers(tenantSlug)
      .then(({ servers }) => {
        if (cancelled) return;
        setAvailable(
          servers.some(
            (server) =>
              server.slug === BRAIN_CONNECTOR_SLUG &&
              server.status !== "rejected",
          ),
        );
      })
      .catch(() => {
        // Best-effort signal: an errored lookup renders no card.
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  return available;
}

function BrainConsoleCard() {
  return (
    <a
      href={BRAIN_CONSOLE_URL}
      target="_blank"
      rel="noreferrer"
      data-testid="brain-console-link-out"
      className="text-muted-foreground hover:text-foreground hover:border-primary/40 mx-4 mt-3 flex items-center gap-2 self-start rounded-md border px-3 py-2 text-sm transition-colors"
    >
      <span>
        <span className="text-foreground font-medium">Company Brain</span> has
        moved to its own console
      </span>
      <ExternalLink className="size-3.5 shrink-0" />
    </a>
  );
}

/**
 * The unified Memory settings page. Memory records and KBs are siblings
 * rendered in the AppTopBar and driven by the route so each tab is
 * deep-linkable. The Company Brain and Ontology tabs retired to the
 * standalone console (THINK-339 U15) — a link-out card replaces them when
 * the tenant's Brain MCP registration is active.
 */
export function SettingsMemoryHome() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const activeTab = tabForPath(pathname);
  const brainConsoleAvailable = useBrainConsoleAvailable();
  const [refreshController, setRefreshController] =
    useState<MemoryRefreshController | null>(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const [rawUnitsController, setRawUnitsController] =
    useState<MemoryRawUnitsController | null>(null);
  const [kbController, setKbController] =
    useState<KnowledgeBasesHeaderController | null>(null);

  const updateRefreshController = useCallback(
    (controller: MemoryRefreshController | null) => {
      setRefreshController(controller);
    },
    [],
  );
  const updateRawUnitsController = useCallback(
    (controller: MemoryRawUnitsController | null) => {
      setRawUnitsController(controller);
    },
    [],
  );
  const updateKbController = useCallback(
    (controller: KnowledgeBasesHeaderController | null) => {
      setKbController(controller);
    },
    [],
  );

  const refreshing =
    refreshPending || (refreshController?.isRefreshing ?? false);
  const refreshDisabled = refreshController?.disabled ?? true;
  const refreshMemory = useCallback(async () => {
    if (!refreshController || refreshDisabled || refreshPending) return;
    setRefreshPending(true);
    try {
      await Promise.all([
        refreshController.refresh(),
        new Promise((resolve) => window.setTimeout(resolve, 450)),
      ]);
    } finally {
      setRefreshPending(false);
    }
  }, [refreshController, refreshDisabled, refreshPending]);

  const refreshAction =
    activeTab === "memory" ? (
      <div className="flex items-center gap-1">
        {rawUnitsController ? (
          <TooltipIconButton
            label={
              rawUnitsController.showRaw
                ? "Showing all memory units. Click to return to the curated view (consolidated observations, corroborated facts, and deliberate captures)."
                : `Curated view — ${rawUnitsController.hiddenCount} raw uncorroborated unit${rawUnitsController.hiddenCount === 1 ? "" : "s"} hidden. Click to show everything.`
            }
            className={cn(
              rawUnitsController.showRaw &&
                "bg-primary/10 text-primary hover:text-primary",
            )}
            aria-label={
              rawUnitsController.showRaw
                ? "Hide raw memory units"
                : "Show raw memory units"
            }
            data-testid="settings-memory-toggle-raw"
            onClick={() => rawUnitsController.toggle()}
          >
            {rawUnitsController.showRaw ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </TooltipIconButton>
        ) : null}
        <TooltipIconButton
          label="Refresh memory records"
          className={cn(
            refreshing && "bg-primary/10 text-primary hover:text-primary",
          )}
          disabled={refreshDisabled}
          onClick={() => void refreshMemory()}
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
        </TooltipIconButton>
      </div>
    ) : null;

  // KBs header action: the new-source gesture renders as a Plus
  // TooltipIconButton in the page header while the KBs tab is active.
  const kbAction =
    activeTab === "knowledge-bases" && kbController ? (
      <TooltipIconButton
        label="New source"
        aria-label="New source"
        data-testid="settings-kb-new-source"
        onClick={() => kbController.openNewSource()}
      >
        <Plus className="size-4" />
      </TooltipIconButton>
    ) : null;

  usePageHeaderActions({
    // "Knowledge" umbrella naming (Company Brain U9): the nav item and this
    // page title read Knowledge. URLs unchanged.
    title: "Knowledge",
    breadcrumbs: [{ label: "Knowledge" }],
    tabs: [
      { to: RECORDS, label: "Memory", active: activeTab === "memory" },
      {
        to: KNOWLEDGE_BASES,
        label: "KBs",
        active: activeTab === "knowledge-bases",
      },
    ],
    action: activeTab === "knowledge-bases" ? kbAction : refreshAction,
    actionKey: `memory-refresh:${activeTab}:${refreshDisabled ? "disabled" : "enabled"}:${refreshing ? "refreshing" : "idle"}:${rawUnitsController ? `${rawUnitsController.showRaw ? "raw" : "curated"}:${rawUnitsController.hiddenCount}` : "no-raw"}:${kbController ? "kb" : "no-kb"}`,
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {brainConsoleAvailable ? <BrainConsoleCard /> : null}
      {activeTab === "memory" ? (
        <SettingsMemory
          embedded
          onRefreshControllerChange={updateRefreshController}
          onRawUnitsControllerChange={updateRawUnitsController}
        />
      ) : null}
      {activeTab === "knowledge-bases" ? (
        <SettingsKnowledgeBases
          embedded
          onHeaderControllerChange={updateKbController}
        />
      ) : null}
    </div>
  );
}
