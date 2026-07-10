import { useMemo, useState } from "react";
import { useQuery } from "urql";
import { ChevronDown, Clock, Copy } from "lucide-react";
import {
  DocumentPlatesListQuery,
  TenantArtifactsListQuery,
} from "@/lib/graphql-queries";
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import { cn } from "@/lib/utils";
import type {
  AgentLoopDraft,
  AgentLoopRoutineOption,
  AgentLoopWebhookEndpoint,
} from "./agent-loop-types";
import {
  customSchedulePatch,
  formatTimeOfDay,
  parseScheduleFromDraft,
  SCHEDULE_PRESET_OPTIONS,
  schedulePatch,
  scheduleValueLabel,
  TIME_OPTIONS_MINUTES,
  WEEKDAY_OPTIONS,
  type SchedulePresetId,
} from "./agent-loop-utils";

/**
 * Shared automation field controls (THINK-247): the compact create dialog
 * (AgentLoopForm) and the canvas node inspectors (AutomationFlowSection)
 * render the same rows/pickers, so the two editing surfaces cannot drift.
 */

export function DetailRow({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 py-0.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="ml-auto flex min-w-0 flex-col items-end gap-0.5">
        {children}
        {error ? (
          <span className="pr-3 text-xs text-destructive">{error}</span>
        ) : null}
      </div>
    </div>
  );
}

