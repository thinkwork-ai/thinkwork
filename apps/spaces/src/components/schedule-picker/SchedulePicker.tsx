// Copy of apps/admin/src/components/schedule-picker/SchedulePicker.tsx with
// imports normalized to @thinkwork/ui. Keep both files in sync until a
// shared package extraction lands (tracked in the scheduled-jobs-and-automations
// plan's Deferred to Follow-Up Work section).

import { useState, useEffect } from "react";
import { cn, Input } from "@thinkwork/ui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchedulePickerValue {
  scheduleType: string;       // "rate" | "cron" | "at"
  scheduleExpression: string; // "rate(5 minutes)" | "cron(...)" | "at(...)"
  timezone: string;
}

interface SchedulePickerProps {
  value: SchedulePickerValue;
  onChange: (value: SchedulePickerValue) => void;
  allowOneTime?: boolean; // default true
}

// ---------------------------------------------------------------------------
// Frequency presets
// ---------------------------------------------------------------------------

export const FREQUENCIES = [
  { label: "Every 5 min", expr: "rate(5 minutes)", type: "rate" },
  { label: "Every 10 min", expr: "rate(10 minutes)", type: "rate" },
  { label: "Every 15 min", expr: "rate(15 minutes)", type: "rate" },
  { label: "Every 30 min", expr: "rate(30 minutes)", type: "rate" },
  { label: "Every hour", expr: "rate(1 hour)", type: "rate" },
  { label: "Every day", expr: "cron(0 8 * * ? *)", type: "cron" },
  { label: "Every weekday", expr: "cron(0 8 ? * MON-FRI *)", type: "cron" },
  { label: "Every week", expr: "cron(0 8 ? * MON *)", type: "cron" },
  { label: "Every month", expr: "cron(0 8 1 * ? *)", type: "cron" },
] as const;

