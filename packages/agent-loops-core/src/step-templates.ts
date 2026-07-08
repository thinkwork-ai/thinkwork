/**
 * Dispatch-time resolution of workflow step input templates (THINK-215).
 *
 * The validator (workflow-definition.ts) guarantees placeholder roots and
 * step-reference ordering at authoring time; this module substitutes values
 * at dispatch time. Failures resolve to ThinkWork-level errors (the missing
 * expressions), never exceptions.
 *
 * Rules:
 *   - A string that is EXACTLY one placeholder ("{{ steps.x.output.y }}")
 *     resolves to the referenced value with its type preserved.
 *   - A string with embedded placeholders interpolates each as a string
 *     (objects/arrays JSON-stringified).
 *   - A missing path is an error; every missing expression is collected.
 */

const TEMPLATE_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;
const WHOLE_TEMPLATE_PATTERN = /^\{\{\s*([^{}]*?)\s*\}\}$/;

export interface StepTemplateContext {
  /** The trigger's caller payload — resolves `{{ trigger.payload.* }}`. */
  trigger: { payload: Record<string, unknown> };
  /** The run's recorded input — resolves `{{ run.input.* }}`. */
  run: { input: Record<string, unknown> };
  /** Prior step outputs by step id — resolves `{{ steps.<id>.output.* }}`. */
  steps: Record<string, { output: unknown }>;
}

export type TemplateResolution =
  { ok: true; value: unknown } | { ok: false; missing: string[] };

function lookupPath(context: StepTemplateContext, expression: string): unknown {
  const segments = expression.split(".");
  let node: unknown = context;
  for (const segment of segments) {
    if (node === null || node === undefined) return undefined;
    if (typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

function interpolate(raw: string, value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Resolve every placeholder in a JSON value against the context. Returns the
 * resolved value, or the list of expressions that resolved to undefined.
 */
export function resolveStepTemplates(
  value: unknown,
  context: StepTemplateContext,
): TemplateResolution {
  const missing: string[] = [];

  const visit = (node: unknown): unknown => {
    if (typeof node === "string") {
      const whole = node.match(WHOLE_TEMPLATE_PATTERN);
      if (whole) {
        const expression = whole[1].trim();
        const resolved = lookupPath(context, expression);
        if (resolved === undefined) {
          missing.push(expression);
          return node;
        }
        return resolved;
      }
      return node.replace(TEMPLATE_PATTERN, (raw, inner: string) => {
        const expression = inner.trim();
        const resolved = lookupPath(context, expression);
        if (resolved === undefined) {
          missing.push(expression);
          return raw;
        }
        return interpolate(raw, resolved);
      });
    }
    if (Array.isArray(node)) return node.map(visit);
    if (typeof node === "object" && node !== null) {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([key, entry]) => [
          key,
          visit(entry),
        ]),
      );
    }
    return node;
  };

  const resolved = visit(value);
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, value: resolved };
}
