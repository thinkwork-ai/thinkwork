import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  Check,
  ChevronDown,
  MessageCircle,
  Plus,
  Search,
  Timer,
  Trash2,
} from "lucide-react";
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@thinkwork/ui";
import {
  SchedulePicker,
  type SchedulePickerValue,
} from "@/components/schedule-picker/SchedulePicker";
import { cn } from "@/lib/utils";
import type { AgentLoopDraft, AgentLoopSpaceOption } from "./agent-loop-types";

export function AutomationEasyForm({
  draft,
  setDraft,
  spaceOptions,
}: {
  draft: AgentLoopDraft;
  setDraft: Dispatch<SetStateAction<AgentLoopDraft>>;
  spaceOptions: AgentLoopSpaceOption[];
}) {
  const scheduleValue: SchedulePickerValue = {
    scheduleType: draft.scheduleType,
    scheduleExpression: draft.scheduleExpression,
    timezone: draft.timezone,
  };

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8">
      <Input
        aria-label="Automation name"
        className="h-14 w-full rounded-lg border-border/80 bg-muted/30 px-4 text-2xl font-semibold placeholder:text-muted-foreground/75"
        value={draft.name}
        onChange={(event) =>
          setDraft((current) => ({
            ...current,
            name: event.target.value,
          }))
        }
        placeholder="Automation name"
      />

      <BuilderSection
        title="Triggers"
        description="Run automation when any of these conditions are met"
        action={
          <TriggerMenuButton
            triggerFamily={draft.triggerFamily}
            setDraft={setDraft}
          />
        }
      >
        <div className="rounded-lg border border-border/75 bg-muted/25 p-4">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-primary/15"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  triggerFamily:
                    current.triggerFamily === "schedule"
                      ? "manual"
                      : "schedule",
                }))
              }
            >
              <Timer className="size-4" />
              {draft.triggerFamily === "schedule" ? "Schedule" : "Manual run"}
            </button>
            <button
              type="button"
              aria-label="Remove trigger"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() =>
                setDraft((current) => ({ ...current, triggerFamily: "manual" }))
              }
            >
              <Trash2 className="size-4" />
            </button>
          </div>

          {draft.triggerFamily === "schedule" ? (
            <div className="mt-4 rounded-md border border-border/60 bg-background/70 p-4">
              <SchedulePicker
                value={scheduleValue}
                onChange={(next) =>
                  setDraft((current) => ({
                    ...current,
                    scheduleType: next.scheduleType,
                    scheduleExpression: next.scheduleExpression,
                    timezone: next.timezone,
                  }))
                }
              />
              <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                <ChecklistItem
                  label="Goal is stable"
                  checked={draft.suitabilityGoalStable}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      suitabilityGoalStable: checked,
                    }))
                  }
                />
                <ChecklistItem
                  label="Evidence is available"
                  checked={draft.suitabilityEvidenceAvailable}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      suitabilityEvidenceAvailable: checked,
                    }))
                  }
                />
                <ChecklistItem
                  label="Budget is bounded"
                  checked={draft.suitabilityBudgeted}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      suitabilityBudgeted: checked,
                    }))
                  }
                />
              </div>
            </div>
          ) : null}
        </div>
      </BuilderSection>

      <BuilderSection
        title="Instructions"
        description="What ThinkWork does when triggers are activated"
        action={<InstructionMenuButton />}
      >
        <div className="rounded-lg border border-border/75 bg-muted/25 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-3">
              <MessageCircle className="size-5 text-muted-foreground" />
              <span className="rounded-md bg-primary/10 px-2.5 py-1 text-sm font-medium text-primary">
                Start session
              </span>
            </div>
            <button
              type="button"
              aria-label="Clear instruction"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  objective: "",
                  name: current.name,
                }))
              }
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <Textarea
            aria-label="Automation instruction"
            className="min-h-56 w-full resize-y border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0"
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
            placeholder="i.e. Write a summary of the session"
          />
        </div>
      </BuilderSection>

      <BuilderSection
        title="MCPs"
        description="Select which connectors you'd like this automation to use"
        action={
          <Button type="button" variant="ghost" size="sm" disabled>
            Manage MCPs
          </Button>
        }
      >
        <div className="overflow-hidden rounded-lg border border-border/75 bg-background/40">
          <div className="flex h-12 items-center gap-3 border-b border-border/60 px-4 text-muted-foreground">
            <Checkbox aria-label="Select all MCPs" checked={false} disabled />
            <Search className="size-4" />
            <span className="text-sm">Search MCPs...</span>
          </div>
          <div className="flex min-h-24 items-center justify-center px-4 py-8 text-sm text-muted-foreground">
            No MCPs available
          </div>
        </div>
      </BuilderSection>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border/60 bg-background/40 px-4 py-3">
        <label className="flex items-center gap-3 text-sm">
          <span className="font-medium">Run in</span>
          <Select
            value={draft.spaceId || undefined}
            onValueChange={(value) =>
              setDraft((current) => ({ ...current, spaceId: value }))
            }
          >
            <SelectTrigger className="h-9 w-64" aria-label="Run in Space">
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
        </label>
        <label className="ml-auto flex items-center gap-3 text-sm">
          <span className="font-medium">Active</span>
          <Switch
            aria-label="Automation active"
            checked={draft.lifecycleStatus === "active" && draft.enabled}
            onCheckedChange={(checked) =>
              setDraft((current) => ({
                ...current,
                lifecycleStatus: checked ? "active" : "paused",
                enabled: checked,
              }))
            }
          />
        </label>
      </div>
    </div>
  );
}

function BuilderSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function TriggerMenuButton({
  triggerFamily,
  setDraft,
}: {
  triggerFamily: AgentLoopDraft["triggerFamily"];
  setDraft: Dispatch<SetStateAction<AgentLoopDraft>>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline">
          <Plus className="mr-2 size-4" />
          Add trigger
          <ChevronDown className="ml-2 size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <TriggerChoice
          active={triggerFamily === "manual"}
          label="Manual run"
          onClick={() =>
            setDraft((current) => ({ ...current, triggerFamily: "manual" }))
          }
        />
        <TriggerChoice
          active={triggerFamily === "schedule"}
          label="Schedule"
          onClick={() =>
            setDraft((current) => ({ ...current, triggerFamily: "schedule" }))
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TriggerChoice({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <DropdownMenuItem
      className={cn(
        "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
        active && "bg-muted text-primary",
      )}
      onSelect={onClick}
    >
      <span>{label}</span>
      {active ? <Check className="size-4" /> : null}
    </DropdownMenuItem>
  );
}

function InstructionMenuButton() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline">
          <Plus className="mr-2 size-4" />
          Add instruction
          <ChevronDown className="ml-2 size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem className="flex w-full items-center justify-between rounded-md bg-muted px-3 py-2 text-left text-sm text-primary">
          <span>Start session</span>
          <Check className="size-4" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChecklistItem({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-border/70 bg-background/60 px-3 py-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <span>{label}</span>
    </label>
  );
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
