export const RUNBOOK_CAPABILITY_ROLES = [
  "research",
  "analysis",
  "artifact_build",
  "map_build",
  "validation",
] as const;

export type RunbookCapabilityRole = (typeof RUNBOOK_CAPABILITY_ROLES)[number];

const knownRoles = new Set<string>(RUNBOOK_CAPABILITY_ROLES);

export function isKnownCapabilityRole(
  value: string,
): value is RunbookCapabilityRole {
  return knownRoles.has(value);
}

export function isExperimentalCapabilityRole(value: string) {
  return value.startsWith("experimental:");
}

export function isAllowedCapabilityRole(value: string) {
  return isKnownCapabilityRole(value) || isExperimentalCapabilityRole(value);
}

export const RUNBOOK_OVERRIDE_FIELDS = [
  "catalog.displayName",
  "catalog.description",
  "approval.summary",
  "approval.expectedOutputs",
  "routing.triggerExamples",
] as const;

export type RunbookOverrideField = (typeof RUNBOOK_OVERRIDE_FIELDS)[number];

export type RunbookInputDefinition = {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  source: "user" | "context" | "system";
};

export type RunbookPhaseDefinition = {
  id: string;
  title: string;
  guidance: string;
  guidanceMarkdown: string;
  capabilityRoles: string[];
  dependsOn: string[];
  taskSeeds: string[];
  supervision?: {
    staleAfterMinutes?: number;
    progressExpectation?: string;
  };
};

export type RunbookOutputDefinition = {
  id: string;
  title: string;
  type: "artifact" | "summary" | "evidence" | "dataset" | "map";
  description: string;
};

export type RunbookDefinition = {
  slug: string;
  version: string;
  catalog: {
    displayName: string;
    description: string;
    category: "dashboard" | "artifact" | "research" | "map";
  };
  routing: {
    explicitAliases: string[];
    triggerExamples: string[];
    confidenceHints: string[];
  };
  inputs: RunbookInputDefinition[];
  approval: {
    title: string;
    summary: string;
    expectedOutputs: string[];
    likelyTools: string[];
    phaseSummary: string[];
  };
  phases: RunbookPhaseDefinition[];
  outputs: RunbookOutputDefinition[];
  overrides: {
    allowedFields: RunbookOverrideField[];
  };
};

export class RunbookValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = "RunbookValidationError";
  }
}

export function validateRunbookDefinition(value: unknown): RunbookDefinition {
  const issues: string[] = [];
  const runbook = objectAt(value, "runbook", issues);

  const slug = stringAt(runbook.slug, "slug", issues);
  const version = stringAt(runbook.version, "version", issues);

  const catalog = objectAt(runbook.catalog, "catalog", issues);
  const displayName = stringAt(
    catalog.displayName,
    "catalog.displayName",
    issues,
  );
  const description = stringAt(
    catalog.description,
    "catalog.description",
    issues,
  );
  const category = enumAt(
    catalog.category,
    "catalog.category",
    ["dashboard", "artifact", "research", "map"],
    issues,
  );

  const routing = objectAt(runbook.routing, "routing", issues);
  const explicitAliases = stringArrayAt(
    routing.explicitAliases,
    "routing.explicitAliases",
    issues,
  );
  const triggerExamples = nonEmptyStringArrayAt(
    routing.triggerExamples,
    "routing.triggerExamples",
    issues,
  );
  const confidenceHints = stringArrayAt(
    routing.confidenceHints,
    "routing.confidenceHints",
    issues,
  );

  const inputs = arrayAt(runbook.inputs, "inputs", issues).map(
    (input, index) => {
      const prefix = `inputs[${index}]`;
      const item = objectAt(input, prefix, issues);
      return {
        id: stringAt(item.id, `${prefix}.id`, issues),
        label: stringAt(item.label, `${prefix}.label`, issues),
        description: optionalStringAt(
          item.description,
          `${prefix}.description`,
          issues,
        ),
        required: booleanAt(item.required, `${prefix}.required`, issues),
        source: enumAt(
          item.source,
          `${prefix}.source`,
          ["user", "context", "system"],
          issues,
        ),
      };
    },
  );

  const approval = objectAt(runbook.approval, "approval", issues);
  const approvalTitle = stringAt(approval.title, "approval.title", issues);
  const approvalSummary = stringAt(
    approval.summary,
    "approval.summary",
    issues,
  );
  const expectedOutputs = nonEmptyStringArrayAt(
    approval.expectedOutputs,
    "approval.expectedOutputs",
    issues,
  );
  const likelyTools = stringArrayAt(
    approval.likelyTools,
    "approval.likelyTools",
    issues,
  );
  const phaseSummary = nonEmptyStringArrayAt(
    approval.phaseSummary,
    "approval.phaseSummary",
    issues,
  );

  const phases = nonEmptyArrayAt(runbook.phases, "phases", issues).map(
    (phase, index) => {
      const prefix = `phases[${index}]`;
      const item = objectAt(phase, prefix, issues);
      const capabilityRoles = nonEmptyStringArrayAt(
        item.capabilityRoles,
        `${prefix}.capabilityRoles`,
        issues,
      );
      for (const role of capabilityRoles) {
        if (!isAllowedCapabilityRole(role)) {
          issues.push(
            `${prefix}.capabilityRoles contains unknown role "${role}"`,
          );
        }
      }
      const supervision = optionalSupervisionAt(
        item.supervision,
        `${prefix}.supervision`,
        issues,
      );
      return {
        id: stringAt(item.id, `${prefix}.id`, issues),
        title: stringAt(item.title, `${prefix}.title`, issues),
        guidance: stringAt(item.guidance, `${prefix}.guidance`, issues),
        guidanceMarkdown: "",
        capabilityRoles,
        dependsOn: stringArrayAt(item.dependsOn, `${prefix}.dependsOn`, issues),
        taskSeeds: nonEmptyStringArrayAt(
          item.taskSeeds,
          `${prefix}.taskSeeds`,
          issues,
        ),
        ...(supervision ? { supervision } : {}),
      };
    },
  );

  const outputs = nonEmptyArrayAt(runbook.outputs, "outputs", issues).map(
    (output, index) => {
      const prefix = `outputs[${index}]`;
      const item = objectAt(output, prefix, issues);
      return {
        id: stringAt(item.id, `${prefix}.id`, issues),
        title: stringAt(item.title, `${prefix}.title`, issues),
        type: enumAt(
          item.type,
          `${prefix}.type`,
          ["artifact", "summary", "evidence", "dataset", "map"],
          issues,
        ),
        description: stringAt(
          item.description,
          `${prefix}.description`,
          issues,
        ),
      };
    },
  );

  const overrides = objectAt(runbook.overrides, "overrides", issues);
  const allowedFields = stringArrayAt(
    overrides.allowedFields,
    "overrides.allowedFields",
    issues,
  );
  for (const field of allowedFields) {
    if (!RUNBOOK_OVERRIDE_FIELDS.includes(field as RunbookOverrideField)) {
      issues.push(
        `overrides.allowedFields contains unsupported field "${field}"`,
      );
    }
  }

  const phaseIds = new Set<string>();
  for (const phase of phases) {
    if (phaseIds.has(phase.id))
      issues.push(`phases duplicate id "${phase.id}"`);
    phaseIds.add(phase.id);
  }
  for (const phase of phases) {
    for (const dependency of phase.dependsOn) {
      if (!phaseIds.has(dependency)) {
        issues.push(
          `phase "${phase.id}" depends on unknown phase "${dependency}"`,
        );
      }
    }
  }

  const inputIds = new Set<string>();
  for (const input of inputs) {
    if (inputIds.has(input.id))
      issues.push(`inputs duplicate id "${input.id}"`);
    inputIds.add(input.id);
  }

  const outputIds = new Set<string>();
  for (const output of outputs) {
    if (outputIds.has(output.id)) {
      issues.push(`outputs duplicate id "${output.id}"`);
    }
    outputIds.add(output.id);
  }

  if (issues.length > 0) {
    throw new RunbookValidationError("Invalid runbook definition", issues);
  }

  return {
    slug,
    version,
    catalog: { displayName, description, category },
    routing: { explicitAliases, triggerExamples, confidenceHints },
    inputs,
    approval: {
      title: approvalTitle,
      summary: approvalSummary,
      expectedOutputs,
      likelyTools,
      phaseSummary,
    },
    phases,
    outputs,
    overrides: { allowedFields: allowedFields as RunbookOverrideField[] },
  };
}

