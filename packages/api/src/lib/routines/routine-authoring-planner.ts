import { getRecipe, type AslState } from "./recipe-catalog.js";

export interface RoutinePlanInput {
  name: string;
  intent: string;
  recipient?: string | null;
}

export interface RoutinePlanStep {
  nodeId: string;
  recipeId: string;
  label: string;
  args: Record<string, unknown>;
}

export interface RoutineDefinitionField {
  key: string;
  label: string;
  value: string | null;
  inputType: "email" | "text";
  stepNodeId?: string | null;
}

export interface RoutinePlan {
  kind: RoutineDefinitionKind;
  title: string;
  description: string;
  steps: RoutinePlanStep[];
  editableFields: RoutineDefinitionField[];
}

export type RoutineDefinitionKind = "weather_email";

export interface RoutinePlanArtifacts {
  plan: RoutinePlan;
  asl: Record<string, unknown>;
  markdownSummary: string;
  stepManifest: Record<string, unknown>;
}

export type RoutinePlanResult =
  | { ok: true; artifacts: RoutinePlanArtifacts }
  | { ok: false; reason: string };

export type RoutineDefinitionResult =
  | { ok: true; plan: RoutinePlan }
  | { ok: false; reason: string };

export interface RoutineDefinitionEdit {
  key: string;
  value: string | null;
}

const EMAIL_EXTRACT_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const EMAIL_VALUE_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export function planRoutineFromIntent(
  input: RoutinePlanInput,
): RoutinePlanResult {
  const intent = input.intent.trim();
  if (!intent) {
    return unsupported(
      "Describe what the routine should do. For now I can author: check the weather in Austin and email it to someone.",
    );
  }

  const normalized = intent.toLowerCase();
  if (!normalized.includes("weather") || !normalized.includes("austin")) {
    return unsupported(
      "This authoring MVP currently supports Austin weather email routines. Try: check the weather in Austin and email it to name@example.com.",
    );
  }
  if (!normalized.includes("email") && !normalized.includes("send")) {
    return unsupported(
      "This authoring MVP needs an email action. Try: check the weather in Austin and email it to name@example.com.",
    );
  }

  const recipient =
    input.recipient?.trim() || intent.match(EMAIL_EXTRACT_RE)?.[0];
  if (!recipient) {
    return unsupported(
      "Add the email recipient to the routine description, for example: check the weather in Austin and email it to name@example.com.",
    );
  }
  if (!EMAIL_VALUE_RE.test(recipient)) {
    return unsupported("Enter a valid recipient email address.");
  }

  const displayName = input.name.trim() || "Austin weather email";
  return artifactsForWeatherEmail(displayName, recipient);
}

export function buildRoutineArtifactsFromPlan(plan: RoutinePlan): RoutinePlanResult {
  if (plan.kind !== "weather_email") {
    return unsupported(`Unsupported routine definition kind: ${plan.kind}`);
  }
  const recipient = fieldValue(plan, "recipientEmail");
  if (!recipient) {
    return unsupported("Enter a recipient email address before saving.");
  }
  if (!EMAIL_VALUE_RE.test(recipient)) {
    return unsupported("Enter a valid recipient email address.");
  }
  return artifactsForWeatherEmail(plan.title, recipient);
}

export function routineDefinitionFromArtifacts(input: {
  routineName: string;
  routineDescription?: string | null;
  stepManifestJson: unknown;
  aslJson: unknown;
}): RoutineDefinitionResult {
  const manifest = normalizeJsonObject(input.stepManifestJson);
  const definition = normalizeJsonObject(manifest.definition);
  if (definition?.kind === "weather_email") {
    const recipient = String(definition.recipientEmail ?? "").trim();
    if (recipient && EMAIL_VALUE_RE.test(recipient)) {
      return {
        ok: true,
        plan: weatherEmailPlan(input.routineName, recipient),
      };
    }
  }

  const recipient = extractRecipientFromAsl(input.aslJson);
  if (recipient) {
    return {
      ok: true,
      plan: weatherEmailPlan(input.routineName, recipient),
    };
  }

  return unsupported(
    "This routine definition cannot be edited yet. Supported editable definition: Austin weather email routines.",
  );
}

