import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ClipboardList,
  Gauge,
  MessageCircle,
  Pencil,
  SlidersHorizontal,
} from "lucide-react";
import { Button, Textarea } from "@thinkwork/ui";
import {
  SettingsPageTitle,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import type {
  AgentLoopDraft,
  AgentLoopRow,
  AgentLoopWorkerOption,
  SaveAgentLoopPayload,
} from "./agent-loop-types";
import { AutomationAdvancedInspector } from "./AutomationAdvancedInspector";
import { AutomationEasyForm } from "./AutomationEasyForm";
import { AutomationPresetSheet } from "./AutomationPresetSheet";
import {
  defaultAgentLoopDraft,
  draftFromVersion,
  draftToPayload,
  validateDraft,
} from "./agent-loop-utils";

export function AgentLoopForm({
  mode,
  tenantId,
  initialLoop,
  workerOptions,
  onSubmit,
  onStartBuilder,
  onConfirmBuilderDraft,
  onCancel,
}: {
  mode: "create" | "edit";
  tenantId: string;
  initialLoop?: AgentLoopRow | null;
  workerOptions: AgentLoopWorkerOption[];
  onSubmit: (input: SaveAgentLoopPayload) => Promise<void>;
  onStartBuilder?: (input: {
    tenantId: string;
    title?: string | null;
    prompt?: string | null;
    builderThreadId?: string | null;
  }) => Promise<{
    threadCreated: boolean;
    setupPrompt: string;
    draft: unknown;
    thread: { id: string; title?: string | null };
  }>;
  onConfirmBuilderDraft?: (
    input: SaveAgentLoopPayload,
    builderThreadId: string,
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const seededDraft = useMemo(
    () =>
      initialLoop
        ? draftFromVersion(initialLoop, workerOptions)
        : defaultAgentLoopDraft(workerOptions),
    [initialLoop, workerOptions],
  );
  const [draft, setDraft] = useState<AgentLoopDraft>(seededDraft);
  const [saving, setSaving] = useState(false);
  const [builderStarting, setBuilderStarting] = useState(false);
  const [presetSheetOpen, setPresetSheetOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(mode === "edit");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(seededDraft);
    setAdvancedOpen(mode === "edit");
    setError(null);
  }, [mode, seededDraft]);

  const validationError = validateDraft(draft);

  async function save() {
    const invalid = validateDraft(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = draftToPayload({
        draft,
        tenantId,
        id: initialLoop?.id,
        workerOptions,
      });
      if (
        draft.creationMode === "chat" &&
        draft.builderThreadId &&
        onConfirmBuilderDraft
      ) {
        await onConfirmBuilderDraft(payload, draft.builderThreadId);
      } else {
        await onSubmit(payload);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function startBuilder() {
    if (!onStartBuilder) return;
    setBuilderStarting(true);
    setError(null);
    try {
      const result = await onStartBuilder({
        tenantId,
        title: draft.name,
        prompt: draft.objective,
        builderThreadId: draft.builderThreadId,
      });
      const builderDraft = jsonDraft(result.draft);
      setDraft((current) => ({
        ...current,
        ...builderDraft,
        creationMode: "chat",
        builderThreadId: result.thread.id,
        builderThreadTitle: result.thread.title ?? "Automation setup",
        builderSetupPrompt: result.setupPrompt,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuilderStarting(false);
    }
  }

  function selectPreset(nextDraft: AgentLoopDraft) {
    setDraft((current) => ({
      ...nextDraft,
      creationMode: current.creationMode,
      builderThreadId:
        current.creationMode === "chat" ? current.builderThreadId : null,
      builderThreadTitle:
        current.creationMode === "chat" ? current.builderThreadTitle : null,
      builderSetupPrompt:
        current.creationMode === "chat" ? current.builderSetupPrompt : null,
    }));
  }

  function setCreationMode(creationMode: AgentLoopDraft["creationMode"]) {
    setDraft((current) => ({ ...current, creationMode }));
    if (creationMode === "advanced") {
      setAdvancedOpen(true);
    }
  }

  return (
    <div>
      <SettingsPageTitle
        title={mode === "edit" ? "Edit Automation" : "New Automation"}
        description={
          mode === "edit"
            ? "Update the prompt, trigger, and advanced runtime settings."
            : "Start with a prompt, then refine only when needed."
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {mode === "create" ? (
          <div className="flex flex-wrap gap-2">
            <ModeButton
              active={draft.creationMode === "chat"}
              icon={<MessageCircle className="size-4" />}
              label="Chat"
              onClick={() => setCreationMode("chat")}
            />
            <ModeButton
              active={draft.creationMode === "easy"}
              icon={<Pencil className="size-4" />}
              label="Manual"
              onClick={() => setCreationMode("easy")}
            />
            <ModeButton
              active={draft.creationMode === "advanced"}
              icon={<Gauge className="size-4" />}
              label="Advanced"
              onClick={() => setCreationMode("advanced")}
            />
          </div>
        ) : (
          <div />
        )}

        <div className="flex items-center gap-2">
          {mode === "create" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Open templates"
              onClick={() => setPresetSheetOpen(true)}
            >
              <ClipboardList className="size-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdvancedOpen(true)}
          >
            <SlidersHorizontal className="mr-2 size-4" />
            Advanced settings
          </Button>
        </div>
      </div>

      {mode === "create" && draft.creationMode === "chat" ? (
        <SettingsSection label="Chat builder">
          <SettingsRow label="Prompt" layout="stacked">
            <Textarea
              aria-label="Automation prompt"
              className="min-h-32 w-full"
              value={draft.objective}
              onChange={(event) =>
                setDraft((current) => {
                  const objective = event.target.value;
                  return {
                    ...current,
                    objective,
                    name: current.name || titleFromPrompt(objective),
                  };
                })
              }
              placeholder="Watch Linear for issues ready for implementation and create a short routing summary."
            />
          </SettingsRow>
          <SettingsRow label="Builder thread">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => void startBuilder()}
                disabled={builderStarting || !onStartBuilder}
              >
                <MessageCircle className="mr-2 size-4" />
                {builderStarting
                  ? "Starting..."
                  : draft.builderThreadId
                    ? "Resume chat builder"
                    : "Start chat builder"}
              </Button>
              {draft.builderThreadId ? (
                <a
                  className="text-sm text-primary hover:underline"
                  href={`/threads/${draft.builderThreadId}`}
                >
                  Open setup thread
                </a>
              ) : null}
            </div>
          </SettingsRow>
          {draft.builderThreadId ? (
            <SettingsRow label="Review draft" layout="stacked">
              <div className="rounded-md border border-border/70 p-4 text-sm">
                <div className="font-medium">{draft.name || "Untitled"}</div>
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                  {draft.objective}
                </p>
                <p className="mt-3 text-muted-foreground">
                  Trigger:{" "}
                  {draft.triggerFamily === "schedule" ? "Schedule" : "Manual"}
                </p>
              </div>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : (
        <AutomationEasyForm draft={draft} setDraft={setDraft} />
      )}

      <AutomationAdvancedInspector
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        draft={draft}
        setDraft={setDraft}
        workerOptions={workerOptions}
      />
      <AutomationPresetSheet
        open={presetSheetOpen}
        onOpenChange={setPresetSheetOpen}
        workerOptions={workerOptions}
        onSelect={selectPreset}
      />

      <div className="flex items-center justify-end gap-3 pb-8 pt-4">
        {error || validationError ? (
          <p className="mr-auto text-sm text-destructive">
            {error ?? validationError}
          </p>
        ) : null}
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void save()}
          disabled={saving || !!validationError}
        >
          {saving
            ? "Saving..."
            : mode === "edit"
              ? "Save Automation"
              : "Create Automation"}
        </Button>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      aria-pressed={active}
    >
      {icon}
      <span className="ml-2">{label}</span>
    </Button>
  );
}

function jsonDraft(value: unknown): Partial<AgentLoopDraft> {
  const source =
    typeof value === "string" && value.trim()
      ? safeRecord(parseJson(value))
      : safeRecord(value);
  const draft: Partial<AgentLoopDraft> = {
    creationMode: "chat",
  };
  setString(draft, "name", source.name);
  setString(draft, "description", source.description);
  setString(draft, "scheduleType", source.scheduleType);
  setString(draft, "scheduleExpression", source.scheduleExpression);
  setString(draft, "timezone", source.timezone);
  setString(draft, "objective", source.objective);
  setString(draft, "completionCriteriaText", source.completionCriteriaText);
  setString(draft, "workerId", source.workerId);
  setString(draft, "judgeCriteriaText", source.judgeCriteriaText);
  setString(draft, "maxIterations", source.maxIterations);
  setString(draft, "maxRuntimeMinutes", source.maxRuntimeMinutes);
  setString(draft, "maxTokens", source.maxTokens);
  setString(draft, "costBudgetUsd", source.costBudgetUsd);
  setString(draft, "retryBackoffMinutes", source.retryBackoffMinutes);
  setString(draft, "retentionDays", source.retentionDays);
  setString(draft, "builderThreadId", source.builderThreadId);

  if (source.lifecycleStatus === "paused") draft.lifecycleStatus = "paused";
  if (source.enabled === false) draft.enabled = false;
  if (source.triggerFamily === "schedule") draft.triggerFamily = "schedule";
  if (source.judgeMode === "human_approval") draft.judgeMode = "human_approval";
  if (
    source.failBehavior === "best_effort_with_warning" ||
    source.failBehavior === "escalate"
  ) {
    draft.failBehavior = source.failBehavior;
  }
  if (
    source.redactionState === "redacted" ||
    source.redactionState === "offloaded" ||
    source.redactionState === "raw_allowed"
  ) {
    draft.redactionState = source.redactionState;
  }
  if (source.escalateOnFailure === true) draft.escalateOnFailure = true;
  if (source.retainRawEvidence === true) draft.retainRawEvidence = true;
  if (source.suitabilityGoalStable === true) draft.suitabilityGoalStable = true;
  if (source.suitabilityEvidenceAvailable === true) {
    draft.suitabilityEvidenceAvailable = true;
  }
  if (source.suitabilityBudgeted === true) draft.suitabilityBudgeted = true;
  return draft;
}

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function setString<T extends keyof AgentLoopDraft>(
  draft: Partial<AgentLoopDraft>,
  key: T,
  value: unknown,
) {
  if (typeof value === "string" && value.trim()) {
    (draft as Record<string, string>)[key] = value.trim();
  }
}

function titleFromPrompt(prompt: string): string {
  return (
    prompt
      .split(/\r?\n/)[0]
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 8)
      .join(" ")
      .replace(/[.?!,:;]+$/g, "") ?? ""
  );
}
