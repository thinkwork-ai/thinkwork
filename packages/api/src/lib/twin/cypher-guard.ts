/**
 * Tenant-fencing guard for agent-authored openCypher (THINK-333).
 *
 * The twin MCP server accepts raw openCypher from models. This module is the
 * only thing standing between that text and Neptune, so it is fail-closed at
 * every layer:
 *
 *  - real ANTLR parse (Neo4j's generated Cypher parser) — parse failure is a
 *    rejection, never a pass-through;
 *  - allowlist-by-construct: every parse-tree context type must be explicitly
 *    known-benign; anything unmodeled is `unsupported_construct`;
 *  - tenant fence injected into every node pattern wherever it appears
 *    (MATCH, EXISTS/COUNT subqueries, pattern comprehensions, pattern
 *    predicates, UNION arms). Interior nodes of variable-length paths cannot
 *    carry a pattern predicate; that is accepted because a Neptune cluster
 *    holds exactly one tenant's graph (see the THINK-333 plan) — the fence is
 *    defense-in-depth, not the sole boundary;
 *  - work clamps: bounded variable-length hops, LIMIT injection + cap.
 *
 * The guard never interpolates caller strings into query text: rewrites only
 * insert server-authored constants and `$tenantId`-style parameter references.
 */
import { CharStream, CommonTokenStream, type ParserRuleContext } from "antlr4";
import * as cypher from "@neo4j-cypher/language-support";

export type GuardRule =
  | "invalid_request"
  | "parse_error"
  | "multi_statement"
  | "mutation_clause"
  | "procedure_call"
  | "unsupported_construct"
  | "reserved_parameter"
  | "unbounded_var_length"
  | "limit_exceeded";

export interface AclPredicate {
  /** Node property the predicate constrains (e.g. "aclGroup"). */
  property: string;
  /** Parameter name the value is bound to. Reserved from caller use. */
  parameter: string;
  value: unknown;
}

export interface GuardOptions {
  tenantId: string;
  /** Caller-supplied query parameters, passed through after validation. */
  parameters?: Record<string, unknown>;
  /** THINK-330 seam: extra per-node predicates. Empty in v1. */
  aclPredicates?: AclPredicate[];
}

export type GuardResult =
  | {
      ok: true;
      query: string;
      parameters: Record<string, unknown>;
      /** True when the row cap rewrote a caller LIMIT down. */
      limited: boolean;
    }
  | { ok: false; rule: GuardRule; message: string };

export const TWIN_CYPHER_DEFAULT_LIMIT = 100;
export const TWIN_CYPHER_MAX_LIMIT = 500;
export const TWIN_CYPHER_MAX_VAR_LENGTH_HOPS = 5;

/** Splice on the original text. `start === end` is a pure insertion. */
interface Edit {
  start: number;
  end: number;
  text: string;
}

interface Violation {
  rule: GuardRule;
  message: string;
}

/**
 * Constructs that carry a precise rule so the model can self-correct.
 * Checked before the allowlist.
 */
const MUTATION_CONTEXTS = [
  "CreateClauseContext",
  "MergeClauseContext",
  "MergeActionContext",
  "SetClauseContext",
  "DeleteClauseContext",
  "RemoveClauseContext",
  "InsertClauseContext",
  "ForeachClauseContext",
] as const;

const PROCEDURE_CONTEXTS = ["CallClauseContext", "SubqueryClauseContext"] as const;

/**
 * Every context type the guard understands as benign read-query structure.
 * The grammar defines hundreds of contexts (admin commands, schema DDL,
 * privilege management…); anything outside this set fails closed as
 * `unsupported_construct`. Grown deliberately, with corpus coverage, never
 * by reflex when a query happens to fail.
 */
