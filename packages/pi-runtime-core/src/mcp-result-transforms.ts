/** Provider-neutral, declarative normalization for successful MCP results. */
export interface McpResultTransform {
  type: "scaled-integer-to-decimal";
  sourceField: string;
  targetField: string;
  scale: number;
  removeSource?: boolean;
}

function decimalFromScaledInteger(
  value: unknown,
  scale: number,
): string | null {
  if (
    (typeof value !== "number" &&
      typeof value !== "bigint" &&
      typeof value !== "string") ||
    (typeof value === "number" && !Number.isSafeInteger(value))
  ) {
    return null;
  }
  const raw = String(value).trim();
  if (!/^[+-]?\d+$/.test(raw)) return null;
  const negative = raw.startsWith("-");
  const digits = raw.replace(/^[+-]/, "").replace(/^0+(?=\d)/, "");
  if (scale === 0) return negative && digits !== "0" ? `-${digits}` : digits;

  const padded = digits.padStart(scale + 1, "0");
  const whole = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/, "");
  const decimal = fraction ? `${whole}.${fraction}` : whole;
  return negative && decimal !== "0" ? `-${decimal}` : decimal;
}

function applyResultTransform(
  value: unknown,
  transform: McpResultTransform,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => applyResultTransform(item, transform));
  }
  if (value === null || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const normalized = Object.fromEntries(
    Object.entries(record).map(([key, child]) => [
      key,
      applyResultTransform(child, transform),
    ]),
  );
  if (!Object.prototype.hasOwnProperty.call(record, transform.sourceField)) {
    return normalized;
  }
  const decimal = decimalFromScaledInteger(
    record[transform.sourceField],
    transform.scale,
  );
  if (decimal === null) return normalized;
  if (transform.removeSource) delete normalized[transform.sourceField];
  normalized[transform.targetField] = decimal;
  return normalized;
}

/**
 * Transform one JSON text content block. Non-JSON text and invalid numeric
 * fields are returned verbatim so provider errors and prose are never lost.
 */
export function transformMcpResultText(
  text: string,
  transforms: readonly McpResultTransform[] | undefined,
): string {
  if (!transforms?.length) return text;
  try {
    let payload: unknown = JSON.parse(text);
    for (const transform of transforms) {
      payload = applyResultTransform(payload, transform);
    }
    return JSON.stringify(payload);
  } catch {
    return text;
  }
}

/** Apply transforms independently to every MCP text content block. */
export function transformMcpResultContent(
  content: unknown,
  transforms: readonly McpResultTransform[] | undefined,
): unknown {
  if (!transforms?.length || !Array.isArray(content)) return content;
  return content.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return typeof record.text === "string"
      ? { ...record, text: transformMcpResultText(record.text, transforms) }
      : item;
  });
}
