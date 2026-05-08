import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";

export type DashboardKind = "pipeline_risk";
export type DashboardSourceProvider = "crm" | "email" | "calendar" | "web";
export type DashboardSourceStatus = "success" | "partial" | "failed";
export type DashboardViewComponentType =
  | "kpi_strip"
  | "stage_chart"
  | "product_exposure"
  | "risk_table"
  | "evidence_drawer"
  | "source_coverage"
  | "refresh_control";

export interface DashboardManifestV1 {
  schemaVersion: 1;
  dashboardKind: DashboardKind;
  snapshot: DashboardSnapshotV1;
  recipe: DashboardRecipeV1;
  sources: DashboardSourceCoverageV1[];
  views: DashboardViewV1[];
  tables: DashboardTableV1[];
  charts: DashboardChartV1[];
  evidence: DashboardEvidenceV1[];
  refresh: DashboardRefreshV1;
}

export interface DashboardSnapshotV1 {
  id: string;
  artifactId: string;
  threadId: string;
  title: string;
  summary: string;
  generatedAt: string;
}

export interface DashboardRecipeV1 {
  id: string;
  version: number;
  dashboardKind: DashboardKind;
  steps: DashboardRecipeStepV1[];
}

export type DashboardRecipeStepV1 =
  | {
      type: "source_query";
      id: string;
      provider: DashboardSourceProvider;
      queryId: string;
      params?: Record<string, string | number | boolean | null>;
    }
  | {
      type: "transform";
      id: string;
      transformId: "pipeline_risk_normalize";
      inputStepIds: string[];
    }
  | {
      type: "score";
      id: string;
      scoringModel: "pipeline_risk_v1";
      inputStepIds: string[];
    }
  | {
      type: "template_summary";
      id: string;
      templateId: "pipeline_risk_summary_v1";
      inputStepIds: string[];
    };

export interface DashboardSourceCoverageV1 {
  id: string;
  provider: DashboardSourceProvider;
  status: DashboardSourceStatus;
  asOf: string;
  recordCount: number;
  safeDisplayError?: string;
}

export interface DashboardViewV1 {
  id: string;
  title: string;
  component: DashboardViewComponentType;
  sourceIds: string[];
}

export interface DashboardTableV1 {
  id: string;
  title: string;
  columns: Array<{
    id: string;
    label: string;
    valueType: "text" | "number" | "currency" | "date" | "percent" | "risk";
  }>;
  rows: Array<Record<string, string | number | boolean | null>>;
}

export interface DashboardChartV1 {
  id: string;
  title: string;
  chartType: "bar" | "stacked_bar" | "line" | "donut";
  data: Array<Record<string, string | number | null>>;
}

export interface DashboardEvidenceV1 {
  id: string;
  sourceId: string;
  title: string;
  snippet: string;
  url?: string;
  fetchedAt: string;
}

export interface DashboardRefreshV1 {
  enabled: boolean;
  recipeVersion: number;
  lastRefreshAt?: string;
  nextAllowedAt?: string;
}

export class DashboardManifestValidationError extends Error {
  constructor(readonly errors: ErrorObject[] | null | undefined) {
    super(formatAjvErrors(errors));
    this.name = "DashboardManifestValidationError";
  }
}

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

const stringMapSchema = {
  type: "object",
  additionalProperties: {
    anyOf: [
      { type: "string" },
      { type: "number" },
      { type: "boolean" },
      { type: "null" },
    ],
  },
} as const;

const manifestSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "dashboardKind",
    "snapshot",
    "recipe",
    "sources",
    "views",
    "tables",
    "charts",
    "evidence",
    "refresh",
  ],
  properties: {
    schemaVersion: { const: 1 },
    dashboardKind: { const: "pipeline_risk" },
    snapshot: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "artifactId",
        "threadId",
        "title",
        "summary",
        "generatedAt",
      ],
      properties: {
        id: { type: "string", minLength: 1 },
        artifactId: { type: "string", minLength: 1 },
        threadId: { type: "string", minLength: 1 },
        title: { type: "string", minLength: 1 },
        summary: { type: "string", minLength: 1 },
        generatedAt: { type: "string", format: "date-time" },
      },
    },
    recipe: {
      type: "object",
      additionalProperties: false,
      required: ["id", "version", "dashboardKind", "steps"],
      properties: {
        id: { type: "string", minLength: 1 },
        version: { type: "integer", minimum: 1 },
        dashboardKind: { const: "pipeline_risk" },
        steps: {
          type: "array",
          minItems: 1,
          items: {
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["type", "id", "provider", "queryId"],
                properties: {
                  type: { const: "source_query" },
                  id: { type: "string", minLength: 1 },
                  provider: {
                    enum: ["crm", "email", "calendar", "web"],
                  },
                  queryId: { type: "string", minLength: 1 },
                  params: stringMapSchema,
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["type", "id", "transformId", "inputStepIds"],
                properties: {
                  type: { const: "transform" },
                  id: { type: "string", minLength: 1 },
                  transformId: { const: "pipeline_risk_normalize" },
                  inputStepIds: {
                    type: "array",
                    minItems: 1,
                    items: { type: "string", minLength: 1 },
                  },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["type", "id", "scoringModel", "inputStepIds"],
                properties: {
                  type: { const: "score" },
                  id: { type: "string", minLength: 1 },
                  scoringModel: { const: "pipeline_risk_v1" },
                  inputStepIds: {
                    type: "array",
                    minItems: 1,
                    items: { type: "string", minLength: 1 },
                  },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["type", "id", "templateId", "inputStepIds"],
                properties: {
                  type: { const: "template_summary" },
                  id: { type: "string", minLength: 1 },
                  templateId: { const: "pipeline_risk_summary_v1" },
                  inputStepIds: {
                    type: "array",
                    minItems: 1,
                    items: { type: "string", minLength: 1 },
                  },
                },
              },
            ],
          },
        },
      },
    },
    sources: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "provider", "status", "asOf", "recordCount"],
        properties: {
          id: { type: "string", minLength: 1 },
          provider: { enum: ["crm", "email", "calendar", "web"] },
          status: { enum: ["success", "partial", "failed"] },
          asOf: { type: "string", format: "date-time" },
          recordCount: { type: "integer", minimum: 0 },
          safeDisplayError: { type: "string", minLength: 1 },
        },
      },
    },
    views: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "component", "sourceIds"],
        properties: {
          id: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          component: {
            enum: [
              "kpi_strip",
              "stage_chart",
              "product_exposure",
              "risk_table",
              "evidence_drawer",
              "source_coverage",
              "refresh_control",
            ],
          },
          sourceIds: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
        },
      },
    },
    tables: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "columns", "rows"],
        properties: {
          id: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          columns: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label", "valueType"],
              properties: {
                id: { type: "string", minLength: 1 },
                label: { type: "string", minLength: 1 },
                valueType: {
                  enum: [
                    "text",
                    "number",
                    "currency",
                    "date",
                    "percent",
                    "risk",
                  ],
                },
              },
            },
          },
          rows: {
            type: "array",
            items: stringMapSchema,
          },
        },
      },
    },
    charts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "chartType", "data"],
        properties: {
          id: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          chartType: { enum: ["bar", "stacked_bar", "line", "donut"] },
          data: {
            type: "array",
            items: stringMapSchema,
          },
        },
      },
    },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "sourceId", "title", "snippet", "fetchedAt"],
        properties: {
          id: { type: "string", minLength: 1 },
          sourceId: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          snippet: { type: "string", minLength: 1 },
          url: { type: "string", format: "uri" },
          fetchedAt: { type: "string", format: "date-time" },
        },
      },
    },
    refresh: {
      type: "object",
      additionalProperties: false,
      required: ["enabled", "recipeVersion"],
      properties: {
        enabled: { type: "boolean" },
        recipeVersion: { type: "integer", minimum: 1 },
        lastRefreshAt: { type: "string", format: "date-time" },
        nextAllowedAt: { type: "string", format: "date-time" },
      },
    },
  },
} as const;

const validate = ajv.compile(manifestSchema);

export function parseDashboardManifestV1(
  value: unknown,
): DashboardManifestV1 {
  if (!validate(value)) {
    throw new DashboardManifestValidationError(validate.errors);
  }
  return value as DashboardManifestV1;
}

export function isDashboardManifestV1(
  value: unknown,
): value is DashboardManifestV1 {
  return validate(value) as boolean;
}

export function sanitizeDashboardManifestV1(
  value: unknown,
): DashboardManifestV1 {
  const manifest = parseDashboardManifestV1(value);
  return JSON.parse(JSON.stringify(manifest)) as DashboardManifestV1;
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return "Invalid dashboard manifest";
  const details = errors
    .slice(0, 5)
    .map((error) => {
      const path = error.instancePath || "/";
      return `${path} ${error.message ?? "is invalid"}`;
    })
    .join("; ");
  return `Invalid dashboard manifest: ${details}`;
}
