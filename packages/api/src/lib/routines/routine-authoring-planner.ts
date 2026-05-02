import {
  getRecipe,
  getRecipeConfigFields,
  type AslState,
  type RecipeConfigField,
} from "./recipe-catalog.js";

export interface RoutinePlanInput {
  name: string;
  intent: string;
  recipient?: string | null;
}

export interface RoutinePlanStep {
  nodeId: string;
  recipeId: string;
  recipeName: string;
  label: string;
  args: Record<string, unknown>;
  configFields: RecipeConfigField[];
}

export interface RoutinePlan {
  kind: RoutineDefinitionKind;
  title: string;
  description: string;
  steps: RoutinePlanStep[];
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

export interface RoutineDefinitionStepConfigEdit {
  nodeId: string;
  args: Record<string, unknown>;
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
  return artifactsForPlan(weatherEmailPlan(displayName, recipient));
}

export function buildRoutineArtifactsFromPlan(
  plan: RoutinePlan,
): RoutinePlanResult {
  if (plan.kind !== "weather_email") {
    return unsupported(`Unsupported routine definition kind: ${plan.kind}`);
  }
  return artifactsForPlan(refreshPlanConfigFields(plan));
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
    const manifestPlan = planFromManifestDefinition(
      input.routineName,
      definition,
    );
    if (manifestPlan.ok) return manifestPlan;

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
  edits: RoutineDefinitionStepConfigEdit[],
): RoutinePlanResult {
  const next = refreshPlanConfigFields({
    ...plan,
    steps: plan.steps.map((step) => ({
      ...step,
      args: { ...step.args },
      configFields: step.configFields.map((field) => ({ ...field })),
    })),
  });

  for (const edit of edits) {
    const step = next.steps.find(
      (candidate) => candidate.nodeId === edit.nodeId,
    );
    if (!step) {
      return unsupported(`Unsupported routine definition step: ${edit.nodeId}`);
    }

    const submitted = normalizeJsonObject(edit.args);
    const fieldsByKey = new Map(
      step.configFields.map((field) => [field.key, field]),
    );

    for (const [key, rawValue] of Object.entries(submitted)) {
      const field = fieldsByKey.get(key);
      if (!field) {
        return unsupported(
          `Unsupported routine definition field: ${edit.nodeId}.${key}`,
        );
      }

      const normalized = normalizeConfigValue(field, rawValue);
      if (!normalized.ok) return normalized;

      if (!field.editable) {
        if (!sameJson(normalized.value, step.args[key] ?? null)) {
          return unsupported(`${field.label} is read-only.`);
        }
        continue;
      }

      step.args[key] = normalized.value;
    }
  }

  const refreshed = refreshPlanConfigFields(next);
  const validation = validateRequiredConfig(refreshed);
  if (!validation.ok) return validation;

  return buildRoutineArtifactsFromPlan(refreshed);
}

function artifactsForPlan(plan: RoutinePlan): RoutinePlanResult {
  if (plan.steps.length === 0) {
    return unsupported("Routine definition must include at least one step.");
  }

  const validation = validateRequiredConfig(plan);
  if (!validation.ok) return validation;

  const states: Record<string, AslState> = {};
  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index]!;
    const recipe = getRecipe(step.recipeId);
    if (!recipe) {
      return unsupported(
        `Routine authoring is misconfigured: required recipe ${step.recipeId} is missing.`,
      );
    }
    const nextStep = plan.steps[index + 1] ?? null;
    const state = recipe.aslEmitter(step.args, {
      stateName: step.nodeId,
      next: nextStep?.nodeId ?? null,
      end: nextStep == null,
    });
    states[step.nodeId] = {
      ...state,
      ResultPath: `$.${step.nodeId}`,
    };
  }

  const description = descriptionForPlan(plan);
  const markdownSummary = markdownSummaryForPlan({ ...plan, description });

  return {
    ok: true,
    artifacts: {
      plan: refreshPlanConfigFields({ ...plan, description }),
      asl: {
        Comment: `Routine authored from intent: ${plan.title}`,
        StartAt: plan.steps[0]?.nodeId,
        States: states,
      },
      markdownSummary,
      stepManifest: {
        definition: {
          kind: plan.kind,
          steps: plan.steps.map((step) => ({
            nodeId: step.nodeId,
            recipeId: step.recipeId,
            label: step.label,
            args: step.args,
          })),
        },
        steps: plan.steps.map((step) => ({
          nodeId: step.nodeId,
          recipeType: step.recipeId,
          label: step.label,
          args: step.args,
        })),
      },
    },
  };
}

function weatherEmailPlan(displayName: string, recipient: string): RoutinePlan {
  return refreshPlanConfigFields({
    kind: "weather_email",
    title: displayName,
    description: `Fetches the current weather for Austin, Texas and emails the summary to ${recipient}.`,
    steps: [
      {
        nodeId: "FetchAustinWeather",
        recipeId: "python",
        recipeName: "Run Python code",
        label: "Fetch Austin weather",
        args: {
          code: weatherPython(),
          timeoutSeconds: 30,
          networkAllowlist: ["wttr.in"],
        },
        configFields: [],
      },
      {
        nodeId: "EmailAustinWeather",
        recipeId: "email_send",
        recipeName: "Send email",
        label: "Email Austin weather",
        args: {
          to: [recipient],
          subject: "Austin weather update",
          bodyPath: "$.FetchAustinWeather.stdoutPreview",
          bodyFormat: "markdown",
        },
        configFields: [],
      },
    ],
  });
}