const ALLOWED_CONTEXTS = new Set<string>([
  // Statement scaffolding
  "StatementsOrCommandsContext",
  "StatementOrCommandContext",
  "StatementsContext",
  "StatementContext",
  "PreparsedStatementContext",
  "QueryWithLocalDefinitionsContext",
  "NextStatementContext",
  "RegularQueryContext",
  "UnionContext",
  "SingleQueryContext",
  "ClauseContext",
  // Read clauses
  "MatchClauseContext",
  "MatchModeContext",
  "WhereClauseContext",
  "WithClauseContext",
  "UnwindClauseContext",
  "ReturnClauseContext",
  "ReturnBodyContext",
  "ReturnItemsContext",
  "ReturnItemContext",
  "OrderByContext",
  "OrderItemContext",
  "AscTokenContext",
  "DescTokenContext",
  "SkipContext",
  "LimitContext",
  // Patterns
  "PatternListContext",
  "PatternContext",
  "AnonymousPatternContext",
  "PatternElementContext",
  "PathPatternNonEmptyContext",
  "NodePatternContext",
  "RelationshipPatternContext",
  "ParenthesizedPathContext",
  "ArrowLineContext",
  "LeftArrowContext",
  "RightArrowContext",
  "PathLengthContext",
  "PropertiesContext",
  "ShortestPathPatternContext",
  "ShortestPathExpressionContext",
  // Labels
  "LabelExpressionContext",
  "LabelExpression1Context",
  "LabelExpression2Context",
  "LabelExpression3Context",
  "LabelExpression4Context",
  "LabelNameContext",
  "LabelOrRelTypeContext",
  "LabelTypeContext",
  "LabelComparisonContext",
  "NodeLabelsContext",
  "NodeLabelsIsContext",
  "AnyLabelContext",
  "RelTypeContext",
  // Expressions
  "ExpressionContext",
  "Expression1Context",
  "Expression2Context",
  "Expression3Context",
  "Expression4Context",
  "Expression5Context",
  "Expression6Context",
  "Expression7Context",
  "Expression8Context",
  "Expression9Context",
  "Expression10Context",
  "Expression11Context",
  "ComparisonExpression6Context",
  "NullComparisonContext",
  "StringAndListComparisonContext",
  "TypeComparisonContext",
  "NormalFormComparisonContext",
  "ParenthesizedExpressionContext",
  "PostFixContext",
  "PropertyPostfixContext",
  "IndexPostfixContext",
  "RangePostfixContext",
  "PropertyContext",
  "PropertyKeyNameContext",
  "PropertyListContext",
  "CaseExpressionContext",
  "CaseAlternativeContext",
  "ExtendedCaseExpressionContext",
  "ExtendedCaseAlternativeContext",
  "ExtendedWhenContext",
  "WhenContext",
  "WhenBranchContext",
  "ElseBranchContext",
  "ListComprehensionContext",
  "ListItemsPredicateContext",
  "ListLiteralContext",
  "PatternComprehensionContext",
  "PatternExpressionContext",
  "ExistsExpressionContext",
  "CountExpressionContext",
  "CollectExpressionContext",
  "CountStarContext",
  "ReduceExpressionContext",
  "AllReduceExpressionContext",
  "AllReduceExpressionValidArgumentsContext",
  "FunctionInvocationContext",
  "FunctionNameContext",
  "FunctionArgumentContext",
  "NamespaceContext",
  "TrimFunctionContext",
  "NormalizeFunctionContext",
  "MapContext",
  "MapProjectionContext",
  "MapProjectionElementContext",
  // Literals / names / parameters
  "LiteralContext",
  "NumberLiteralContext",
  "NumericLiteralContext",
  "SignedIntegerLiteralContext",
  "StringLiteralContext",
  "StringsLiteralContext",
  "BooleanLiteralContext",
  "KeywordLiteralContext",
  "OtherLiteralContext",
  "ParameterContext",
  "ParameterNameContext",
  "VariableContext",
  "SymbolicNameStringContext",
  "SymbolicVariableNameStringContext",
  "EscapedSymbolicNameStringContext",
  "EscapedSymbolicVariableNameStringContext",
  "UnescapedSymbolicNameStringContext",
  "UnescapedSymbolicNameString_Context",
  "UnescapedSymbolicVariableNameStringContext",
]);

const RULE_PRIORITY: GuardRule[] = [
  "invalid_request",
  "parse_error",
  "multi_statement",
  "mutation_clause",
  "procedure_call",
  "unsupported_construct",
  "reserved_parameter",
  "unbounded_var_length",
  "limit_exceeded",
];

type Ctx = ParserRuleContext & {
  children?: Ctx[] | null;
  start?: { start: number; stop: number; text?: string };
  stop?: { start: number; stop: number; text?: string };
  symbol?: { start: number; stop: number; text?: string };
  getText(): string;
};

function ctxName(node: Ctx): string {
  return node.constructor.name;
}

function isContext(node: Ctx): boolean {
  // ParserRuleContexts have a children array (possibly empty); terminal
  // nodes do not.
  return (node as { children?: unknown }).children !== undefined;
}

