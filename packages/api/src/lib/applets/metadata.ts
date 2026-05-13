import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";

export interface AppletMetadataV1 {
  schemaVersion: 1;
  kind: "computer_applet";
  appId: string;
  name: string;
  version: number;
  tenantId: string;
  threadId?: string;
  prompt?: string;
  agentVersion?: string;
  modelId?: string;
  generatedAt: string;
  stdlibVersionAtGeneration: string;
  sourceDigest?: string;
  draftPreview?: {
    draftId: string;
    sourceDigest: string;
    promotedAt: string;
    promotionProofExpiresAt?: string;
  };
  dataProvenance?: Record<string, unknown>;
  shadcnProvenance?: Record<string, unknown>;
  appletTheme?: {
    source?: string;
    css: string;
  };
}

export class AppletMetadataValidationError extends Error {
  constructor(readonly errors: ErrorObject[] | null | undefined) {
    super(formatAjvErrors(errors));
    this.name = "AppletMetadataValidationError";
  }
}

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

const appletMetadataSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "kind",
    "appId",
    "name",
    "version",
    "tenantId",
    "generatedAt",
    "stdlibVersionAtGeneration",
  ],
  properties: {
    schemaVersion: { const: 1 },
    kind: { const: "computer_applet" },
    appId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    version: { type: "integer", minimum: 1 },
    tenantId: { type: "string", minLength: 1 },
    threadId: { type: "string", minLength: 1 },
    prompt: { type: "string" },
    agentVersion: { type: "string", minLength: 1 },
    modelId: { type: "string", minLength: 1 },
    generatedAt: { type: "string", format: "date-time" },
    stdlibVersionAtGeneration: { type: "string", minLength: 1 },
    sourceDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    draftPreview: {
      type: "object",
      additionalProperties: false,
      required: ["draftId", "sourceDigest", "promotedAt"],
      properties: {
        draftId: { type: "string", minLength: 1 },
        sourceDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        promotedAt: { type: "string", format: "date-time" },
        promotionProofExpiresAt: { type: "string", format: "date-time" },
      },
    },
    dataProvenance: {
      type: "object",
      additionalProperties: true,
    },
    shadcnProvenance: {
      type: "object",
      additionalProperties: true,
    },
    appletTheme: {
      type: "object",
      additionalProperties: false,
      required: ["css"],
      properties: {
        source: { type: "string", minLength: 1 },
        css: { type: "string", minLength: 1, maxLength: 20000 },
      },
    },
  },
} as const;

const validateAppletMetadata = ajv.compile(appletMetadataSchema);

export function parseAppletMetadataV1(metadata: unknown): AppletMetadataV1 {
  if (!validateAppletMetadata(metadata)) {
    throw new AppletMetadataValidationError(validateAppletMetadata.errors);
  }
  return metadata as AppletMetadataV1;
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return "Applet metadata is invalid";
  return errors
    .map((error) => {
      const path = error.instancePath || "/";
      return `${path} ${error.message ?? "is invalid"}`;
    })
    .join("; ");
}