function planFromManifestDefinition(
  routineName: string,
  definition: Record<string, unknown>,
): RoutineDefinitionResult {
  if (!Array.isArray(definition.steps)) {
    return unsupported("Routine definition manifest does not include steps.");
  }

  const steps: RoutinePlanStep[] = [];
  for (const value of definition.steps) {
    const entry = normalizeJsonObject(value);
    const recipeId = String(entry.recipeId ?? entry.recipeType ?? "").trim();
    const nodeId = String(entry.nodeId ?? "").trim();
    const label = String(entry.label ?? nodeId).trim();
    const args = normalizeJsonObject(entry.args);
    const recipe = getRecipe(recipeId);
    if (!nodeId || !recipe) {
      return unsupported(
        "Routine definition manifest includes an unknown step.",
      );
    }
    steps.push({
      nodeId,
      recipeId,
      recipeName: recipe.displayName,
      label,
      args,
      configFields: getRecipeConfigFields(recipeId, args),
    });
  }

  const plan = refreshPlanConfigFields({
    kind: "weather_email",
    title: routineName,
    description: "",
    steps,
  });

  return {
    ok: true,
    plan: {
      ...plan,
      description: descriptionForPlan(plan),
    },
  };
}

function refreshPlanConfigFields(plan: RoutinePlan): RoutinePlan {
  return {
    ...plan,
    steps: plan.steps.map((step) => {
      const recipe = getRecipe(step.recipeId);
      return {
        ...step,
        recipeName: recipe?.displayName ?? step.recipeName ?? step.recipeId,
        configFields: getRecipeConfigFields(step.recipeId, step.args),
      };
    }),
  };
}

function validateRequiredConfig(
  plan: RoutinePlan,
): { ok: true } | { ok: false; reason: string } {
  for (const step of plan.steps) {
    for (const field of step.configFields) {
      if (!field.required) continue;
      const normalized = normalizeConfigValue(field, step.args[field.key]);
      if (!normalized.ok) return normalized;
    }
  }
  return { ok: true };
}

function normalizeConfigValue(
  field: RecipeConfigField,
  rawValue: unknown,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (field.inputType === "email_array") {
    const emails = normalizeStringList(rawValue);
    if (field.required && emails.length === 0) {
      return unsupported(
        `Enter at least one email address for ${field.label}.`,
      );
    }
    for (const email of emails) {
      if (!EMAIL_VALUE_RE.test(email)) {
        return unsupported(`Enter valid email addresses for ${field.label}.`);
      }
    }
    return { ok: true, value: emails };
  }

  if (field.inputType === "string_array") {
    return { ok: true, value: normalizeStringList(rawValue) };
  }

  if (field.inputType === "number") {
    const value =
      typeof rawValue === "number"
        ? rawValue
        : typeof rawValue === "string" && rawValue.trim()
          ? Number(rawValue)
          : null;
    if (field.required && value == null) {
      return unsupported(`Enter a value for ${field.label}.`);
    }
    if (value == null) return { ok: true, value: null };
    if (!Number.isFinite(value)) {
      return unsupported(`Enter a number for ${field.label}.`);
    }
    return { ok: true, value };
  }

  const value = typeof rawValue === "string" ? rawValue.trim() : rawValue;
  if (field.required && (!value || typeof value !== "string")) {
    return unsupported(`Enter a value for ${field.label}.`);
  }
  if (field.inputType === "select") {
    const options = field.options ?? [];
    if (typeof value !== "string" || !options.includes(value)) {
      return unsupported(`Choose a valid value for ${field.label}.`);
    }
  }
  return { ok: true, value: value ?? null };
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function descriptionForPlan(plan: RoutinePlan): string {
  if (plan.kind === "weather_email") {
    const recipient = weatherEmailRecipient(plan);
    if (recipient) {
      return `Fetches the current weather for Austin, Texas and emails the summary to ${recipient}.`;
    }
  }
  return plan.description;
}

function markdownSummaryForPlan(plan: RoutinePlan): string {
  const recipient = weatherEmailRecipient(plan);
  if (plan.kind === "weather_email" && recipient) {
    return [
      `# ${plan.title}`,
      "",
      `Fetches the current weather for Austin, Texas and emails the summary to ${recipient}.`,
      "",
      "## Steps",
      "",
      "1. Fetch the current Austin weather from wttr.in using the Python sandbox.",
      "2. Email the weather summary using the tenant email-send Lambda.",
    ].join("\n");
  }

  return [
    `# ${plan.title}`,
    "",
    plan.description,
    "",
    "## Steps",
    "",
    ...plan.steps.map(
      (step, index) => `${index + 1}. ${step.label} (${step.recipeName}).`,
    ),
  ].join("\n");
}

function weatherEmailRecipient(plan: RoutinePlan): string | null {
  const emailStep = plan.steps.find((step) => step.recipeId === "email_send");
  const to = emailStep?.args.to;
  if (Array.isArray(to) && typeof to[0] === "string") return to[0];
  return null;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
