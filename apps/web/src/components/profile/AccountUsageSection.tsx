import { useMemo, type ReactNode } from "react";
import { useQuery } from "urql";
import { Activity, Coins, Cpu, Hash } from "lucide-react";
import { cn } from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { SettingsSection } from "@/components/settings/SettingsContent";
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
};

const DEFAULT_DAYS = 90;
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
      <SettingsSection label="Account Usage">
        <div className="flex items-center justify-center py-12">
          <LoadingShimmer />
        </div>
      </SettingsSection>
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
    <SettingsSection label="Account Usage">
      <div className="space-y-5 p-4">
        {result.error ? (
          <p className="text-sm text-destructive">
            Account usage could not be loaded.
          </p>
        ) : null}
        {hasUsage ? null : (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-5">
            <p className="text-sm font-medium text-foreground">No usage yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Activity will appear here after this account runs agents or tools.
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
    </SettingsSection>
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
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">Daily activity</h3>
        <p className="text-xs text-muted-foreground">Last {dayCount} days</p>
      </div>
      <div
        aria-label={`Account usage calendar for the last ${dayCount} days`}
        className="grid grid-cols-[repeat(15,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(18,minmax(0,1fr))] md:grid-cols-[repeat(30,minmax(0,1fr))]"
        role="list"
      >
        {cells.map((cell) => {
          const tokens =
            (cell.row?.inputTokens ?? 0) + (cell.row?.outputTokens ?? 0);
          const label = `${cell.day}: ${formatUsd(
            cell.row?.totalUsd ?? 0,
          )} spend, ${formatTokens(tokens)} tokens, ${formatInteger(
            cell.row?.eventCount ?? 0,
          )} events`;
          return (
            <div
              aria-label={label}
              className={cn(
                "size-3 rounded-[3px] border border-border",
                intensityClassName(cell.intensity),
              )}
              data-testid="usage-day"
              key={cell.day}
              role="listitem"
              title={label}
            />
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            aria-hidden="true"
            className={cn(
              "size-3 rounded-[3px] border border-border",
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

function ModelBreakdown({ models }: { models: UsageModel[] }) {
  const sorted = [...models].sort((a, b) => b.totalUsd - a.totalUsd);
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-foreground">
        Model breakdown
      </h3>
      {sorted.length === 0 ? (
        <p className="rounded-lg border border-border bg-background px-3 py-4 text-sm text-muted-foreground">
          No model usage in this period.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {sorted.map((model) => {
            const name = model.displayName || shortenModelId(model.model);
            const totalTokens = model.inputTokens + model.outputTokens;
            return (
              <div
                className="grid gap-3 border-b border-border bg-background px-3 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                key={model.model}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {name}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {formatTokens(totalTokens)} tokens
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-sm font-semibold tabular-nums text-foreground">
                    {formatUsd(model.totalUsd)}
                  </p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {formatPercent(model.usageShare)}
                  </p>
                </div>
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

  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(end.getTime() - (dayCount - index - 1) * DAY_MS);
    const day = date.toISOString().slice(0, 10);
    const row = byDay.get(day);
    return {
      day,
      row,
      intensity: getIntensity(row, maxSpend, maxEvents),
    };
  });
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
      return "bg-emerald-100 dark:bg-emerald-950";
    case 2:
      return "bg-emerald-300 dark:bg-emerald-800";
    case 3:
      return "bg-teal-500 dark:bg-teal-700";
    case 4:
      return "bg-cyan-600 dark:bg-cyan-500";
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

function shortenModelId(modelId: string): string {
  const afterSlash = modelId.includes("/")
    ? (modelId.split("/").pop() ?? modelId)
    : modelId;
  return afterSlash
    .replace(/^us\.anthropic\./, "")
    .replace(/-\d{8,}/, "")
    .replace(/-v\d+:\d+$/, "");
}
