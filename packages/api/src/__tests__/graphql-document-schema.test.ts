import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSchema,
  parse,
  validate,
  specifiedRules,
  type GraphQLSchema,
} from "graphql";

/**
 * Schema conformance for hand-written GraphQL documents.
 *
 * Codegen validates the typed `graphql()` operations in apps/web, apps/cli and
 * apps/mobile. It does not cover:
 *
 *   - `apps/web/src/lib/graphql-queries.ts`, which the web codegen config
 *     explicitly excludes (untyped `gql` tags, migrated incrementally);
 *   - `packages/agentcore-pi/.../providers/*`, `packages/pi-extensions` and
 *     `packages/react-native-sdk`, which have no codegen at all.
 *
 * Those gaps are not theoretical. The wiki-removal arc (plan 2026-07-24-002)
 * broke documents in both categories by deleting schema fields they selected:
 * the palette Search rail kept selecting `wikiHits` (caught by grep before it
 * shipped), and the Pi agent's search provider kept selecting the same field
 * (caught only two deploys later, after it was live). Both would have failed
 * here on the PR that removed the field.
 *
 * This walks every hand-written document, resolves fragment interpolation, and
 * validates it against the canonical schema. Unresolvable documents are
 * reported rather than silently skipped — see the `unresolved` case.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");
const SCHEMA_DIR = path.join(REPO_ROOT, "packages/database-pg/graphql");

const SEARCH_ROOTS = ["apps", "packages"];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  "gql", // codegen output — already schema-checked by codegen itself
  "__generated__",
]);

/** Documents that legitimately cannot be statically resolved. Keep empty. */
const KNOWN_UNRESOLVABLE: string[] = [];

/**
 * Pre-existing invalid documents, each with a reason. Adding to this list is a
 * deliberate act — it should shrink, never grow silently.
 *
 * `ComputerThreadChunk` is a placeholder for an unimplemented feature: it
 * selects only `__typename` (which the spec forbids as a subscription's entire
 * top-level selection), and its consumer in `use-chat-appsync-transport.ts`
 * reads `data.onComputerThreadChunk` — a field no schema defines. The consumer
 * guards with `if (!chunkEvent) return`, so the transport yields no chunks
 * rather than throwing. Left as found: implementing or deleting that transport
 * is a product decision, not a schema-conformance fix.
 */
const KNOWN_INVALID = new Set<string>([
  "apps/web/src/lib/graphql-queries.ts :: ComputerThreadChunkSubscription",
]);

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// AppSync injects these server-side; the canonical SDL uses them without
// declaring them, which graphql-js rejects when building a schema. Codegen
// tolerates unknown directives, so this is the one place they need declaring.
const APPSYNC_DIRECTIVES = `
  directive @aws_subscribe(mutations: [String!]!) on FIELD_DEFINITION
  directive @aws_iam on FIELD_DEFINITION | OBJECT
  directive @aws_lambda on FIELD_DEFINITION | OBJECT
`;

function loadSchema(): GraphQLSchema {
  const parts: string[] = [APPSYNC_DIRECTIVES];
  const base = path.join(SCHEMA_DIR, "schema.graphql");
  if (statSync(base, { throwIfNoEntry: false })) {
    parts.push(readFileSync(base, "utf8"));
  }
  const typesDir = path.join(SCHEMA_DIR, "types");
  for (const name of readdirSync(typesDir).sort()) {
    if (name.endsWith(".graphql")) {
      parts.push(readFileSync(path.join(typesDir, name), "utf8"));
    }
  }
  return buildSchema(parts.join("\n"));
}

interface FoundDocument {
  file: string;
  body: string;
  /** Best-effort name for error messages: the const it was assigned to. */
  label: string;
}

