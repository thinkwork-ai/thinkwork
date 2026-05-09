import { parse } from "acorn";
import { simple as walk } from "acorn-walk";

const REGISTRY_NAME = "globalThis.__THINKWORK_APPLET_HOST__";

export const ALLOWED_APPLET_IMPORTS = new Set([
  "@thinkwork/ui",
  "@thinkwork/computer-stdlib",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "useAppletAPI",
]);

interface RewriteFailure {
  kind: "DisallowedImport" | "ParseError";
  message: string;
  specifier?: string;
  line?: number;
  column?: number;
}

export class AppletImportRewriteError extends Error {
  readonly failure: RewriteFailure;

  constructor(failure: RewriteFailure) {
    super(failure.message);
    this.name = "AppletImportRewriteError";
    this.failure = failure;
  }
}

interface ImportDeclarationNode {
  type: "ImportDeclaration";
  start: number;
  end: number;
  loc?: { start: { line: number; column: number } };
  source: { value: string };
  specifiers: ImportSpecifierNode[];
}

type ImportSpecifierNode =
  | {
      type: "ImportDefaultSpecifier";
      local: { name: string };
    }
  | {
      type: "ImportNamespaceSpecifier";
      local: { name: string };
    }
  | {
      type: "ImportSpecifier";
      local: { name: string };
      imported: { name?: string; value?: string };
    };

interface ImportExpressionNode {
  type: "ImportExpression";
  loc?: { start: { line: number; column: number } };
  source?: { type: string; value?: string };
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

export function rewriteAppletImports(source: string): string {
  const ast = parseModule(source);
  const replacements: Replacement[] = [];

  walk(ast, {
    ImportDeclaration(node) {
      const declaration = node as unknown as ImportDeclarationNode;
      const specifier = declaration.source.value;
      assertAllowedImport(specifier, declaration.loc?.start);
      replacements.push({
        start: declaration.start,
        end: declaration.end,
        text: rewriteImportDeclaration(declaration),
      });
    },
    ImportExpression(node) {
      const expression = node as unknown as ImportExpressionNode;
      const specifier =
        expression.source?.type === "Literal"
          ? String(expression.source.value)
          : "dynamic import";
      throw disallowedImport(specifier, expression.loc?.start);
    },
  });

  return applyReplacements(source, replacements);
}

function parseModule(source: string) {
  try {
    return parse(source, {
      ecmaVersion: "latest",
      locations: true,
      sourceType: "module",
    });
  } catch (error) {
    const maybeLocation = error as { loc?: { line: number; column: number } };
    const line = maybeLocation.loc?.line;
    const column = maybeLocation.loc?.column;
    throw new AppletImportRewriteError({
      kind: "ParseError",
      message: `Unable to parse transformed applet module at ${line ?? "?"}:${
        column ?? "?"
      }`,
      line,
      column,
    });
  }
}

function assertAllowedImport(
  specifier: string,
  location?: { line: number; column: number },
) {
  if (!ALLOWED_APPLET_IMPORTS.has(specifier)) {
    throw disallowedImport(specifier, location);
  }
}

function disallowedImport(
  specifier: string,
  location?: { line: number; column: number },
) {
  return new AppletImportRewriteError({
    kind: "DisallowedImport",
    message: `Applet imports may only reference ${[
      ...ALLOWED_APPLET_IMPORTS,
    ].join(", ")}; found ${specifier} at ${location?.line ?? "?"}:${
      location?.column ?? "?"
    }`,
    specifier,
    line: location?.line,
    column: location?.column,
  });
}

function rewriteImportDeclaration(node: ImportDeclarationNode) {
  const specifier = node.source.value;
  if (node.specifiers.length === 0) {
    return `void ${registryLookup(specifier)};`;
  }

  return node.specifiers
    .map((importSpecifier) => rewriteImportSpecifier(specifier, importSpecifier))
    .join("\n");
}

function rewriteImportSpecifier(
  moduleSpecifier: string,
  importSpecifier: ImportSpecifierNode,
) {
  const registry = registryLookup(moduleSpecifier);
  if (
    moduleSpecifier === "useAppletAPI" &&
    importSpecifier.type === "ImportSpecifier"
  ) {
    return `const ${importSpecifier.local.name} = ${REGISTRY_NAME}.useAppletAPI;`;
  }
  if (importSpecifier.type === "ImportNamespaceSpecifier") {
    return `const ${importSpecifier.local.name} = ${registry};`;
  }
  if (importSpecifier.type === "ImportDefaultSpecifier") {
    return `const ${importSpecifier.local.name} = ${registry}.default;`;
  }

  const imported =
    importSpecifier.imported.name ?? String(importSpecifier.imported.value);
  return `const ${importSpecifier.local.name} = ${registry}.${imported};`;
}

function registryLookup(moduleSpecifier: string) {
  return `${REGISTRY_NAME}[${JSON.stringify(moduleSpecifier)}]`;
}

function applyReplacements(source: string, replacements: Replacement[]) {
  let rewritten = source;
  for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
    rewritten =
      rewritten.slice(0, replacement.start) +
      replacement.text +
      rewritten.slice(replacement.end);
  }
  return rewritten;
}