export function GhostSelect({
  ariaLabel,
  value,
  onValueChange,
  placeholder,
  children,
}: {
  ariaLabel: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  children: React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "h-auto min-h-0 w-auto justify-end gap-1.5 rounded-md border-0 bg-transparent px-3 py-2",
          "text-sm font-medium text-foreground shadow-none hover:bg-muted/50",
          "focus:ring-0 focus-visible:ring-0 [&>svg]:opacity-60",
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

/** Genre options from the plate registry. Mounted only in create mode so the
 * form renders query-free otherwise (and in provider-less unit tests). */
export function GenrePicker({
  tenantId,
  value,
  onChange,
}: {
  tenantId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [platesResult] = useQuery<{
    documentPlates?: {
      slug: string;
      displayName?: string | null;
      hidden?: boolean | null;
    }[];
  }>({
    query: DocumentPlatesListQuery,
    variables: { tenantId },
  });
  const genreOptions = useMemo(() => {
    const plates = (platesResult.data?.documentPlates ?? []).filter(
      (plate) => !plate.hidden,
    );
    if (plates.length === 0) {
      return [{ slug: value || "report", displayName: null }];
    }
    return plates;
  }, [platesResult.data?.documentPlates, value]);
  return (
    <GhostSelect
      ariaLabel="Document genre"
      value={value}
      onValueChange={onChange}
      placeholder="Report"
    >
      {genreOptions.map((plate) => (
        <SelectItem key={plate.slug} value={plate.slug}>
          {plate.displayName || plate.slug}
        </SelectItem>
      ))}
    </GhostSelect>
  );
}

/** Existing-document picker scoped to document-kind artifacts. Mounted only
 * in existing mode (same provider-free reasoning as GenrePicker). */
export function ExistingDocumentPicker({
  tenantId,
  value,
  onChange,
}: {
  tenantId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [artifactsResult] = useQuery<{
    artifacts?: { id: string; title: string; metadata?: unknown }[];
  }>({
    query: TenantArtifactsListQuery,
    variables: { tenantId },
  });
  const documentOptions = useMemo(
    () =>
      (artifactsResult.data?.artifacts ?? []).filter((artifact) => {
        const metadata =
          artifact.metadata && typeof artifact.metadata === "object"
            ? (artifact.metadata as Record<string, unknown>)
            : null;
        return metadata?.kind === "document";
      }),
    [artifactsResult.data?.artifacts],
  );
  if (documentOptions.length === 0) {
    return (
      <span className="px-3 py-2 text-sm text-muted-foreground">
        {artifactsResult.fetching
          ? "Loading documents…"
          : "No documents yet — use “Create on first run”."}
      </span>
    );
  }
  return (
    <GhostSelect
      ariaLabel="Document"
      value={value}
      onValueChange={onChange}
      placeholder="Choose a document…"
    >
      {documentOptions.map((doc) => (
        <SelectItem key={doc.id} value={doc.id}>
          {doc.title}
        </SelectItem>
      ))}
    </GhostSelect>
  );
}

/** The Schedule row's value control: a popover with a preset select, a
 * 15-minute-increment time control for the timed presets, a day-of-week select
 * for Weekly, and a raw EventBridge expression input for Custom. */
export function SchedulePopover({
  draft,
  patch,
}: {
  draft: AgentLoopDraft;
  patch: (next: Partial<AgentLoopDraft>) => void;
}) {
  const parsed = parseScheduleFromDraft(draft);
  const [open, setOpen] = useState(false);
  // Local preset state so choosing "Custom" sticks while the user types an
  // expression that would otherwise parse back to a named preset.
  const [preset, setPreset] = useState<SchedulePresetId>(parsed.preset);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) setPreset(parseScheduleFromDraft(draft).preset);
  }

  function handlePreset(value: string) {
    const next = value as SchedulePresetId;
    setPreset(next);
    if (next === "custom") {
      patch(customSchedulePatch(draft.scheduleExpression));
      return;
    }
    patch(
      schedulePatch({
        preset: next,
        minutesOfDay: parsed.minutesOfDay,
        weekday: parsed.weekday,
        timezone: draft.timezone,
      }),
    );
  }

  const timedPreset =
    preset === "daily" || preset === "weekdays" || preset === "weekly";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {/* Mirrors exactly what GhostSelect's SelectTrigger renders as (base
            trigger pill + the ghost overrides) so this row's value chip is
            indistinguishable from the other detail rows. */}
        <button
          type="button"
          aria-label="Schedule"
          className="flex h-8 w-fit select-none items-center justify-end gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted/50 dark:bg-input/30 dark:hover:bg-input/50"
        >
          {scheduleValueLabel(draft)}
          <ChevronDown className="pointer-events-none size-4 shrink-0 text-muted-foreground opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-3 p-3">
        <p className="text-xs font-medium text-muted-foreground">Schedule</p>
        <Select value={preset} onValueChange={handlePreset}>
          <SelectTrigger aria-label="Schedule preset" className="w-full">
            <SelectValue placeholder="Manual" />
          </SelectTrigger>
          <SelectContent>
            {SCHEDULE_PRESET_OPTIONS.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {timedPreset ? (
          <Select
            value={String(parsed.minutesOfDay)}
            onValueChange={(value) =>
              patch(
                schedulePatch({
                  preset: preset as "daily" | "weekdays" | "weekly",
                  minutesOfDay: Number(value),
                  weekday: parsed.weekday,
                  timezone: draft.timezone,
                }),
              )
            }
          >
            <SelectTrigger aria-label="Time" className="w-full">
              <Clock className="size-4 text-muted-foreground" />
              <SelectValue placeholder="9:00 AM">
                {formatTimeOfDay(parsed.minutesOfDay)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {TIME_OPTIONS_MINUTES.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {formatTimeOfDay(minutes)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {preset === "weekly" ? (
          <Select
            value={parsed.weekday}
            onValueChange={(value) =>
              patch(
                schedulePatch({
                  preset: "weekly",
                  minutesOfDay: parsed.minutesOfDay,
                  weekday: value,
                  timezone: draft.timezone,
                }),
              )
            }
          >
            <SelectTrigger aria-label="Day of week" className="w-full">
              <SelectValue placeholder="Monday" />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAY_OPTIONS.map((day) => (
                <SelectItem key={day.id} value={day.id}>
                  {day.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {preset === "custom" ? (
          <Input
            aria-label="Custom schedule expression"
            value={draft.scheduleExpression}
            onChange={(event) => patch(customSchedulePatch(event.target.value))}
            placeholder="cron(0 9 ? * MON-FRI *)"
            className="font-mono text-xs"
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function WebhookPanel({
  endpoint,
}: {
  endpoint?: AgentLoopWebhookEndpoint | null;
}) {
  if (!endpoint) {
    // Pre-save (create) or a saved automation whose webhook row is not yet
    // minted: nothing to show until the endpoint exists.
    return (
      <div
        data-testid="webhook-panel"
        className="rounded-md border border-dashed border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground"
      >
        URL and token generate after you save.
      </div>
    );
  }
  return (
    <div
      data-testid="webhook-panel"
      className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3 text-xs"
    >
      <CopyField label="URL" value={endpoint.path} />
      <CopyField label="Token" value={endpoint.token} secret />
    </div>
  );
}

export function CopyField({
  label,
  value,
  secret,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-foreground">
        {secret ? "•".repeat(Math.min(value.length, 24)) : value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={() => void navigator.clipboard?.writeText(value)}
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}

export function TargetPicker({
  ariaLabel,
  placeholder,
  options,
  value,
  onChange,
  emptyLabel,
}: {
  ariaLabel: string;
  placeholder: string;
  options: AgentLoopRoutineOption[];
  value: string;
  onChange: (value: string) => void;
  emptyLabel: string;
}) {
  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={ariaLabel} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.id}
            value={option.id}
            disabled={Boolean(option.disabledReason)}
          >
            {option.name}
            {option.disabledReason ? ` — ${option.disabledReason}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