function constructLabel(name: string): string {
  return name.replace(/Context$/, "");
}

function normalizeKey(text: string): string {
  return text.replace(/^`|`$/g, "");
}

export function guardTwinCypher(
  rawQuery: string,
  options: GuardOptions,
): GuardResult {
  if (!options?.tenantId) {
    return {
      ok: false,
      rule: "invalid_request",
      message: "tenantId is required",
    };
  }
  const query = rawQuery ?? "";
  if (query.trim().length === 0) {
    return { ok: false, rule: "parse_error", message: "empty query" };
  }

  const aclPredicates = options.aclPredicates ?? [];
  const reservedParams = new Set<string>([
    "tenantId",
    ...aclPredicates.map((p) => p.parameter),
  ]);

  for (const key of Object.keys(options.parameters ?? {})) {
    if (reservedParams.has(key)) {
      return {
        ok: false,
        rule: "reserved_parameter",
        message: `parameter name "${key}" is reserved by the platform`,
      };
    }
  }

  // --- Parse ------------------------------------------------------------
  const parseErrors: string[] = [];
  const errorListener = {
    syntaxError: (
      _rec: unknown,
      _sym: unknown,
      line: number,
      column: number,
      message: string,
    ) => {
      parseErrors.push(`${line}:${column} ${message}`);
    },
    reportAmbiguity: () => {},
    reportAttemptingFullContext: () => {},
    reportContextSensitivity: () => {},
  };
  let tree: Ctx;
  try {
    const lexer = new cypher.CypherLexer(new CharStream(query));
    const tokens = new CommonTokenStream(lexer);
    const parser = new cypher.CypherParser(tokens);
    lexer.removeErrorListeners();
    parser.removeErrorListeners();
    // The antlr4 JS typings for addErrorListener are narrower than what the
    // runtime accepts; the listener shape above is the documented one.
    (lexer as unknown as { addErrorListener(l: unknown): void }).addErrorListener(
      errorListener,
    );
    (parser as unknown as { addErrorListener(l: unknown): void }).addErrorListener(
      errorListener,
    );
    tree = parser.statementsOrCommands() as unknown as Ctx;
  } catch (error) {
    return {
      ok: false,
      rule: "parse_error",
      message: `query failed to parse: ${String(error)}`,
    };
  }
  if (parseErrors.length > 0) {
    return {
      ok: false,
      rule: "parse_error",
      message: `query failed to parse: ${parseErrors[0]}`,
    };
  }

  // --- Walk: validate constructs, collect rewrite targets ---------------
  const violations: Violation[] = [];
  const nodePatterns: Ctx[] = [];
  const statementNodes: Ctx[] = [];
  const topLevelArms: Ctx[] = [];
  const subqueryBoundary = new Set([
    "ExistsExpressionContext",
    "CountExpressionContext",
    "CollectExpressionContext",
    "PatternComprehensionContext",
  ]);

  const walk = (node: Ctx, insideSubquery: boolean) => {
    if (!isContext(node)) return;
    const name = ctxName(node);

    if ((MUTATION_CONTEXTS as readonly string[]).includes(name)) {
      violations.push({
        rule: "mutation_clause",
        message: `${constructLabel(name).replace(/Clause$|Action$/, "").toUpperCase()} is not allowed: the twin is read-only`,
      });
      return; // no need to descend into a rejected construct
    }
    if ((PROCEDURE_CONTEXTS as readonly string[]).includes(name)) {
      violations.push({
        rule: "procedure_call",
        message:
          name === "CallClauseContext"
            ? "procedure calls are not allowed"
            : "CALL { } subqueries are not allowed",
      });
      return;
    }
    if (!ALLOWED_CONTEXTS.has(name)) {
      violations.push({
        rule: "unsupported_construct",
        message: `unsupported construct: ${constructLabel(name)}`,
      });
      return;
    }

    if (name === "StatementContext") statementNodes.push(node);
    if (name === "SingleQueryContext" && !insideSubquery) {
      topLevelArms.push(node);
    }
    if (name === "NodePatternContext") nodePatterns.push(node);

    if (name === "ParameterNameContext") {
      const paramName = normalizeKey(node.getText());
      if (reservedParams.has(paramName)) {
        violations.push({
          rule: "reserved_parameter",
          message: `parameter $${paramName} is reserved by the platform`,
        });
      }
    }

    if (name === "PathLengthContext") {
      const text = node.getText();
      const match = /^\*(\d+)?(\.\.(\d+)?)?$/.exec(text.replace(/\s+/g, ""));
      const lower = match?.[1];
      const hasRange = match?.[2] !== undefined;
      const upper = hasRange ? match?.[3] : lower;
      if (!match || upper === undefined) {
        violations.push({
          rule: "unbounded_var_length",
          message: `variable-length pattern "${text}" must declare an upper bound of at most ${TWIN_CYPHER_MAX_VAR_LENGTH_HOPS} hops`,
        });
      } else if (Number(upper) > TWIN_CYPHER_MAX_VAR_LENGTH_HOPS) {
        violations.push({
          rule: "unbounded_var_length",
          message: `variable-length upper bound ${upper} exceeds the ${TWIN_CYPHER_MAX_VAR_LENGTH_HOPS}-hop cap`,
        });
      }
    }

    const childInsideSubquery = insideSubquery || subqueryBoundary.has(name);
    for (const child of node.children ?? []) {
      walk(child as Ctx, childInsideSubquery);
    }
  };
  walk(tree, false);

  if (statementNodes.length > 1) {
    violations.unshift({
      rule: "multi_statement",
      message: "only a single statement is allowed per query",
    });
  }

  // --- Rewrites ----------------------------------------------------------
  const edits: Edit[] = [];
  let limited = false;
  const fenceEntries: Array<{ property: string; parameter: string }> = [
    { property: "tenantId", parameter: "tenantId" },
    ...aclPredicates.map((p) => ({ property: p.property, parameter: p.parameter })),
  ];

  if (violations.length === 0) {
    for (const nodePattern of nodePatterns) {
      const edit = fenceNodePattern(nodePattern, fenceEntries, violations);
      if (edit) edits.push(...edit);
    }
    for (const arm of topLevelArms) {
      const result = clampArm(arm, violations);
      if (result) {
        edits.push(...result.edits);
        limited = limited || result.limited;
      }
    }
  }

  if (violations.length > 0) {
    violations.sort(
      (a, b) => RULE_PRIORITY.indexOf(a.rule) - RULE_PRIORITY.indexOf(b.rule),
    );
    const first = violations[0];
    return { ok: false, rule: first.rule, message: first.message };
  }

  // Apply edits back-to-front so earlier offsets stay valid.
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let guarded = query;
  for (const edit of edits) {
    guarded = guarded.slice(0, edit.start) + edit.text + guarded.slice(edit.end);
  }

  const parameters: Record<string, unknown> = {
    ...(options.parameters ?? {}),
    tenantId: options.tenantId,
  };
  for (const predicate of aclPredicates) {
    parameters[predicate.parameter] = predicate.value;
  }

  return { ok: true, query: guarded, parameters, limited };
}

