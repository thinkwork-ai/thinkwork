/**
 * Loose JSON Schema type. Recipe argSchemas are JSON Schema (draft 2019-09)
 * fragments — keeping the type as a structural object lets us avoid pulling
 * the full JSON-Schema TypeScript types in for the catalog and validator.
 * The validator uses Ajv at runtime to enforce conformance; this type is
 * only for compile-time shape hints.
 */
export type JsonSchema7Type = {
  type?: string | string[];
  properties?: Record<string, JsonSchema7Type>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema7Type;
  items?: JsonSchema7Type | JsonSchema7Type[];
  enum?: unknown[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  format?: string;
  nullable?: boolean;
  [key: string]: unknown;
};
