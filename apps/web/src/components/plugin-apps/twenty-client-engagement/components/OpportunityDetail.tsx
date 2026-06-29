import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@thinkwork/ui";

import type { OpportunityStage } from "../data/model";
import type { PrototypePageId } from "../data/model";
import type {
  EngagementAccount,
  EngagementOpportunityWithLayers,
} from "../data/useTwentyEngagementData";
import {
  STAGES,
  STAGE_GUIDANCE,
  TOOL_STEPS,
} from "../fixtures/prototype-pages";
import { OpportunityLayers } from "./OpportunityLayers";
import { OpportunityTabs } from "./OpportunityTabs";

interface OverlayDrafts {
  executiveNarrative: string;
  executiveHeadline: string;
  kpiBaseline: string;
  useCaseScope: string;
  checkInSummary: string;
}

export function OpportunityDetail({
  account,
  opportunityWithLayers,
  overlayBySection,
  overlayFetching,
  overlayError,
  onBack,
  onSaveOverlay,
  onUpdateStage,
  onUpdateLayerStatus,
  onOpenTool,
}: {
  account: EngagementAccount;
  opportunityWithLayers: EngagementOpportunityWithLayers;
  overlayBySection: Map<string, Record<string, unknown>>;
  overlayFetching: boolean;
  overlayError: string | null;
  onBack: () => void;
  onSaveOverlay: (
    opportunityId: string,
    sectionKey: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  onUpdateStage: (opportunityId: string, stage: string) => Promise<unknown>;
  onUpdateLayerStatus: (layerId: string, status: string) => Promise<unknown>;
  onOpenTool: (pageId: PrototypePageId) => void;
}) {
  const { opportunity, layers } = opportunityWithLayers;
  const [activeTab, setActiveTab] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<OverlayDrafts>({
    executiveNarrative: "",
    executiveHeadline: "",
    kpiBaseline: "",
    useCaseScope: "",
    checkInSummary: "",
  });
  const stage = normalizeStage(opportunity.stage);
  const guidance = STAGE_GUIDANCE.find((item) => item.stage === stage);

  useEffect(() => {
    setDrafts({
      executiveNarrative: stringField(
        overlayBySection.get("executive-view"),
        "executiveNarrative",
      ),
      executiveHeadline: stringField(
        overlayBySection.get("executive-view"),
        "executiveHeadline",
      ),
      kpiBaseline: stringField(
        overlayBySection.get("kpi-framework"),
        "kpiBaseline",
      ),
      useCaseScope: stringField(
        overlayBySection.get("use-case-scope"),
        "useCaseScope",
      ),
      checkInSummary: stringField(
        overlayBySection.get("check-ins"),
        "checkInSummary",
      ),
    });
  }, [overlayBySection, opportunity.id]);

  const stageOptions = useMemo(
    () => STAGES.filter((item) => item.activePipelineStage),
    [],
  );

  async function saveSection(
    sectionKey: string,
    payload: Record<string, unknown>,
  ) {
    setSaving(sectionKey);
    setError(null);
    try {
      await onSaveOverlay(opportunity.id, sectionKey, payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="min-h-full">
      <div className="border-b border-border p-4">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-2 size-3.5" />
          Opportunities
        </Button>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold text-foreground">
              {opportunity.name}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {account.company.name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={stage}
              onValueChange={(value) => {
                setError(null);
                void onUpdateStage(opportunity.id, value).catch((err) => {
                  setError(err instanceof Error ? err.message : String(err));
                });
              }}
            >
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stageOptions.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {opportunity.crmUrl ? (
              <Button type="button" variant="outline" size="sm" asChild>
                <a href={opportunity.crmUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 size-3.5" />
                  CRM
                </a>
              </Button>
            ) : null}
          </div>
        </div>
        {error || overlayError ? (
          <p className="mt-2 text-xs text-destructive">
            {error ?? overlayError}
          </p>
        ) : null}
      </div>

      <OpportunityTabs
        activeTab={activeTab}
        stage={stage}
        onTabChange={setActiveTab}
      />

      <div className="p-4">
        {activeTab === 0 ? (
          <StageTools
            stage={stage}
            guidance={guidance}
            onOpenTool={onOpenTool}
          />
        ) : null}
        {activeTab === 1 ? (
          <OpportunityLayers
            layers={layers}
            onUpdateLayerStatus={onUpdateLayerStatus}
          />
        ) : null}
        {activeTab === 2 ? (
          <OverlayPanel
            title="Strategic Goals"
            description="Capture the executive story and success criteria for this opportunity."
            saving={saving === "executive-view"}
            onSave={() =>
              saveSection("executive-view", {
                executiveNarrative: drafts.executiveNarrative,
              })
            }
          >
            <Textarea
              aria-label="Executive narrative"
              value={drafts.executiveNarrative}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  executiveNarrative: event.target.value,
                }))
              }
              placeholder="Board-ready narrative, decision criteria, and proof points."
              className="min-h-32"
            />
          </OverlayPanel>
        ) : null}
        {activeTab === 3 || activeTab === 4 ? (
          <OverlayPanel
            title="KPI Framework"
            description="Store the baseline metric this engagement should improve."
            saving={saving === "kpi-framework"}
            onSave={() =>
              saveSection("kpi-framework", {
                kpiBaseline: drafts.kpiBaseline,
              })
            }
          >
            <Input
              aria-label="KPI baseline"
              value={drafts.kpiBaseline}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  kpiBaseline: event.target.value,
                }))
              }
              placeholder="e.g. Manual data pulls consume 8 hours/week"
            />
          </OverlayPanel>
        ) : null}
        {activeTab === 5 ? (
          <OverlayPanel
            title="Use Case Scope"
            description="Define the first high-value use case for delivery."
            saving={saving === "use-case-scope"}
            onSave={() =>
              saveSection("use-case-scope", {
                useCaseScope: drafts.useCaseScope,
              })
            }
          >
            <Textarea
              aria-label="Use case scope"
              value={drafts.useCaseScope}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  useCaseScope: event.target.value,
                }))
              }
              className="min-h-28"
            />
          </OverlayPanel>
        ) : null}
        {activeTab === 6 || activeTab === 7 ? (
          activeTab === 6 ? (
            <OverlayPanel
              title="30/60/90 Check-ins"
              description="Capture check-in outcomes, KPI movement, and follow-up actions."
              saving={saving === "check-ins"}
              onSave={() =>
                saveSection("check-ins", {
                  checkInSummary: drafts.checkInSummary,
                })
              }
            >
              <Textarea
                aria-label="Check-in summary"
                value={drafts.checkInSummary}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    checkInSummary: event.target.value,
                  }))
                }
                className="min-h-28"
                placeholder="30/60/90 updates, actual KPI movement, and next actions."
              />
            </OverlayPanel>
          ) : (
            <OverlayPanel
              title="Executive View"
              description="Create a concise executive-ready summary for the sponsor."
              saving={saving === "executive-view"}
              onSave={() =>
                saveSection("executive-view", {
                  executiveNarrative: drafts.executiveNarrative,
                  executiveHeadline: drafts.executiveHeadline,
                })
              }
            >
              <div className="space-y-3">
                <Input
                  aria-label="Executive headline"
                  value={drafts.executiveHeadline}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      executiveHeadline: event.target.value,
                    }))
                  }
                  placeholder="Headline KPI or sponsor-ready outcome"
                />
                <Textarea
                  aria-label="Executive narrative"
                  value={drafts.executiveNarrative}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      executiveNarrative: event.target.value,
                    }))
                  }
                  className="min-h-28"
                />
              </div>
            </OverlayPanel>
          )
        ) : null}
        {overlayFetching ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Loading overlay state...
          </p>
        ) : null}
      </div>
    </div>
  );
}