/**
 * Injects the fence entries into one node pattern: merged into an existing
 * property map (replacing any caller-supplied value for a fence key), or
 * inserted as a fresh map before the pattern's inner WHERE / closing paren.
 */
function fenceNodePattern(
  nodePattern: Ctx,
  fenceEntries: Array<{ property: string; parameter: string }>,
  violations: Violation[],
): Edit[] | null {
  const children = (nodePattern.children ?? []) as Ctx[];
  const propertiesCtx = children.find(
    (c) => ctxName(c) === "PropertiesContext",
  );

  if (propertiesCtx) {
    const inner = ((propertiesCtx.children ?? []) as Ctx[])[0];
    if (!inner || ctxName(inner) !== "MapContext") {
      violations.push({
        rule: "unsupported_construct",
        message:
          "parameter property maps in node patterns are not supported — use an inline map or WHERE clause",
      });
      return null;
    }
    return fenceExistingMap(inner, fenceEntries);
  }

  // No property map: insert one before the inner WHERE (if present) or the
  // closing paren.
  const fenceMap = ` {${fenceEntries
    .map((f) => `${f.property}: $${f.parameter}`)
    .join(", ")}}`;
  const whereTerminal = children.find(
    (c) => !isContext(c) && c.symbol?.text?.toUpperCase() === "WHERE",
  );
  const insertAt = whereTerminal
    ? (whereTerminal.symbol?.start as number)
    : (nodePattern.stop?.start as number); // the ')' token
  return [
    {
      start: insertAt,
      end: insertAt,
      text: whereTerminal ? `${fenceMap.trimStart()} ` : fenceMap,
    },
  ];
}

