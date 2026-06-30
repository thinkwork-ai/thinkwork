export interface PiExtensionManifestTool {
  name: string;
  description?: string | null;
}

export interface PiExtensionManifest {
  schemaVersion: number;
  name: string;
  displayName: string;
  description: string | null;
  runtimeTarget: string;
  entrypoint: string | null;
  tools: PiExtensionManifestTool[];
  lifecycleHooks: string[];
  permissionClasses: string[];
}

export class PiExtensionManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiExtensionManifestError";
  }
}

export const DEFAULT_PI_EXTENSION_MANIFEST_PATH = "pi-extension.json";

const MANIFEST_NAME_RE = /^[a-z][a-z0-9_-]{1,62}$/;
const TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const HOOK_NAME_RE = /^[a-z][a-z0-9_.:-]{0,63}$/;
const PERMISSION_CLASS_RE = /^[a-z][a-z0-9_.:-]{0,63}$/;

export function parsePiExtensionManifest(raw: string): PiExtensionManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PiExtensionManifestError("Extension manifest is not valid JSON");
  }
  return normalizePiExtensionManifest(parsed);
}

export function normalizePiExtensionManifest(
  value: unknown,
): PiExtensionManifest {
  const obj = objectValue(value, "Extension manifest");
  const schemaVersion = numberValue(obj.schemaVersion, "schemaVersion", 1);
  if (schemaVersion !== 1) {
    throw new PiExtensionManifestError(
      "Extension manifest schemaVersion must be 1",
    );
  }

  const name = stringValue(obj.name, "name");
  if (!MANIFEST_NAME_RE.test(name)) {
    throw new PiExtensionManifestError(
      "Extension manifest name must be lowercase letters, numbers, dashes, or underscores",
    );
  }

  const displayName =
    optionalString(obj.displayName, "displayName") ?? titleizeName(name);
  const description = optionalString(obj.description, "description");
  const runtimeTarget =
    optionalString(obj.runtimeTarget, "runtimeTarget") ?? "agentcore-pi";
  const entrypoint = optionalString(obj.entrypoint, "entrypoint");
  const tools = normalizeTools(obj.tools);
  const lifecycleHooks = normalizeStringArray(
    obj.lifecycleHooks,
    "lifecycleHooks",
    HOOK_NAME_RE,
  );
  const permissionClasses = normalizeStringArray(
    obj.permissionClasses ?? obj.permissions,
    "permissionClasses",
    PERMISSION_CLASS_RE,
  );

  return {
    schemaVersion,
    name,
    displayName,
    description,
    runtimeTarget,
    entrypoint,
    tools,
    lifecycleHooks,
    permissionClasses,
  };
}

function normalizeTools(value: unknown): PiExtensionManifestTool[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new PiExtensionManifestError(
      "Extension manifest tools must be an array",
    );
  }

  const tools = value.map((item, index) => {
    if (typeof item === "string") {
      return { name: item.trim() };
    }
    const obj = objectValue(item, `tools[${index}]`);
    return {
      name: stringValue(obj.name, `tools[${index}].name`),
      description: optionalString(
        obj.description,
        `tools[${index}].description`,
      ),
    };
  });

  const seen = new Set<string>();
  for (const tool of tools) {
    if (!TOOL_NAME_RE.test(tool.name)) {
      throw new PiExtensionManifestError(
        `Invalid extension tool name: ${tool.name}`,
      );
    }
    if (seen.has(tool.name)) {
      throw new PiExtensionManifestError(
        `Duplicate extension tool name: ${tool.name}`,
      );
    }
    seen.add(tool.name);
  }
  return tools;
}

function normalizeStringArray(
  value: unknown,
  field: string,
  pattern: RegExp,
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new PiExtensionManifestError(
      `Extension manifest ${field} must be an array`,
    );
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new PiExtensionManifestError(
        `Extension manifest ${field} entries must be non-empty strings`,
      );
    }
    const normalized = item.trim();
    if (!pattern.test(normalized)) {
      throw new PiExtensionManifestError(
        `Invalid extension ${field} entry: ${normalized}`,
      );
    }
    if (!seen.has(normalized)) {
      out.push(normalized);
      seen.add(normalized);
    }
  }
  return out;
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PiExtensionManifestError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PiExtensionManifestError(
      `Extension manifest ${field} must be a non-empty string`,
    );
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new PiExtensionManifestError(
      `Extension manifest ${field} must be a string`,
    );
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberValue(
  value: unknown,
  field: string,
  defaultValue: number,
): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new PiExtensionManifestError(
      `Extension manifest ${field} must be an integer`,
    );
  }
  return value;
}

function titleizeName(name: string): string {
  return name
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
