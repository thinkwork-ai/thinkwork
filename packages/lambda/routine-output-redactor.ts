export const ROUTINE_REDACTED_VALUE = "<redacted>";

const AUTH_BEARER = /Authorization:\s*Bearer\s+([^\s"'<>]+)/gi;
const JWT = /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g;
const PREFIXED_TOKEN =
  /(?:gh[oprsu]_[A-Za-z0-9]{20,}|xox[abep]-[A-Za-z0-9-]{10,}|ya29\.[A-Za-z0-9_-]{20,})/g;

export interface RoutineOutputRedactor {
  readonly exactValues: readonly string[];
  redact(value: string | undefined | null): string;
}

export function createRoutineOutputRedactor(
  secretSources: readonly unknown[] = [],
): RoutineOutputRedactor {
  const exactValues = Array.from(
    new Set(secretSources.flatMap((source) => collectSecretLeafValues(source))),
  ).sort((a, b) => b.length - a.length);

  return {
    exactValues,
    redact(value: string | undefined | null): string {
      if (!value) return "";
      let out = value;
      for (const secret of exactValues) {
        out = out.split(secret).join(ROUTINE_REDACTED_VALUE);
      }
      return scrubKnownTokenShapes(out);
    },
  };
}

export function scrubKnownTokenShapes(message: string): string {
  let out = message;
  out = out.replace(
    AUTH_BEARER,
    `Authorization: Bearer ${ROUTINE_REDACTED_VALUE}`,
  );
  out = out.replace(JWT, ROUTINE_REDACTED_VALUE);
  out = out.replace(PREFIXED_TOKEN, ROUTINE_REDACTED_VALUE);
  return out;
}

export function collectSecretLeafValues(value: unknown): string[] {
  const values: string[] = [];
  collect(value, values, new Set<object>());
  return values;
}

function collect(value: unknown, values: string[], seen: Set<object>): void {
  if (value == null) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) values.push(trimmed);
    return;
  }
  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collect(item, values, seen);
    return;
  }

  for (const item of Object.values(value as Record<string, unknown>)) {
    collect(item, values, seen);
  }
}
