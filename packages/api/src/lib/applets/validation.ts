import { transform } from "sucrase";

export interface AppletValidationResult {
  ok: true;
}

export class AppletImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppletImportError";
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

export function validateAppletSource(source: string): AppletValidationResult {
  validateSyntax(source);
  validateImports(source);
  validateRuntimePatterns(source);
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
      `Applet imports may only reference react and @thinkwork/computer-stdlib; found ${specifier}`,
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
