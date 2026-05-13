import { transform } from "sucrase";

export interface AppletValidationResult {
  ok: true;
}

export interface AppletValidationOptions {
  metadata?: unknown;
  name?: string | null;
}

export class AppletImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppletImportError";
  }
}

export class AppletQualityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppletQualityError";
  }
}

export class AppletRuntimePatternError extends Error {
  constructor(
    readonly pattern: string,
    readonly line: number,
  ) {
    super(
      `Applet source uses forbidden runtime pattern ${pattern} on line ${line}`,
    );
    this.name = "AppletRuntimePatternError";
  }
}

export class AppletSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppletSyntaxError";
  }
}

const ALLOWED_IMPORTS = new Set([
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@thinkwork/ui",
  "@thinkwork/computer-stdlib",
  "lucide-react",
  "@tabler/icons-react",
  "useAppletAPI",
]);

const FORBIDDEN_RUNTIME_PATTERNS = [
  { label: "\\bfetch\\b", regex: /\bfetch\w*/ },
  { label: "\\bXMLHttpRequest\\b", regex: /\bXMLHttpRequest\b/ },
  { label: "\\bWebSocket\\b", regex: /\bWebSocket\b/ },
  { label: "\\bglobalThis\\b", regex: /\bglobalThis\b/ },
  { label: "\\bReflect\\b", regex: /\bReflect\b/ },
  { label: "\\bFunction\\s*\\(", regex: /\bFunction\s*\(/ },
  { label: "\\bimport\\s*\\(", regex: /\bimport\s*\(/ },
  { label: "\\blocalStorage\\b", regex: /\blocalStorage\b/ },
  { label: "\\bsessionStorage\\b", regex: /\bsessionStorage\b/ },
  { label: "\\bdocument\\.cookie\\b", regex: /\bdocument\.cookie\b/ },
  { label: "\\bnew Function\\b", regex: /\bnew\s+Function\b/ },
  { label: "\\beval\\b", regex: /\beval\b/ },
] as const;

export function validateAppletSource(
  source: string,
  options: AppletValidationOptions = {},
): AppletValidationResult {
  validateSyntax(source);
  validateImports(source);
  validateRuntimePatterns(source);
  validateQuality(source, options);
  return { ok: true };
}

function validateSyntax(source: string) {
  try {
    transform(source, {
      transforms: ["typescript", "jsx"],
      production: true,
      jsxRuntime: "automatic",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AppletSyntaxError(message);
  }
}

function validateImports(source: string) {
  const staticImports =
    /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImports = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const specifier of collectImportSpecifiers(source, staticImports)) {
    assertAllowedImport(specifier);
  }
  for (const specifier of collectImportSpecifiers(source, dynamicImports)) {
    assertAllowedImport(specifier);
  }
}

function collectImportSpecifiers(
  source: string,
  pattern: RegExp,
): string[] {
  const specifiers: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const specifier = match[1];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

function assertAllowedImport(specifier: string) {
  if (!ALLOWED_IMPORTS.has(specifier)) {
    throw new AppletImportError(
      `Applet imports may only reference react, @thinkwork/ui, @thinkwork/computer-stdlib, lucide-react, and @tabler/icons-react; found ${specifier}`,
    );
  }
}

function validateRuntimePatterns(source: string) {
  const lines = source.split(/\r?\n/);
  for (const forbidden of FORBIDDEN_RUNTIME_PATTERNS) {
    for (const [index, line] of lines.entries()) {
      if (forbidden.regex.test(line)) {
        throw new AppletRuntimePatternError(forbidden.label, index + 1);
      }
    }
  }
}

function validateQuality(source: string, options: AppletValidationOptions) {
  if (!isCrmDashboardApplet(options)) return;

  if (!importsSpecifier(source, "@thinkwork/ui")) {
    throw new AppletQualityError(
      "CRM_DASHBOARD_UI_IMPORT_REQUIRED",
      "CRM dashboard applets must import shadcn-compatible components from @thinkwork/ui before save_app.",
    );
  }

  if (!/<(?:Card|KpiStrip)\b/.test(source)) {
    throw new AppletQualityError(
      "CRM_DASHBOARD_METRIC_COMPONENT_REQUIRED",
      "CRM dashboard applets must render metric panels with Card or KpiStrip components.",
    );
  }

  if (!/<(?:DataTable|Table)\b/.test(source)) {
    throw new AppletQualityError(
      "CRM_DASHBOARD_TABLE_COMPONENT_REQUIRED",
      "CRM dashboard applets must render entity-level data with DataTable or Table components.",
    );
  }

  if (/<\s*table\b/.test(source)) {
    throw new AppletQualityError(
      "CRM_DASHBOARD_RAW_TABLE_FORBIDDEN",
      "CRM dashboard applets must use DataTable or Table components, not raw <table> markup.",
    );
  }

  if (/<\s*button\b/.test(source)) {
    throw new AppletQualityError(
      "CRM_DASHBOARD_RAW_BUTTON_FORBIDDEN",
      "CRM dashboard applets must use Button from @thinkwork/ui, not raw <button> markup.",
    );
  }

  if (/\p{Extended_Pictographic}/u.test(source)) {
    throw new AppletQualityError(
      "CRM_DASHBOARD_EMOJI_FORBIDDEN",
      "CRM dashboard applets must not use emoji icons or decorative emoji text.",
    );
  }
}

function importsSpecifier(source: string, specifier: string) {
  const importPattern =
    /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  return collectImportSpecifiers(source, importPattern).includes(specifier);
}

function isCrmDashboardApplet(options: AppletValidationOptions) {
  const metadata = normalizeMetadata(options.metadata);
  const candidates = [
    options.name,
    metadata?.recipe,
    metadata?.runbookSlug,
    metadata?.dataShape,
    metadata?.thinkwork_runbook_slug,
    metadata?.thinkworkRunbookSlug,
    metadata?.kind,
  ];

  return candidates.some((candidate) => {
    if (typeof candidate !== "string") return false;
    const normalized = candidate.toLowerCase();
    return (
      normalized.includes("crm-dashboard") ||
      normalized.includes("crmdashboarddata") ||
      (normalized.includes("crm") && normalized.includes("dashboard"))
    );
  });
}

function normalizeMetadata(metadata: unknown): Record<string, unknown> | null {
  if (isRecord(metadata)) return metadata;
  if (typeof metadata !== "string") return null;
  try {
    const parsed = JSON.parse(metadata);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
