import {
  generatedAppPolicy,
  type GeneratedAppPackagePolicy,
} from "@thinkwork/ui/generated-app-policy";

export class AppletSourcePolicyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppletSourcePolicyError";
  }
}

type ImportBinding =
  | { kind: "default"; local: string }
  | { kind: "namespace"; local: string }
  | { kind: "named"; imported: string; local: string };

interface ImportDeclaration {
  specifier: string;
  bindings: ImportBinding[];
}

const POLICY_PACKAGES = generatedAppPolicy.packages;
const RAW_ELEMENT_REPLACEMENTS = generatedAppPolicy.rawElementReplacements;
const RAW_ELEMENT_NAMES = Object.keys(RAW_ELEMENT_REPLACEMENTS);
const CARD_CLASS_PATTERN =
  /\bclassName\s*=\s*(?:"[^"]*(?:rounded|border|shadow|bg-(?!background|card|muted|popover|accent|primary|secondary|destructive))[^"]*"|'[^']*(?:rounded|border|shadow|bg-(?!background|card|muted|popover|accent|primary|secondary|destructive))[^']*')/;

export function validateGeneratedAppSourcePolicy(source: string) {
  const imports = parseImportDeclarations(source);
  validateGeneratedAppImports(imports);
  validateGeneratedAppStructure(source, imports);
}

export function validateGeneratedAppImports(imports: ImportDeclaration[]) {
  for (const declaration of imports) {
    const packagePolicy = POLICY_PACKAGES[
      declaration.specifier as keyof typeof POLICY_PACKAGES
    ] as GeneratedAppPackagePolicy | undefined;
    if (!packagePolicy) {
      throw new AppletSourcePolicyError(
        "APPLET_IMPORT_DISALLOWED",
        `Applet imports may only reference approved generated-app packages; found ${declaration.specifier}.`,
      );
    }

    const namedExports = new Set<string>([
      ...(packagePolicy.namedExports ?? []),
    ]);
    for (const binding of declaration.bindings) {
      if (binding.kind === "default" && !packagePolicy.defaultImport) {
        throw new AppletSourcePolicyError(
          "APPLET_IMPORT_DEFAULT_DISALLOWED",
          `Applet default imports from ${declaration.specifier} are not approved for generated apps.`,
        );
      }
      if (binding.kind === "namespace" && !packagePolicy.namespaceImport) {
        throw new AppletSourcePolicyError(
          "APPLET_IMPORT_NAMESPACE_DISALLOWED",
          `Applet namespace imports from ${declaration.specifier} bypass the generated-app allowlist.`,
        );
      }
      if (binding.kind === "named" && !namedExports.has(binding.imported)) {
        throw new AppletSourcePolicyError(
          "APPLET_IMPORT_EXPORT_DISALLOWED",
          `${binding.imported} is not an approved generated-app export from ${declaration.specifier}.`,
        );
      }
    }
  }
}

export function validateGeneratedAppStructure(
  source: string,
  imports = parseImportDeclarations(source),
) {
  rejectRawPrimitiveElements(source);
  rejectMapBypass(source);
  rejectAdHocCard(source);
  rejectInlineStyleAndArbitraryTailwind(source);
  validateRechartsUsage(source, imports);
}

export function parseImportDeclarations(source: string): ImportDeclaration[] {
  const declarations: ImportDeclaration[] = [];
  const importPattern =
    /\bimport\s+(?:type\s+)?(?:(?<clause>[\s\S]*?)\s+from\s+)?["'](?<specifier>[^"']+)["'];?/g;
  let match: RegExpExecArray | null;

  while ((match = importPattern.exec(source))) {
    const specifier = match.groups?.specifier;
    if (!specifier) continue;
    declarations.push({
      specifier,
      bindings: parseImportBindings(match.groups?.clause?.trim() ?? ""),
    });
  }

  return declarations;
}

function parseImportBindings(clause: string): ImportBinding[] {
  if (!clause) return [];
  if (clause.startsWith("* as ")) {
    return [{ kind: "namespace", local: clause.slice(5).trim() }];
  }

  const bindings: ImportBinding[] = [];
  const namedStart = clause.indexOf("{");
  const namedEnd = clause.lastIndexOf("}");
  if (namedStart > 0) {
    const defaultLocal = clause.slice(0, namedStart).replace(/,$/, "").trim();
    if (defaultLocal) bindings.push({ kind: "default", local: defaultLocal });
  } else if (namedStart < 0) {
    bindings.push({ kind: "default", local: clause.trim() });
    return bindings;
  }

  if (namedStart >= 0 && namedEnd > namedStart) {
    const namedClause = clause.slice(namedStart + 1, namedEnd);
    for (const rawPart of namedClause.split(",")) {
      const part = rawPart.trim();
      if (!part) continue;
      const [imported, local = imported] = part.split(/\s+as\s+/);
      bindings.push({
        kind: "named",
        imported: imported.trim(),
        local: local.trim(),
      });
    }
  }

  return bindings;
}

