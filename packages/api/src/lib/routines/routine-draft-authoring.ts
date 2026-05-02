import { getRecipe, type AslState } from "./recipe-catalog.js";

export interface RoutineDraftInput {
  name: string;
  intent: string;
  recipient?: string | null;
}

export interface RoutineDraftArtifacts {
  asl: Record<string, unknown>;
  markdownSummary: string;
  stepManifest: Record<string, unknown>;
}

export type RoutineDraftResult =
  | { ok: true; artifacts: RoutineDraftArtifacts }
  | { ok: false; reason: string };

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function buildRoutineDraftFromIntent(
  input: RoutineDraftInput,
): RoutineDraftResult {
  const intent = input.intent.trim();
  if (!intent) {
    return {
      ok: false,
      reason:
        "Describe what the routine should do. For now I can author: check the weather in Austin and email it to someone.",
    };
  }

  const normalized = intent.toLowerCase();
  if (!normalized.includes("weather") || !normalized.includes("austin")) {
    return {
      ok: false,
      reason:
        "This authoring MVP currently supports Austin weather email routines. Try: check the weather in Austin and email it to name@example.com.",
    };
  }
  if (!normalized.includes("email") && !normalized.includes("send")) {
    return {
      ok: false,
      reason:
        "This authoring MVP needs an email action. Try: check the weather in Austin and email it to name@example.com.",
    };
  }

  const recipient = input.recipient?.trim() || intent.match(EMAIL_RE)?.[0];
  if (!recipient) {
    return {
      ok: false,
      reason:
        "Add the email recipient to the routine description, for example: check the weather in Austin and email it to name@example.com.",
    };
  }

  const python = getRecipe("python");
  const email = getRecipe("email_send");
  if (!python || !email) {
    return {
      ok: false,
      reason:
        "Routine authoring is misconfigured: required recipes are missing.",
    };
  }

  const fetchState = python.aslEmitter(
    {
      code: weatherPython(),
      timeoutSeconds: 30,
      networkAllowlist: ["wttr.in"],
    },
    { stateName: "FetchAustinWeather", next: "EmailAustinWeather", end: false },
  );
  const emailState = email.aslEmitter(
    {
      to: [recipient],
      subject: "Austin weather update",
      bodyPath: "$.FetchAustinWeather.stdoutPreview",
      bodyFormat: "markdown",
    },
    { stateName: "EmailAustinWeather", next: null, end: true },
  );

  const states: Record<string, AslState> = {
    FetchAustinWeather: {
      ...fetchState,
      ResultPath: "$.FetchAustinWeather",
    },
    EmailAustinWeather: {
      ...emailState,
      ResultPath: "$.EmailAustinWeather",
    },
  };

  const displayName = input.name.trim() || "Austin weather email";
  return {
    ok: true,
    artifacts: {
      asl: {
        Comment: `Routine authored from intent: ${displayName}`,
        StartAt: "FetchAustinWeather",
        States: states,
      },
      markdownSummary: [
        `# ${displayName}`,
        "",
        `Fetches the current weather for Austin, Texas and emails the summary to ${recipient}.`,
        "",
        "## Steps",
        "",
        "1. Fetch the current Austin weather from wttr.in using the Python sandbox.",
        "2. Email the weather summary using the tenant email-send Lambda.",
      ].join("\n"),
      stepManifest: {
        steps: [
          {
            nodeId: "FetchAustinWeather",
            recipeType: "python",
            label: "Fetch Austin weather",
          },
          {
            nodeId: "EmailAustinWeather",
            recipeType: "email_send",
            label: "Email Austin weather",
            to: [recipient],
          },
        ],
      },
    },
  };
}

function weatherPython(): string {
  return [
    "import json",
    "import urllib.request",
    "",
    "url = 'https://wttr.in/Austin,TX?format=j1'",
    "with urllib.request.urlopen(url, timeout=10) as response:",
    "    data = json.loads(response.read().decode('utf-8'))",
    "",
    "current = data['current_condition'][0]",
    "area = data.get('nearest_area', [{}])[0]",
    "place = area.get('areaName', [{'value': 'Austin'}])[0].get('value', 'Austin')",
    "region = area.get('region', [{'value': 'TX'}])[0].get('value', 'TX')",
    "summary = current.get('weatherDesc', [{'value': 'unknown'}])[0].get('value', 'unknown')",
    "temp_f = current.get('temp_F', 'unknown')",
    "feels_f = current.get('FeelsLikeF', 'unknown')",
    "humidity = current.get('humidity', 'unknown')",
    "wind = current.get('windspeedMiles', 'unknown')",
    "",
    "print(f'Current weather for {place}, {region}: {summary}.')",
    "print(f'Temperature: {temp_f} F; feels like {feels_f} F.')",
    "print(f'Humidity: {humidity}%; wind: {wind} mph.')",
  ].join("\n");
}
