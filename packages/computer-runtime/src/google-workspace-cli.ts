import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GoogleCalendarUpcomingInput } from "./api-client.js";

const execFileAsync = promisify(execFile);
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

type ExecFileAsync = typeof execFileAsync;

export async function listGoogleCalendarUpcomingWithGws(
  input: GoogleCalendarUpcomingInput,
  options: {
    accessToken: string;
    binary?: string;
    execFileAsync?: ExecFileAsync;
  },
) {
  const binary =
    options.binary ?? process.env.GOOGLE_WORKSPACE_CLI_BIN ?? "gws";
  const run = options.execFileAsync ?? execFileAsync;
  const days = agendaDays(input.timeMin, input.timeMax);

  try {
    const result = await run(
      binary,
      ["calendar", "+agenda", "--days", String(days), "--format", "json"],
      {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          GOOGLE_WORKSPACE_CLI_TOKEN: options.accessToken,
          GOOGLE_WORKSPACE_CLI_LOG: "",
        },
      },
    );
    const payload = parseJsonOutput(result.stdout);
    const events = extractEvents(payload).map(sanitizeCalendarEvent);
    return {
      providerName: "google_productivity",
      connected: true,
      tokenResolved: true,
      calendarAvailable: true,
      cli: { binary },
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      maxResults: input.maxResults,
      events,
      eventCount: events.length,
      missingScopes: [],
      reason: null,
    };
  } catch (err) {
    const message = redactToken(
      err instanceof Error ? err.message : String(err),
      options.accessToken,
    );
    const classification = classifyGwsFailure(message);
    return {
      providerName: "google_productivity",
      connected: true,
      tokenResolved: true,
      calendarAvailable: false,
      cli: { binary },
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      maxResults: input.maxResults,
      events: [],
      eventCount: 0,
      reason: classification.reason,
      missingScopes:
        classification.reason === "missing_google_calendar_scope"
          ? [GOOGLE_CALENDAR_SCOPE]
          : [],
      projectId: classification.projectId,
      enableUrl: classification.enableUrl,
      message,
    };
  }
}

function classifyGwsFailure(message: string): {
  reason:
    | "missing_google_calendar_scope"
    | "google_calendar_api_disabled"
    | "gws_command_failed";
  projectId?: string;
  enableUrl?: string;
} {
  if (/insufficient authentication scopes/i.test(message)) {
    return { reason: "missing_google_calendar_scope" };
  }

  if (
    /API not enabled/i.test(message) &&
    /calendar-json\.googleapis\.com/i.test(message)
  ) {
    const projectId = message.match(/[?&]project=([A-Za-z0-9_-]+)/)?.[1];
    return {
      reason: "google_calendar_api_disabled",
      projectId,
      enableUrl: projectId
        ? `https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=${projectId}`
        : undefined,
    };
  }

  return { reason: "gws_command_failed" };
}

function parseJsonOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed);
}

function agendaDays(timeMin: string, timeMax: string): number {
  const start = new Date(timeMin).getTime();
  const end = new Date(timeMax).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 1;
  }
  return Math.min(7, Math.max(1, Math.ceil((end - start) / 86_400_000)));
}

function extractEvents(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.events)) return record.events;
  return [];
}

function sanitizeCalendarEvent(value: unknown): Record<string, unknown> {
  const event =
    value && typeof value === "object" ? (value as Record<string, any>) : {};
  const attendees = Array.isArray(event.attendees) ? event.attendees : [];
  return {
    id: typeof event.id === "string" ? event.id : null,
    summary: typeof event.summary === "string" ? event.summary : "(No title)",
    status: typeof event.status === "string" ? event.status : null,
    start: sanitizeCalendarTime(event.start),
    end: sanitizeCalendarTime(event.end),
    location: typeof event.location === "string" ? event.location : null,
    htmlLink: typeof event.htmlLink === "string" ? event.htmlLink : null,
    attendeeCount: attendees.length,
  };
}

function sanitizeCalendarTime(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    return {
      dateTime: value.includes("T") ? value : null,
      date: value.includes("T") ? null : value,
      timeZone: null,
    };
  }
  if (!value || typeof value !== "object") return null;
  const time = value as Record<string, unknown>;
  return {
    dateTime: typeof time.dateTime === "string" ? time.dateTime : null,
    date: typeof time.date === "string" ? time.date : null,
    timeZone: typeof time.timeZone === "string" ? time.timeZone : null,
  };
}

function redactToken(value: string, token?: string): string {
  let redacted = value.replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted-token]");
  if (token) {
    redacted = redacted.split(token).join("[redacted-token]");
  }
  return redacted;
}