/** Merge fence keys into an existing `{...}` map, overriding caller values. */
function fenceExistingMap(
  mapCtx: Ctx,
  fenceEntries: Array<{ property: string; parameter: string }>,
): Edit[] {
  const edits: Edit[] = [];
  const children = (mapCtx.children ?? []) as Ctx[];
  const missing: Array<{ property: string; parameter: string }> = [];

  for (const entry of fenceEntries) {
    let replaced = false;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (
        isContext(child) &&
        ctxName(child) === "PropertyKeyNameContext" &&
        normalizeKey(child.getText()) === entry.property
      ) {
        // Replace the value expression that follows this key.
        const value = children
          .slice(i + 1)
          .find((c) => isContext(c) && ctxName(c) === "ExpressionContext");
        if (value) {
          edits.push({
            start: value.start?.start as number,
            end: (value.stop?.stop as number) + 1,
            text: `$${entry.parameter}`,
          });
          replaced = true;
        }
        break;
      }
    }
    if (!replaced) missing.push(entry);
  }

  if (missing.length > 0) {
    const openBrace = children.find(
      (c) => !isContext(c) && c.symbol?.text === "{",
    );
    const insertAt = ((openBrace?.symbol?.stop as number) ?? mapCtx.start?.stop as number) + 1;
    const hasEntries = children.some(
      (c) => isContext(c) && ctxName(c) === "PropertyKeyNameContext",
    );
    const text =
      missing.map((f) => `${f.property}: $${f.parameter}`).join(", ") +
      (hasEntries ? ", " : "");
    edits.push({ start: insertAt, end: insertAt, text });
  }
  return edits;
}

/**
 * Enforces the row clamp on one top-level query arm: caps an existing final
 * LIMIT, or injects the default after the arm's last token.
 */
function clampArm(
  arm: Ctx,
  violations: Violation[],
): { edits: Edit[]; limited: boolean } | null {
  // The arm's final clause must be RETURN (Neptune read queries always are);
  // find the last ReturnClauseContext that is a direct clause of this arm.
  const clauses = ((arm.children ?? []) as Ctx[]).filter(
    (c) => isContext(c) && ctxName(c) === "ClauseContext",
  );
  const lastClause = clauses[clauses.length - 1];
  const returnClause = ((lastClause?.children ?? []) as Ctx[]).find(
    (c) => isContext(c) && ctxName(c) === "ReturnClauseContext",
  );
  if (!returnClause) {
    violations.push({
      rule: "unsupported_construct",
      message: "every query (and UNION arm) must end in RETURN",
    });
    return null;
  }

  // Locate the LIMIT belonging to this RETURN (not to an inner WITH).
  let limitCtx: Ctx | undefined;
  const findLimit = (node: Ctx) => {
    if (!isContext(node)) return;
    const name = ctxName(node);
    if (name === "LimitContext") limitCtx = node;
    // Don't descend into expressions — a RETURN item could contain an
    // EXISTS subquery with its own inner structure.
    if (name === "ExpressionContext") return;
    for (const child of node.children ?? []) findLimit(child as Ctx);
  };
  findLimit(returnClause);

  if (!limitCtx) {
    const insertAt = (arm.stop?.stop as number) + 1;
    return {
      edits: [
        { start: insertAt, end: insertAt, text: ` LIMIT ${TWIN_CYPHER_DEFAULT_LIMIT}` },
      ],
      limited: false,
    };
  }

  const valueCtx = ((limitCtx.children ?? []) as Ctx[]).find((c) =>
    isContext(c),
  );
  const valueText = valueCtx?.getText() ?? "";
  if (!/^\d+$/.test(valueText)) {
    violations.push({
      rule: "limit_exceeded",
      message: `LIMIT must be an integer literal of at most ${TWIN_CYPHER_MAX_LIMIT}`,
    });
    return null;
  }
  if (Number(valueText) > TWIN_CYPHER_MAX_LIMIT) {
    return {
      edits: [
        {
          start: valueCtx?.start?.start as number,
          end: (valueCtx?.stop?.stop as number) + 1,
          text: String(TWIN_CYPHER_MAX_LIMIT),
        },
      ],
      limited: true,
    };
  }
  return { edits: [], limited: false };
}
