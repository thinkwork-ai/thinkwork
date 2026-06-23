import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ClipboardList,
  Gauge,
  MessageCircle,
  Pencil,
  SlidersHorizontal,
} from "lucide-react";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@thinkwork/ui";
import { cn } from "@/lib/utils";
import {
  SettingsPageTitle,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import type {
  AgentLoopDraft,
  AgentLoopRow,
  AgentLoopSpaceOption,
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
  spaceOptions,
  defaultSpaceId,
  onSubmit,
  onStartBuilder,
  onConfirmBuilderDraft,
  onCancel,
}: {
  mode: "create" | "edit";
  tenantId: string;
  initialLoop?: AgentLoopRow | null;
  workerOptions: AgentLoopWorkerOption[];
  spaceOptions: AgentLoopSpaceOption[];
  defaultSpaceId?: string | null;
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
        ? draftFromVersion(
            initialLoop,
            workerOptions,
            spaceOptions,
            defaultSpaceId,
          )
        : defaultAgentLoopDraft(workerOptions, spaceOptions, defaultSpaceId),
    [defaultSpaceId, initialLoop, spaceOptions, workerOptions],
  );
  const [draft, setDraft] = useState<AgentLoopDraft>(seededDraft);
  const [saving, setSaving] = useState(false);
  const [builderStarting, setBuilderStarting] = useState(false);
  const [builderAnswersApplied, setBuilderAnswersApplied] = useState(false);
  const [presetSheetOpen, setPresetSheetOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(mode === "edit");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(seededDraft);
    setBuilderAnswersApplied(false);
    setAdvancedOpen(mode === "edit");
    setError(null);
  }, [mode, seededDraft]);

  const validationError = validateDraft(draft);
  const chatBuilderRequired =
    mode === "create" &&
    draft.creationMode === "chat" &&
    (!draft.builderThreadId || !builderAnswersApplied);
  const saveDisabled = saving || !!validationError || chatBuilderRequired;

  async function save() {
    if (chatBuilderRequired) {
      setError(
        draft.builderThreadId
          ? "Answer the builder questions to finalize the chat draft."
          : "Start the chat builder to generate a reviewable draft.",
      );
      return;
    }
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
      setBuilderAnswersApplied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuilderStarting(false);
    }
  }

  function selectPreset(nextDraft: AgentLoopDraft) {
    setDraft((current) => ({
      ...nextDraft,
      creationMode: current.creationMode === "advanced" ? "advanced" : "easy",
      builderThreadId: null,
      builderThreadTitle: null,
      builderSetupPrompt: null,
    }));
    setBuilderAnswersApplied(false);
  }

  function setCreationMode(creationMode: AgentLoopDraft["creationMode"]) {
    setDraft((current) => ({ ...current, creationMode }));
    setBuilderAnswersApplied(false);
    if (creationMode === "advanced") {
      setAdvancedOpen(true);
    }
  }

  function applyBuilderAnswers(answers: BuilderAnswers) {
    setDraft((current) =>
      draftFromBuilderAnswers({
        draft: current,
        answers,
        spaceOptions,
        defaultSpaceId,
      }),
    );
    setBuilderAnswersApplied(true);
    setError(null);
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
          <SettingsRow label="Builder">
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
            <SettingsRow label="Builder questions" layout="stacked">
              <AutomationBuilderQuestionCard
                prompt={draft.objective}
                spaceOptions={spaceOptions}
                defaultSpaceId={defaultSpaceId}
                applied={builderAnswersApplied}
                onApply={applyBuilderAnswers}
              />
            </SettingsRow>
          ) : null}
          <SettingsRow label="Space">
            <Select
              value={draft.spaceId || undefined}
              onValueChange={(value) =>
                setDraft((current) => ({ ...current, spaceId: value }))
              }
            >
              <SelectTrigger className="w-72" aria-label="Automation Space">
                <SelectValue placeholder="Choose a Space" />
              </SelectTrigger>
              <SelectContent>
                {spaceOptions.map((space) => (
                  <SelectItem key={space.id} value={space.id}>
                    {space.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
          {draft.builderThreadId ? (
            <SettingsRow label="Review draft" layout="stacked">
              <div className="rounded-md border border-border/70 p-4 text-sm">
                <div className="font-medium">{draft.name || "Untitled"}</div>
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                  {draft.objective}
                </p>
                <div className="mt-3 grid gap-1 text-muted-foreground">
                  <p>
                    Trigger:{" "}
                    {draft.triggerFamily === "schedule"
                      ? `Schedule (${draft.scheduleExpression})`
                      : "Manual"}
                  </p>
                  <p>
                    Done:{" "}
                    {draft.completionCriteriaText ||
                      "Runtime will infer completion from the prompt."}
                  </p>
                  <p>
                    Status:{" "}
                    {builderAnswersApplied
                      ? "Ready to create"
                      : "Waiting on builder answers"}
                  </p>
                </div>
              </div>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : (
        <AutomationEasyForm
          draft={draft}
          setDraft={setDraft}
          spaceOptions={spaceOptions}
        />
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
        spaceOptions={spaceOptions}
        defaultSpaceId={defaultSpaceId}
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
          disabled={saveDisabled}
        >
          {saving
            ? "Saving..."
            : mode === "edit"
              ? "Save Automation"
              : draft.creationMode === "chat"
                ? "Create from Chat Draft"
                : "Create Automation"}
        </Button>
      </div>
    </div>
  );
}

type BuilderAnswers = {
  goal: "prompt" | "custom";
  goalText: string;
  space: "default" | "choose";
  spaceText: string;
  trigger: "manual" | "schedule";
  done: "summary" | "custom";
  doneText: string;
};

const builderQuestionTabs = [
  { id: "goal", label: "Goal" },
  { id: "space", label: "Space" },
  { id: "trigger", label: "Trigger" },
  { id: "done", label: "Done" },
] as const;

function AutomationBuilderQuestionCard({
  prompt,
  spaceOptions,
  defaultSpaceId,
  applied,
  onApply,
}: {
  prompt: string;
  spaceOptions: AgentLoopSpaceOption[];
  defaultSpaceId?: string | null;
  applied: boolean;
  onApply: (answers: BuilderAnswers) => void;
}) {
  const [activeTab, setActiveTab] = useState("goal");
  const [answers, setAnswers] = useState<BuilderAnswers>({
    goal: "prompt",
    goalText: "",
    space: "default",
    spaceText: "",
    trigger: inferScheduledPrompt(prompt) ? "schedule" : "manual",
    done: "summary",
    doneText: "",
  });

  const answered = {
    goal: answers.goal === "prompt" || answers.goalText.trim() !== "",
    space:
      answers.space === "default" ||
      answers.spaceText.trim() !== "" ||
      Boolean(defaultSpaceId || spaceOptions[0]?.id),
    trigger: true,
    done: answers.done === "summary" || answers.doneText.trim() !== "",
  };
  const allAnswered = Object.values(answered).every(Boolean);

  function update<T extends keyof BuilderAnswers>(
    key: T,
    value: BuilderAnswers[T],
  ) {
    setAnswers((current) => ({ ...current, [key]: value }));
  }

  return (
    <div
      data-testid="automation-builder-questions"
      className="rounded-md border border-border/70 bg-background/70 p-4"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Loop Designer questions</p>
          <p className="text-xs text-muted-foreground">
            Answer these here; the setup thread remains the audit trail.
          </p>
        </div>
        {applied ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
            <Check className="size-3" />
            Draft applied
          </span>
        ) : null}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-4">
        <TabsList
          variant="line"
          className="w-full justify-start overflow-x-auto border-b border-border/60"
        >
          {builderQuestionTabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className={cn(
                "flex-none gap-1.5 px-3",
                !answered[tab.id] && "text-muted-foreground/80",
              )}
            >
              {answered[tab.id] ? (
                <Check aria-hidden className="size-3.5 text-primary" />
              ) : null}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="goal">
          <fieldset className="grid gap-3 border-0 p-0">
            <legend className="text-sm font-medium">
              What should this Automation accomplish each time?
            </legend>
            <RadioChoice
              name="builder-goal"
              checked={answers.goal === "prompt"}
              label="Use my prompt"
              description="Treat the prompt as the goal."
              onChange={() => update("goal", "prompt")}
            />
            <RadioChoice
              name="builder-goal"
              checked={answers.goal === "custom"}
              label="I'll refine it"
              description="Use the note below as the tighter goal."
              onChange={() => update("goal", "custom")}
            />
            {answers.goal === "custom" ? (
              <Textarea
                aria-label="Builder goal details"
                value={answers.goalText}
                onChange={(event) => update("goalText", event.target.value)}
                placeholder="Describe the outcome the automation should produce."
                className="min-h-20"
              />
            ) : null}
          </fieldset>
        </TabsContent>

        <TabsContent value="space">
          <fieldset className="grid gap-3 border-0 p-0">
            <legend className="text-sm font-medium">
              Which Space should it run in?
            </legend>
            <RadioChoice
              name="builder-space"
              checked={answers.space === "default"}
              label="Default Space"
              description="Use the default Space from Agent settings."
              onChange={() => update("space", "default")}
            />
            <RadioChoice
              name="builder-space"
              checked={answers.space === "choose"}
              label="I'll choose"
              description="Name the Space below."
              onChange={() => update("space", "choose")}
            />
            {answers.space === "choose" ? (
              <Textarea
                aria-label="Builder Space details"
                value={answers.spaceText}
                onChange={(event) => update("spaceText", event.target.value)}
                placeholder="Type a Space name, for example Linear Web Apps."
                className="min-h-16"
              />
            ) : null}
          </fieldset>
        </TabsContent>

        <TabsContent value="trigger">
          <fieldset className="grid gap-3 border-0 p-0">
            <legend className="text-sm font-medium">
              Should it run manually or on a schedule?
            </legend>
            <RadioChoice
              name="builder-trigger"
              checked={answers.trigger === "manual"}
              label="Manual"
              description="Run only when I start it."
              onChange={() => update("trigger", "manual")}
            />
            <RadioChoice
              name="builder-trigger"
              checked={answers.trigger === "schedule"}
              label="Schedule"
              description="Create a recurring heartbeat. Advanced settings can refine the cadence."
              onChange={() => update("trigger", "schedule")}
            />
          </fieldset>
        </TabsContent>

        <TabsContent value="done">
          <fieldset className="grid gap-3 border-0 p-0">
            <legend className="text-sm font-medium">
              What evidence or final response means it is done?
            </legend>
            <RadioChoice
              name="builder-done"
              checked={answers.done === "summary"}
              label="Summary"
              description="A concise status summary is enough."
              onChange={() => update("done", "summary")}
            />
            <RadioChoice
              name="builder-done"
              checked={answers.done === "custom"}
              label="I'll define it"
              description="Use explicit completion criteria."
              onChange={() => update("done", "custom")}
            />
            {answers.done === "custom" ? (
              <Textarea
                aria-label="Builder done details"
                value={answers.doneText}
                onChange={(event) => update("doneText", event.target.value)}
                placeholder="List what the final answer must include."
                className="min-h-20"
              />
            ) : null}
          </fieldset>
        </TabsContent>
      </Tabs>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={!allAnswered}
          onClick={() => onApply(answers)}
        >
          Apply builder answers
        </Button>
        <p className="text-xs text-muted-foreground">
          Applying updates the visible draft before the Automation is created.
        </p>
      </div>
    </div>
  );
}

function RadioChoice({
  name,
  checked,
  label,
  description,
  onChange,
}: {
  name: string;
  checked: boolean;
  label: string;
  description: string;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors",
        checked
          ? "border-primary/50 bg-primary/5"
          : "border-border/60 bg-background/40 hover:bg-muted/40",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-1 size-3.5 shrink-0 accent-primary"
      />
      <span className="grid min-w-0 gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs leading-4 text-muted-foreground">
          {description}
        </span>
      </span>
    </label>
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

function draftFromBuilderAnswers({
  draft,
  answers,
  spaceOptions,
  defaultSpaceId,
}: {
  draft: AgentLoopDraft;
  answers: BuilderAnswers;
  spaceOptions: AgentLoopSpaceOption[];
  defaultSpaceId?: string | null;
}): AgentLoopDraft {
  const objective =
    answers.goal === "custom" && answers.goalText.trim()
      ? answers.goalText.trim()
      : draft.objective;
  const spaceId =
    answers.space === "choose"
      ? matchSpaceId(answers.spaceText, spaceOptions) ||
        draft.spaceId ||
        defaultSpaceId ||
        spaceOptions[0]?.id ||
        ""
      : defaultSpaceId || draft.spaceId || spaceOptions[0]?.id || "";
  const schedule =
    answers.trigger === "schedule" ? scheduleFromPrompt(draft.objective) : null;
  const completionCriteriaText =
    answers.done === "custom" && answers.doneText.trim()
      ? answers.doneText.trim()
      : "The automation produced a concise status summary.";

  return {
    ...draft,
    name: draft.name || titleFromPrompt(objective),
    objective,
    spaceId,
    triggerFamily: answers.trigger,
    scheduleType: schedule ? "cron" : draft.scheduleType,
    scheduleExpression: schedule ?? draft.scheduleExpression,
    timezone: schedule ? "America/Chicago" : draft.timezone,
    completionCriteriaText,
    judgeCriteriaText:
      draft.judgeCriteriaText ||
      `Confirm that the final response satisfies: ${completionCriteriaText}`,
    suitabilityGoalStable: true,
    suitabilityEvidenceAvailable: true,
    suitabilityBudgeted: true,
  };
}

function matchSpaceId(
  value: string,
  spaceOptions: AgentLoopSpaceOption[],
): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  const match = spaceOptions.find((space) => {
    const name = space.name.toLowerCase();
    const slug = space.slug?.toLowerCase() ?? "";
    return (
      name === normalized ||
      slug === normalized ||
      name.includes(normalized) ||
      normalized.includes(name)
    );
  });
  return match?.id ?? null;
}

function inferScheduledPrompt(prompt: string): boolean {
  return /\b(daily|weekday|weekend|weekly|monthly|morning|afternoon|evening|every|schedule|recurring)\b/i.test(
    prompt,
  );
}

function scheduleFromPrompt(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (lower.includes("weekday")) return "cron(0 9 ? * MON-FRI *)";
  if (lower.includes("weekly")) return "cron(0 9 ? * MON *)";
  if (lower.includes("monthly")) return "cron(0 9 1 * ? *)";
  return "cron(0 9 * * ? *)";
}
