import { createHash } from "node:crypto";

/**
 * RFC 8785 (JCS) JSON canonicalization.
 *
 * Only JSON-representable values are accepted; anything else (undefined,
 * functions, symbols, BigInt, non-finite numbers, class instances that are not
 * plain objects/arrays) throws rather than being silently coerced — a
 * fingerprint over coerced data would differ from the Python canonicalizer's.
 */
export type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

function assertCanonicalizable(value: unknown, path: string): void {
  if (value === null) return;
  switch (typeof value) {
    case "boolean":
    case "string":
      return;
    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(`non-finite number at ${path}`);
      }
      return;
    case "object":
      break;
    default:
      throw new CanonicalizationError(`unsupported ${typeof value} at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      if (item === undefined) {
        throw new CanonicalizationError(
          `undefined array element at ${path}[${i}]`,
        );
      }
      assertCanonicalizable(item, `${path}[${i}]`);
    });
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new CanonicalizationError(`non-plain object at ${path}`);
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    // undefined-valued keys are dropped by JSON.stringify; two objects that
    // differ only by an undefined key would collide, so reject instead.
    if (item === undefined) {
      throw new CanonicalizationError(`undefined value at ${path}.${key}`);
    }
    assertCanonicalizable(item, `${path}.${key}`);
  }
}

function serialize(value: CanonicalJson): string {
  if (value === null || typeof value !== "object") {
    // JSON.stringify already emits JCS-conformant scalars: ES2015 shortest
    // round-trip numbers and minimal two-char/`\u00xx` string escapes.
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(",")}]`;
  }
  // JCS orders members by UTF-16 code units — the default string sort.
  const keys = Object.keys(value).sort();
  const members = keys.map(
    (k) => `${JSON.stringify(k)}:${serialize(value[k]!)}`,
  );
  return `{${members.join(",")}}`;
}

/** Canonicalize a JSON value per RFC 8785 and return the canonical UTF-8 string. */
export function canonicalize(value: unknown): string {
  assertCanonicalizable(value, "$");
  return serialize(value as CanonicalJson);
}

/** SHA-256 of the RFC 8785 canonical form, as lowercase hex. */
export function canonicalSha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

/** `sha256:<hex>` form used in twcap references and fingerprint columns. */
export function canonicalSha256Ref(value: unknown): string {
  return `sha256:${canonicalSha256Hex(value)}`;
}
