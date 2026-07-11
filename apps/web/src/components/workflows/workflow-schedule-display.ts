const WEEKDAYS: Record<string, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
  SUN: "Sunday",
};

const CRON_PATTERN =
  /^cron\((\d{1,2})\s+(\d{1,2})\s+(\S+)\s+\*\s+(\S+)\s+\*\)$/;

function formatTime(minutesOfDay: number): string {
  const hours24 = Math.floor(minutesOfDay / 60) % 24;
  const minutes = minutesOfDay % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${period}`;
}

export function formatWorkflowSchedule(
  expression?: string | null,
  timezone?: string | null,
  options: { includeTimezone?: boolean; customLabel?: string } = {},
): string {
  const value = expression?.trim() ?? "";
  if (!value) return "Manual";

  let label: string;
  if (value === "rate(1 hour)") {
    label = "Hourly";
  } else if (value === "rate(7 days)") {
    label = "Weekly";
  } else {
    const cron = CRON_PATTERN.exec(value);
    if (!cron) return options.customLabel ?? value;

    const minutesOfDay = Number(cron[2]) * 60 + Number(cron[1]);
    const time = formatTime(minutesOfDay);
    const dayOfMonth = cron[3];
    const dayOfWeek = cron[4];
    if (dayOfMonth === "*" && dayOfWeek === "?") {
      label = `Daily at ${time}`;
    } else if (dayOfMonth === "?" && dayOfWeek === "MON-FRI") {
      label = `Weekdays at ${time}`;
    } else if (dayOfMonth === "?" && WEEKDAYS[dayOfWeek]) {
      label = `Weekly on ${WEEKDAYS[dayOfWeek]} at ${time}`;
    } else {
      return options.customLabel ?? value;
    }
  }

  if (options.includeTimezone === false || !timezone?.trim()) return label;
  return `${label} · ${timezone.trim()}`;
}
