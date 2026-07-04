/**
 * Binding-argument redaction gate (Living Artifacts / THINK-145, KTD9).
 *
 * A binding's frozen args are stored UNREDACTED server-side (refresh always
 * re-invokes with the real values), but provenance display (R5) is shown to
 * every space member (R15 widened the audience), so args pass this gate before
 * they ever reach a client. Key-name matching alone is insufficient — a value
 * can be a secret or PII under an innocuous key — so values are inspected too.
 *
 * Redaction rules:
 *  - any value under a secret-shaped KEY (`token`, `key`, `secret`, `password`,
 *    `authorization`, case-insensitive, substring) → redacted
 *  - string values matching PII shapes: email addresses, SSN-like `ddd-dd-dddd`,
 *    or a 9+ digit run (long numeric account identifiers) → redacted
 *  - numeric values with 9+ digits (account-id shaped) → redacted
 *  - any string longer than the length cap (256) → redacted
 *  - short plain primitives (bool, short number/string) → passed verbatim
 *
 * Pure and structure-preserving: objects/arrays recurse, redacted leaves become
 * the placeholder string.
 */

export const BINDING_REDACTION_PLACEHOLDER = "[redacted]" as const;
export const BINDING_ARG_LENGTH_CAP = 256 as const;

const SECRET_KEY_RE = /token|key|secret|password|authorization/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
const LONG_DIGIT_RUN_RE = /\d{9,}/;

function stringLooksSensitive(value: string): boolean {
  if (value.length > BINDING_ARG_LENGTH_CAP) return true;
  return (
    EMAIL_RE.test(value) || SSN_RE.test(value) || LONG_DIGIT_RUN_RE.test(value)
  );
}

function numberLooksSensitive(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  // 9+ digit integer → account-id shaped.
  return Math.abs(Math.trunc(value)).toString().length >= 9;
}

function redactValue(value: unknown, keyIsSecret: boolean): unknown {
  if (keyIsSecret) return BINDING_REDACTION_PLACEHOLDER;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return stringLooksSensitive(value) ? BINDING_REDACTION_PLACEHOLDER : value;
  }
  if (typeof value === "number") {
    return numberLooksSensitive(value) ? BINDING_REDACTION_PLACEHOLDER : value;
  }
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, false));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = redactValue(nested, SECRET_KEY_RE.test(key));
    }
    return out;
  }
  // Unknown primitive kind (bigint, symbol, function): never render verbatim.
  return BINDING_REDACTION_PLACEHOLDER;
}

/**
 * Redact a binding's frozen argument object for provenance display. Returns a
 * structurally-identical value with sensitive leaves masked. Non-object inputs
 * are inspected as a single leaf.
 */
export function redactBindingArgs(args: unknown): unknown {
  return redactValue(args, false);
}