function objectAt(
  value: unknown,
  path: string,
  issues: string[],
): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  issues.push(`${path} must be an object`);
  return {};
}

function stringAt(value: unknown, path: string, issues: string[]) {
  if (typeof value === "string" && value.trim().length > 0) return value;
  issues.push(`${path} must be a non-empty string`);
  return "";
}

function optionalStringAt(value: unknown, path: string, issues: string[]) {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  issues.push(`${path} must be a string when provided`);
  return undefined;
}

function optionalSupervisionAt(value: unknown, path: string, issues: string[]) {
  if (value === undefined) return undefined;
  const item = objectAt(value, path, issues);
  const supervision: {
    staleAfterMinutes?: number;
    progressExpectation?: string;
  } = {};

  if (item.staleAfterMinutes !== undefined) {
    if (
      typeof item.staleAfterMinutes === "number" &&
      Number.isInteger(item.staleAfterMinutes) &&
      item.staleAfterMinutes >= 1 &&
      item.staleAfterMinutes <= 120
    ) {
      supervision.staleAfterMinutes = item.staleAfterMinutes;
    } else {
      issues.push(`${path}.staleAfterMinutes must be an integer from 1 to 120`);
    }
  }

  const progressExpectation = optionalStringAt(
    item.progressExpectation,
    `${path}.progressExpectation`,
    issues,
  );
  if (progressExpectation) {
    supervision.progressExpectation = progressExpectation;
  }

  return supervision;
}

function booleanAt(value: unknown, path: string, issues: string[]) {
  if (typeof value === "boolean") return value;
  issues.push(`${path} must be a boolean`);
  return false;
}

function enumAt<const T extends readonly string[]>(
  value: unknown,
  path: string,
  allowed: T,
  issues: string[],
): T[number] {
  if (typeof value === "string" && allowed.includes(value)) {
    return value as T[number];
  }
  issues.push(`${path} must be one of: ${allowed.join(", ")}`);
  return allowed[0];
}

function arrayAt(value: unknown, path: string, issues: string[]) {
  if (Array.isArray(value)) return value;
  issues.push(`${path} must be an array`);
  return [];
}

function nonEmptyArrayAt(value: unknown, path: string, issues: string[]) {
  const array = arrayAt(value, path, issues);
  if (array.length === 0) issues.push(`${path} must not be empty`);
  return array;
}

function stringArrayAt(value: unknown, path: string, issues: string[]) {
  const array = arrayAt(value, path, issues);
  const strings: string[] = [];
  for (const [index, item] of array.entries()) {
    if (typeof item === "string" && item.trim().length > 0) {
      strings.push(item);
    } else {
      issues.push(`${path}[${index}] must be a non-empty string`);
    }
  }
  return strings;
}

function nonEmptyStringArrayAt(value: unknown, path: string, issues: string[]) {
  const strings = stringArrayAt(value, path, issues);
  if (strings.length === 0) issues.push(`${path} must not be empty`);
  return strings;
}