export function applyRoutineDefinitionEdits(
  plan: RoutinePlan,
  edits: RoutineDefinitionEdit[],
): RoutinePlanResult {
  const next: RoutinePlan = {
    ...plan,
    steps: plan.steps.map((step) => ({
      ...step,
      args: { ...step.args },
    })),
    editableFields: plan.editableFields.map((field) => ({ ...field })),
  };

  for (const edit of edits) {
    if (edit.key !== "recipientEmail") {
      return unsupported(`Unsupported routine definition field: ${edit.key}`);
    }
    const value = edit.value?.trim() ?? "";
    if (!value) {
      return unsupported("Enter a recipient email address before saving.");
    }
    if (!EMAIL_VALUE_RE.test(value)) {
      return unsupported("Enter a valid recipient email address.");
    }
    const field = next.editableFields.find((f) => f.key === "recipientEmail");
    if (field) field.value = value;
  }

  return buildRoutineArtifactsFromPlan(next);
}

function artifactsForWeatherEmail(
  displayName: string,
  recipient: string,
): RoutinePlanResult {
  const python = getRecipe("python");
  const email = getRecipe("email_send");
  if (!python) {
    return unsupported(
      "Routine authoring is misconfigured: required recipe python is missing.",
    );
  }
  if (!email) {
    return unsupported(
      "Routine authoring is misconfigured: required recipe email_send is missing.",
    );
  }

  const plan = weatherEmailPlan(displayName, recipient);
  const fetchStep = plan.steps[0]!;
  const emailStep = plan.steps[1]!;
  const fetchState = python.aslEmitter(fetchStep.args, {
    stateName: fetchStep.nodeId,
    next: emailStep.nodeId,
    end: false,
  });
  const emailState = email.aslEmitter(emailStep.args, {
    stateName: emailStep.nodeId,
    next: null,
    end: true,
  });

  const states: Record<string, AslState> = {
    [fetchStep.nodeId]: {
      ...fetchState,
      ResultPath: `$.${fetchStep.nodeId}`,
    },
    [emailStep.nodeId]: {
      ...emailState,
      ResultPath: `$.${emailStep.nodeId}`,
    },
  };

  return {
    ok: true,
    artifacts: {
      plan,
      asl: {
        Comment: `Routine authored from intent: ${displayName}`,
        StartAt: fetchStep.nodeId,
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
        definition: {
          kind: plan.kind,
          recipientEmail: recipient,
        },
        steps: plan.steps.map((step) => ({
          nodeId: step.nodeId,
          recipeType: step.recipeId,
          label: step.label,
          ...(step.recipeId === "email_send" ? { to: step.args.to } : {}),
        })),
      },
    },
  };
}

function weatherEmailPlan(displayName: string, recipient: string): RoutinePlan {
  return {
    kind: "weather_email",
    title: displayName,
    description: `Fetches the current weather for Austin, Texas and emails the summary to ${recipient}.`,
    steps: [
      {
        nodeId: "FetchAustinWeather",
        recipeId: "python",
        label: "Fetch Austin weather",
        args: {
          code: weatherPython(),
          timeoutSeconds: 30,
          networkAllowlist: ["wttr.in"],
        },
      },
      {
        nodeId: "EmailAustinWeather",
        recipeId: "email_send",
        label: "Email Austin weather",
        args: {
          to: [recipient],
          subject: "Austin weather update",
          bodyPath: "$.FetchAustinWeather.stdoutPreview",
          bodyFormat: "markdown",
        },
      },
    ],
    editableFields: [
      {
        key: "recipientEmail",
        label: "Recipient email",
        value: recipient,
        inputType: "email",
        stepNodeId: "EmailAustinWeather",
      },
    ],
  };
}

function fieldValue(plan: RoutinePlan, key: string): string | null {
  return plan.editableFields.find((field) => field.key === key)?.value ?? null;
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeJsonObject(parsed);
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function extractRecipientFromAsl(aslJson: unknown): string | null {
  const asl = normalizeJsonObject(aslJson);
  const states = normalizeJsonObject(asl.States);
  for (const state of Object.values(states)) {
    const s = normalizeJsonObject(state);
    if (!String(s.Comment ?? "").startsWith("recipe:email_send")) continue;
    const parameters = normalizeJsonObject(s.Parameters);
    const payload = normalizeJsonObject(parameters.Payload);
    const recipients = payload.to;
    if (Array.isArray(recipients) && typeof recipients[0] === "string") {
      return recipients[0];
    }
  }
  return null;
}

function unsupported(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
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
