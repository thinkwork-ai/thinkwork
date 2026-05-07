import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GoogleCalendarUpcomingInput } from "./api-client.js";

const execFileAsync = promisify(execFile);

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
  const params = {
    calendarId: "primary",
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: input.maxResults,
  };

  try {
    const result = await run(
      binary,
      ["calendar", "events", "list", "--params", JSON.stringify(params)],
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
      reason: null,
    };
  } catch (err) {
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
      reason: "gws_command_failed",
      message: redactToken(
        err instanceof Error ? err.message : String(err),
        options.accessToken,
      ),
    };
  }
}

function parseJsonOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed);
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
