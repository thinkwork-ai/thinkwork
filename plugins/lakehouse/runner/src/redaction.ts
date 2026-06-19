const SECRET_PATTERNS = [
  /(password|passwd|pwd)\s*=\s*[^,\s]+/gi,
  /(secret|token|api[_-]?key)\s*=\s*[^,\s]+/gi,
  /oracle:\/\/[^@\s]+@/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
] as const;

export function redactSensitiveText(input: string): string {
  return SECRET_PATTERNS.reduce(
    (text, pattern) =>
      text.replace(pattern, (match) => {
        const separator = match.includes("=") ? "=" : "";
        const key = separator ? match.split(separator)[0] : "secret";
        return `${key}${separator}[REDACTED]`;
      }),
    input,
  );
}

export function redactObject<T>(input: T): T {
  if (typeof input === "string") return redactSensitiveText(input) as T;
  if (!input || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map((item) => redactObject(item)) as T;
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => [
      key,
      /secret|token|password|credential/i.test(key)
        ? "[REDACTED]"
        : redactObject(value),
    ]),
  ) as T;
}