// `const Name = gql`…`` / `= /* GraphQL */ `…`` / `graphql(`…`)`
const DOC_RE =
  /(?:(?:const|let|var)\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*)?(?:gql|graphql\(|\/\* GraphQL \*\/)\s*`([\s\S]*?)`/g;
// `const NAME = `…`` — field-set constants spliced in via interpolation. The
// tag is optional and varies: bare, `gql`, or the `/* GraphQL */` comment the
// agentcore-pi providers use (missing that form left their documents
// unresolved, which is exactly where the schema drift kept landing).
const CONST_RE =
  /(?:const|let|var)\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*(?:gql\s*|\/\* GraphQL \*\/\s*)?`([\s\S]*?)`/g;

// A real document *starts* with an operation keyword. Matching the keyword
// anywhere also matches prose — `gql` inside a code comment ("untyped urql
// `gql` tags") produced two bogus parse failures before this was tightened.
const OPERATION_RE = /^\s*(query|mutation|subscription|fragment)\s/;

function collect(files: string[]) {
  const documents: FoundDocument[] = [];
  const constants = new Map<string, string>();

  for (const file of files) {
    const src = readFileSync(file, "utf8");

    for (const match of src.matchAll(CONST_RE)) {
      const [, name, body] = match;
      if (name && body && !constants.has(name)) constants.set(name, body);
    }

    for (const match of src.matchAll(DOC_RE)) {
      const [, name, body] = match;
      if (!body || !OPERATION_RE.test(body)) continue;
      documents.push({
        file: path.relative(REPO_ROOT, file),
        body,
        label: name ?? "(anonymous)",
      });
    }
  }
  return { documents, constants };
}

/** Inline `${FragmentConst}` references, bounded so a cycle can't hang. */
function resolve(body: string, constants: Map<string, string>): string {
  let out = body;
  for (let depth = 0; depth < 6 && out.includes("${"); depth++) {
    out = out.replace(/\$\{\s*([A-Za-z0-9_]+)\s*\}/g, (whole, name: string) =>
      constants.has(name) ? (constants.get(name) as string) : whole,
    );
  }
  return out;
}

// Rules that fire on legitimately-partial hand-written documents. Everything
// else — unknown fields, wrong argument names, bad enum values, type
// mismatches — is exactly what this guard exists to catch.
const NOISY_RULES = new Set(["NoUnusedFragmentsRule", "NoUnusedVariablesRule"]);
const RULES = specifiedRules.filter((rule) => !NOISY_RULES.has(rule.name));

const schema = loadSchema();
const files = SEARCH_ROOTS.flatMap((root) => walk(path.join(REPO_ROOT, root)));
const { documents, constants } = collect(files);

/**
 * Fragments are shared across documents by name, not by interpolation — a
 * query spreads `...SettingsPiExtensionFields` while the definition lives in
 * its own `graphql()` call. Index every definition so a document can be
 * validated with the fragments it actually references.
 */
const fragmentSources = new Map<string, string>();
for (const { body } of documents) {
  const text = resolve(body, constants);
  for (const match of text.matchAll(
    /(fragment\s+([A-Za-z0-9_]+)\s+on\s+[A-Za-z0-9_]+\s*\{)/g,
  )) {
    const name = match[2];
    if (fragmentSources.has(name)) continue;
    // Take the definition through its balanced closing brace.
    let depth = 0;
    let end = match.index ?? 0;
    for (let i = match.index ?? 0; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    fragmentSources.set(name, text.slice(match.index ?? 0, end));
  }
}

/** Append definitions for every fragment the document spreads, transitively. */
function withFragments(text: string): string {
  const included = new Set<string>();
  for (const match of text.matchAll(/fragment\s+([A-Za-z0-9_]+)\s+on\s/g)) {
    included.add(match[1]);
  }
  let out = text;
  for (let depth = 0; depth < 6; depth++) {
    const missing = new Set<string>();
    for (const match of out.matchAll(/\.\.\.\s*([A-Za-z0-9_]+)/g)) {
      const name = match[1];
      if (!included.has(name) && fragmentSources.has(name)) missing.add(name);
    }
    if (missing.size === 0) break;
    for (const name of missing) {
      included.add(name);
      out += `\n\n${fragmentSources.get(name)}`;
    }
  }
  return out;
}

describe("hand-written GraphQL documents conform to the schema", () => {
  it("finds documents to check (guard against a broken matcher)", () => {
    // If the extraction regex silently stops matching, every other assertion
    // in this file passes vacuously. Pin a floor well under the current count.
    expect(documents.length).toBeGreaterThan(300);
  });

  it("resolves every fragment interpolation", () => {
    const unresolved = documents
      .filter(({ body }) => resolve(body, constants).includes("${"))
      .map(({ file, label }) => `${file} :: ${label}`);

    expect(unresolved).toEqual(KNOWN_UNRESOLVABLE);
  });

  it("validates every document against the canonical schema", () => {
    const failures: string[] = [];
    const allowedSeen = new Set<string>();

    for (const { file, body, label } of documents) {
      const id = `${file} :: ${label}`;
      if (KNOWN_INVALID.has(id)) {
        allowedSeen.add(id);
        continue;
      }
      const text = resolve(body, constants);
      if (text.includes("${")) continue; // reported by the case above

      let ast;
      try {
        ast = parse(withFragments(text));
      } catch (error) {
        failures.push(
          `${file} :: ${label} — parse error: ${(error as Error).message}`,
        );
        continue;
      }

      for (const error of validate(schema, ast, RULES)) {
        failures.push(`${file} :: ${label} — ${error.message}`);
      }
    }

    expect(failures).toEqual([]);

    // A stale allowlist entry means the document was fixed or renamed and the
    // exemption is now dead weight hiding nothing.
    expect([...allowedSeen].sort()).toEqual([...KNOWN_INVALID].sort());
  });
});