function rejectRawPrimitiveElements(source: string) {
  for (const tagName of RAW_ELEMENT_NAMES) {
    if (new RegExp(`<\\s*${tagName}\\b`).test(source)) {
      throw new AppletSourcePolicyError(
        "APPLET_RAW_PRIMITIVE_FORBIDDEN",
        `Generated applets must use ${RAW_ELEMENT_REPLACEMENTS[tagName as keyof typeof RAW_ELEMENT_REPLACEMENTS]} instead of raw <${tagName}> markup.`,
      );
    }
  }
}

function rejectMapBypass(source: string) {
  if (/<\s*iframe\b/i.test(source)) {
    throw new AppletSourcePolicyError(
      "APPLET_RAW_IFRAME_FORBIDDEN",
      "Generated applets must use the approved host map component instead of raw iframe embeds.",
    );
  }
}

function rejectAdHocCard(source: string) {
  if (
    /<\s*(?:div|section|article)\b[^>]*className\s*=\s*["'][^"']*\brounded[^"']*\bborder[^"']*(?:\bshadow|\bbg-)/i.test(
      source,
    )
  ) {
    throw new AppletSourcePolicyError(
      "APPLET_AD_HOC_CARD_FORBIDDEN",
      "Generated applets must use Card instead of hand-rolled rounded/bordered card containers.",
    );
  }
  if (CARD_CLASS_PATTERN.test(source)) {
    throw new AppletSourcePolicyError(
      "APPLET_AD_HOC_VISUAL_SYSTEM_FORBIDDEN",
      "Generated applets must use approved shadcn primitives and semantic tokens instead of bespoke visual styling.",
    );
  }
}

function rejectInlineStyleAndArbitraryTailwind(source: string) {
  if (/\bstyle\s*=/.test(source)) {
    throw new AppletSourcePolicyError(
      "APPLET_INLINE_STYLE_FORBIDDEN",
      "Generated applets must not use inline style attributes.",
    );
  }
  if (/\bclassName\s*=\s*["'][^"']*\[[^\]]+\]/.test(source)) {
    throw new AppletSourcePolicyError(
      "APPLET_ARBITRARY_TAILWIND_FORBIDDEN",
      "Generated applets must use approved token classes instead of arbitrary Tailwind values.",
    );
  }
  if (/#[0-9a-f]{3,8}\b/i.test(source)) {
    throw new AppletSourcePolicyError(
      "APPLET_HEX_COLOR_FORBIDDEN",
      "Generated applets must use semantic theme tokens instead of hard-coded hex colors.",
    );
  }
}

function validateRechartsUsage(source: string, imports: ImportDeclaration[]) {
  const rechartsImports = new Set(
    imports
      .filter((declaration) => declaration.specifier === "recharts")
      .flatMap((declaration) =>
        declaration.bindings
          .filter(
            (binding): binding is Extract<ImportBinding, { kind: "named" }> =>
              binding.kind === "named",
          )
          .map((binding) => binding.local),
      ),
  );
  if (rechartsImports.size === 0) return;

  if (!/<\s*ChartContainer\b/.test(source)) {
    throw new AppletSourcePolicyError(
      "APPLET_RECHARTS_CHART_CONTAINER_REQUIRED",
      "Recharts primitives must be rendered inside the approved ChartContainer component.",
    );
  }

  for (const name of rechartsImports) {
    if (!isJsxTagInsideChartContainer(source, name)) {
      throw new AppletSourcePolicyError(
        "APPLET_RECHARTS_OUTSIDE_CHART_CONTAINER",
        `${name} must be nested inside ChartContainer in generated applets.`,
      );
    }
  }
}

function isJsxTagInsideChartContainer(source: string, targetName: string) {
  const stack: string[] = [];
  const tagPattern = /<\s*(\/)?\s*([A-Z][A-Za-z0-9.]*)\b[^>]*(\/)?>/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(source))) {
    const closing = Boolean(match[1]);
    const name = match[2].split(".").at(-1) ?? match[2];
    const selfClosing = Boolean(match[3]) || /\/\s*>$/.test(match[0]);

    if (closing) {
      const index = stack.lastIndexOf(name);
      if (index >= 0) stack.splice(index);
      continue;
    }

    const insideChartContainer = stack.includes("ChartContainer");
    if (name === targetName && insideChartContainer) return true;
    if (!selfClosing) stack.push(name);
  }

  return false;
}