const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// ---------------------------------------------------------------------------
// Toggle Button Group
// ---------------------------------------------------------------------------

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export function buildExpression(opts: {
  scheduleType: "recurring" | "one_time";
  useCustom: boolean;
  customExpr: string;
  selectedFreq: string;
  hour: number;
  amPm: "AM" | "PM";
  oneTimeDate: string;
}): { type: string; expr: string } {
  if (opts.scheduleType === "one_time") {
    const dt = new Date(opts.oneTimeDate || "");
    return { type: "at", expr: `at(${dt.toISOString().replace(/\.\d{3}Z$/, "")})` };
  }

  if (opts.useCustom) {
    const e = (opts.customExpr || "").trim();
    if (e.startsWith("rate(") || e.startsWith("cron(")) return { type: e.startsWith("rate") ? "rate" : "cron", expr: e };
    return { type: "cron", expr: `cron(${e} *)` };
  }

  let expr = opts.selectedFreq;
  if (expr.startsWith("cron(")) {
    const h24 = opts.amPm === "PM" ? (opts.hour === 12 ? 12 : opts.hour + 12) : (opts.hour === 12 ? 0 : opts.hour);
    expr = expr.replace(/cron\(\d+\s+\d+/, `cron(0 ${h24}`);
  }

  const type = expr.startsWith("rate(") ? "rate" : "cron";
  return { type, expr };
}

export function parseScheduleExpression(expr: string): {
  selectedFreq: string;
  useCustom: boolean;
  customExpr: string;
  scheduleType: "recurring" | "one_time";
  oneTimeDate: string;
  hour: number;
  amPm: "AM" | "PM";
} {
  let selectedFreq = "rate(5 minutes)";
  let useCustom = false;
  let customExpr = "";
  let scheduleType: "recurring" | "one_time" = "recurring";
  let oneTimeDate = "";
  let hour = 8;
  let amPm: "AM" | "PM" = "AM";

  const preset = FREQUENCIES.find((f) => f.expr === expr);

  if (preset) {
    selectedFreq = preset.expr;
  } else if (expr.startsWith("at(")) {
    scheduleType = "one_time";
    oneTimeDate = expr.slice(3, -1);
  } else if (expr) {
    useCustom = true;
    customExpr = expr;
  }

  if (expr.startsWith("cron(")) {
    const parts = expr.slice(5, -1).split(/\s+/);
    const h = parseInt(parts[1], 10);
    if (!isNaN(h)) {
      hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
      amPm = h >= 12 ? "PM" : "AM";
    }
  }

  return { selectedFreq, useCustom, customExpr, scheduleType, oneTimeDate, hour, amPm };
}

// ---------------------------------------------------------------------------
// SchedulePicker component
// ---------------------------------------------------------------------------

export function SchedulePicker({ value, onChange, allowOneTime = true }: SchedulePickerProps) {
  const parsed = parseScheduleExpression(value.scheduleExpression);

  const [scheduleType, setScheduleType] = useState<"recurring" | "one_time">(parsed.scheduleType);
  const [selectedFreq, setSelectedFreq] = useState(parsed.selectedFreq);
  const [useCustom, setUseCustom] = useState(parsed.useCustom);
  const [customExpr, setCustomExpr] = useState(parsed.customExpr);
  const [hour, setHour] = useState(parsed.hour);
  const [amPm, setAmPm] = useState<"AM" | "PM">(parsed.amPm);
  const [oneTimeDate, setOneTimeDate] = useState(parsed.oneTimeDate);
  const [timezone, setTimezone] = useState(value.timezone || "UTC");

  useEffect(() => {
    const { type, expr } = buildExpression({
      scheduleType, useCustom, customExpr, selectedFreq, hour, amPm, oneTimeDate,
    });
    onChange({ scheduleType: type, scheduleExpression: expr, timezone });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleType, selectedFreq, useCustom, customExpr, hour, amPm, oneTimeDate, timezone]);

  const showHourPicker = !useCustom && scheduleType === "recurring" && selectedFreq.startsWith("cron(");

  return (
    <div className="space-y-4">
      {allowOneTime && (
        <div className="space-y-1.5">
          <label className="text-sm font-semibold">Schedule</label>
          <ToggleGroup
            options={[
              { value: "recurring" as const, label: "Recurring" },
              { value: "one_time" as const, label: "One-time" },
            ]}
            value={scheduleType}
            onChange={setScheduleType}
          />
        </div>
      )}

      {scheduleType === "one_time" ? (
        <div className="space-y-1.5">
          <label className="text-sm font-semibold">Run At</label>
          <Input
            type="datetime-local"
            value={oneTimeDate}
            onChange={(e) => setOneTimeDate(e.target.value)}
          />
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold">Frequency</label>
            <div className="flex flex-wrap gap-1.5">
              {FREQUENCIES.map((f) => (
                <button
                  key={f.expr}
                  type="button"
                  onClick={() => { setSelectedFreq(f.expr); setUseCustom(false); }}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    !useCustom && selectedFreq === f.expr
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setUseCustom(true)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  useCustom
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                Custom
              </button>
            </div>
          </div>

          {useCustom && (
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Custom Expression</label>
              <Input
                value={customExpr}
                onChange={(e) => setCustomExpr(e.target.value)}
                placeholder="rate(2 hours) or cron(0 9 * * ? *)"
                className="font-mono text-xs"
              />
            </div>
          )}

          {showHourPicker && (
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Time</label>
              <div className="flex flex-wrap gap-1.5">
                {HOURS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHour(h)}
                    className={cn(
                      "rounded-md w-9 h-9 text-xs font-medium transition-colors",
                      hour === h
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {h}
                  </button>
                ))}
                <div className="w-px bg-border mx-0.5" />
                {(["AM", "PM"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAmPm(v)}
                    className={cn(
                      "rounded-md px-3 h-9 text-xs font-medium transition-colors",
                      amPm === v
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-semibold">Timezone</label>
        <Input
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="UTC"
        />
      </div>
    </div>
  );
}