function StageTools({
  stage,
  guidance,
  onOpenTool,
}: {
  stage: OpportunityStage;
  guidance?: { next: string; tool: string };
  onOpenTool: (pageId: PrototypePageId) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/20 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Engagement Stage
        </div>
        <div className="mt-3 flex gap-2">
          {STAGES.filter((item) => item.activePipelineStage).map((item) => (
            <div
              key={item.value}
              className="flex min-w-0 flex-1 flex-col items-center gap-1"
            >
              <span
                className={
                  item.value === stage
                    ? "size-3 rounded-full bg-primary"
                    : "size-3 rounded-full bg-border"
                }
              />
              <span className="text-center text-[11px] text-muted-foreground">
                {item.label}
              </span>
            </div>
          ))}
        </div>
        {guidance ? (
          <p className="mt-4 text-sm text-foreground">
            <span className="font-semibold">What's next:</span> {guidance.next}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-4 gap-3">
        {TOOL_STEPS.map((tool) => {
          const active = tool.activeStages.includes(stage);
          const done = tool.doneStages.includes(stage);
          return (
            <div
              key={tool.step}
              className="rounded-md border border-border bg-card p-3"
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {tool.step}
              </div>
              <div className="mt-1 min-h-10 text-sm font-semibold text-foreground">
                {tool.name}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {done ? "Complete" : active ? "Current" : "Upcoming"}
              </div>
              {tool.prototypeUrl ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => {
                    if (tool.pageId) onOpenTool(tool.pageId);
                  }}
                >
                  Open {tool.name}
                </Button>
              ) : (
                <div className="mt-3 text-xs text-muted-foreground">
                  {tool.disabledReason}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OverlayPanel({
  title,
  description,
  saving,
  onSave,
  children,
}: {
  title: string;
  description: string;
  saving: boolean;
  onSave: () => void;
  children: ReactNode;
}) {
  return (
    <section className="max-w-3xl rounded-md border border-border bg-card p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Button type="button" size="sm" onClick={onSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
      {children}
    </section>
  );
}

function normalizeStage(value: string): OpportunityStage {
  return STAGES.some((stage) => stage.value === value)
    ? (value as OpportunityStage)
    : "IDENTIFIED";
}

function stringField(
  payload: Record<string, unknown> | undefined,
  key: string,
): string {
  const value = payload?.[key];
  return typeof value === "string" ? value : "";
}
