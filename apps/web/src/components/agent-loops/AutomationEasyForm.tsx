import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Timer } from "lucide-react";
import {
  Button,
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
    <div className="mx-auto grid w-full max-w-6xl gap-7">
      <BuilderSection
        title="Name"
        description="Choose a short, recognizable name for this automation"
      >
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
      </BuilderSection>

      <BuilderSection
        title="Instructions"
        description="What ThinkWork does when this automation runs"
      >
        <Textarea
          aria-label="Automation instruction"
          className="min-h-64 w-full resize-y rounded-lg border-border/80 bg-muted/30 p-4 text-base shadow-none"
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
      </BuilderSection>

      <BuilderSection
        title="Triggers"
        description="Run automation when any of these conditions are met"
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                triggerFamily:
                  current.triggerFamily === "schedule" ? "manual" : "schedule",
              }))
            }
          >
            <Timer className="mr-2 size-4" />
            {draft.triggerFamily === "schedule" ? "Schedule" : "Manual run"}
          </Button>
        }
      >
        {draft.triggerFamily === "schedule" ? (
          <div className="rounded-lg border border-border/75 bg-muted/20 p-4">
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
          </div>
        ) : null}
      </BuilderSection>

      <BuilderSection
        title="Run in"
        description="Choose where this automation runs and whether it is active"
      >
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border/60 bg-background/40 px-4 py-3">
          <label className="flex items-center gap-3 text-sm">
            <span className="font-medium">Space</span>
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
      </BuilderSection>

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
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-6 text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="mt-0 text-sm leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
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
