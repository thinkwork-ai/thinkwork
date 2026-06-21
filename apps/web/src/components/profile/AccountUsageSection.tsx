import { useMemo, type ReactNode } from "react";
import { useQuery } from "urql";
import { Activity, Coins, Cpu, Hash } from "lucide-react";
import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { SettingsAccountUsageQuery } from "@/lib/settings-queries";

type AccountUsageSectionProps = {
  tenantId?: string | null;
  userId?: string | null;
  days?: number;
};

type UsageDay = {
  day: string;
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  eventCount: number;
};

type UsageModel = {
  model: string;
  displayName: string;
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  usageShare: number;
};

type CalendarCell = {
  day: string;
  row?: UsageDay;
  intensity: number;
  isPadding?: boolean;
};

const DEFAULT_DAYS = 180;
const MAX_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export function AccountUsageSection({
  tenantId,
  userId,
  days = DEFAULT_DAYS,
}: AccountUsageSectionProps) {
  const queryDays = normalizeDays(days);
  const hasScope = Boolean(tenantId && userId);
  const [result] = useQuery({
    query: SettingsAccountUsageQuery,
    variables: {
      tenantId: tenantId ?? "",
      userId: userId ?? "",
      days: queryDays,
    },
    pause: !hasScope,
  });

  if (!hasScope) {
    return null;
  }

  if (result.fetching && !result.data) {
    return (
      <section
        aria-labelledby="account-usage-heading"
        className="mb-8 space-y-5"
      >
        <h2
          className="text-xl font-semibold tracking-tight text-foreground"
          id="account-usage-heading"
        >
          Account Usage
        </h2>
        <div className="flex items-center justify-center py-12">
          <LoadingShimmer />
        </div>
      </section>
    );
  }

  const usage = result.data?.accountUsage;
  const summary = usage?.summary;
  const totalTokens =
    (summary?.inputTokens ?? 0) + (summary?.outputTokens ?? 0);
  const hasUsage = (summary?.eventCount ?? 0) > 0;
  const activeDayCount = (usage?.daily ?? []).filter(
    (day) => day.eventCount > 0,
  ).length;

  return (
    <section
      aria-labelledby="account-usage-heading"
      className="mb-8"
    >
      <h2
        className="mb-3 text-base font-medium text-foreground"
        id="account-usage-heading"
      >
        Account Usage
      </h2>

      <div className="space-y-7">
        {result.error ? (
          <p className="text-sm text-destructive">
            Account usage could not be loaded.
          </p>
        ) : null}
        {hasUsage ? null : (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-5">
            <p className="text-sm font-medium text-foreground">No usage yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Activity will appear here after this account runs agents or
              tools.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <UsageMetric
            icon={<Coins className="size-4" />}
            label="Total Spend"
            value={formatUsd(summary?.totalUsd ?? 0)}
          />
          <UsageMetric
            icon={<Hash className="size-4" />}
            label="Tokens"
            value={formatTokens(totalTokens)}
          />
          <UsageMetric
            icon={<Activity className="size-4" />}
            label="Events"
            value={formatInteger(summary?.eventCount ?? 0)}
          />
          <UsageMetric
            icon={<Cpu className="size-4" />}
            label="Active Days"
            value={formatInteger(activeDayCount)}
          />
        </div>

        <UsageCalendar
          rows={usage?.daily ?? []}
          periodEnd={usage?.periodEnd}
          dayCount={queryDays}
        />

        <ModelBreakdown models={usage?.models ?? []} />
      </div>
    </section>
  );
}

function UsageMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

function UsageCalendar({
  rows,
  periodEnd,
  dayCount,
}: {
  rows: UsageDay[];
  periodEnd?: string | null;
  dayCount: number;
}) {
  const cells = useMemo(
    () => buildCalendarCells(rows, periodEnd, dayCount),
    [rows, periodEnd, dayCount],
  );

  return (
    <div>
      <div className="mb-3 flex items-baseline gap-3">
        <h3 className="text-base font-medium text-foreground">
          Daily activity
        </h3>
        <p className="text-xs text-muted-foreground">Last {dayCount} days</p>
      </div>
      <div
        aria-label={`Account usage calendar for the last ${dayCount} days`}
        className="grid grid-flow-col grid-rows-7 auto-cols-max gap-[3px] overflow-x-auto pb-1"
        role="list"
      >
        {cells.map((cell) => {
          if (cell.isPadding) {
            return (
              <div
                aria-hidden="true"
                className={cn(
                  "size-3 rounded-[3px] border border-border sm:size-3.5",
                  intensityClassName(0),
                )}
                data-testid="usage-calendar-cell"
                key={cell.day}
                role="presentation"
              />
            );
          }
          const tokens =
            (cell.row?.inputTokens ?? 0) + (cell.row?.outputTokens ?? 0);
          const label = `${cell.day}: ${formatUsd(
            cell.row?.totalUsd ?? 0,
          )} spend, ${formatTokens(tokens)} tokens, ${formatInteger(
            cell.row?.eventCount ?? 0,
          )} events`;
          return (
            <Tooltip delayDuration={0} disableHoverableContent key={cell.day}>
              <TooltipTrigger asChild>
                <div
                  aria-label={label}
                  className={cn(
                    "size-3 rounded-[3px] border border-border outline-none ring-offset-background transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:size-3.5",
                    intensityClassName(cell.intensity),
                  )}
                  data-testid="usage-day"
                  role="listitem"
                  tabIndex={0}
                />
              </TooltipTrigger>
              <TooltipContent
                className="pointer-events-none block min-w-36 space-y-1.5 border border-border bg-popover px-3 py-2 text-left text-popover-foreground shadow-md"
                hideArrow
                sideOffset={6}
              >
                <p className="font-medium">{formatDateLabel(cell.day)}</p>
                <div className="grid gap-1">
                  <TooltipMetric
                    label="Spend"
                    value={formatUsd(cell.row?.totalUsd ?? 0)}
                  />
                  <TooltipMetric label="Tokens" value={formatTokens(tokens)} />
                  <TooltipMetric
                    label="Events"
                    value={formatInteger(cell.row?.eventCount ?? 0)}
                  />
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            aria-hidden="true"
            className={cn(
              "size-3 rounded-[3px] border border-border sm:size-3.5",
              intensityClassName(level),
            )}
            key={level}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

function TooltipMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function ModelBreakdown({ models }: { models: UsageModel[] }) {
  const sorted = [...models].sort((a, b) => b.totalUsd - a.totalUsd);
  return (
    <div>
      <h3 className="mb-3 text-base font-medium text-foreground">
        Model breakdown
      </h3>
      {sorted.length === 0 ? (
        <p className="rounded-lg border border-border bg-background px-3 py-4 text-sm text-muted-foreground">
          No model usage in this period.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          {sorted.map((model) => {
            const name = model.displayName || shortenModelId(model.model);
            const totalTokens = model.inputTokens + model.outputTokens;
            return (
              <div
                className="grid min-w-[38rem] grid-cols-[minmax(12rem,1fr)_8rem_7rem_5rem] items-center gap-4 border-b border-border bg-background px-3 py-3 last:border-b-0"
                data-testid="model-row"
                key={model.model}
              >
                <p
                  className="min-w-0 truncate text-sm font-medium text-foreground"
                  title={name}
                >
                  {name}
                </p>
                <p className="text-right text-sm tabular-nums text-muted-foreground">
                  {formatTokens(totalTokens)} tokens
                </p>
                <p className="text-right text-sm font-semibold tabular-nums text-foreground">
                  {formatUsd(model.totalUsd)}
                </p>
                <p className="text-right text-sm tabular-nums text-muted-foreground">
                  {formatPercent(model.usageShare)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function buildCalendarCells(
  rows: UsageDay[],
  periodEnd: string | null | undefined,
  dayCount: number,
): CalendarCell[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const maxSpend = Math.max(...rows.map((row) => row.totalUsd), 0);
  const maxEvents = Math.max(...rows.map((row) => row.eventCount), 0);
  const end =
    parseDateOnly(periodEnd) ?? parseDateOnly(new Date().toISOString());
  if (!end) return [];

  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(end.getTime() - (dayCount - index - 1) * DAY_MS);
    const day = date.toISOString().slice(0, 10);
    const row = byDay.get(day);
    return {
      day,
      row,
      intensity: getIntensity(row, maxSpend, maxEvents),
    };
  });
  const leadingPadding = days[0]
    ? (parseDateOnly(days[0].day)?.getUTCDay() ?? 0)
    : 0;
  const padding = Array.from({ length: leadingPadding }, (_, index) => ({
    day: `padding-${index}`,
    intensity: 0,
    isPadding: true,
  }));

  return [...padding, ...days];
}

function getIntensity(
  row: UsageDay | undefined,
  maxSpend: number,
  maxEvents: number,
): number {
  if (!row) return 0;
  if (maxSpend > 0 && row.totalUsd > 0) {
    return Math.max(1, Math.ceil((row.totalUsd / maxSpend) * 4));
  }
  if (maxEvents > 0 && row.eventCount > 0) {
    return Math.max(1, Math.ceil((row.eventCount / maxEvents) * 4));
  }
  return 0;
}

function intensityClassName(level: number): string {
  switch (level) {
    case 1:
      return "bg-[#86acea]";
    case 2:
      return "bg-[#6394e4]";
    case 3:
      return "bg-[#407cde]";
    case 4:
      return "bg-[#2666d0]";
    default:
      return "bg-muted";
  }
}

function normalizeDays(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.floor(value));
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return formatInteger(value);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDateLabel(value: string): string {
  const date = parseDateOnly(value);
  if (!date) return value;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(date)
    .replace(",", "");
}

function shortenModelId(modelId: string): string {
  const afterSlash = modelId.includes("/")
    ? (modelId.split("/").pop() ?? modelId)
    : modelId;
  return afterSlash
    .replace(/^us\.anthropic\./, "")
    .replace(/-\d{8,}/, "")
    .replace(/-v\d+:\d+$/, "");
}
