export type EnvironmentSetupErrorKind =
  | "invalid-url"
  | "unreachable"
  | "no-config-published"
  | "malformed";

export interface EnvironmentSetupErrorDetails {
  kind: EnvironmentSetupErrorKind;
  message: string;
}

export class EnvironmentSetupError extends Error {
  readonly kind: EnvironmentSetupErrorKind;

  constructor(kind: EnvironmentSetupErrorKind, message: string) {
    super(message);
    this.name = "EnvironmentSetupError";
    this.kind = kind;
  }
}

export function normalizeEnvironmentHost(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new EnvironmentSetupError(
      "invalid-url",
      "Enter a ThinkWork environment host.",
    );
  }

  let url: URL;
  try {
    url = new URL(hasScheme(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new EnvironmentSetupError(
      "invalid-url",
      "Enter a valid ThinkWork environment URL.",
    );
  }

  const hostname = url.hostname.toLowerCase();
  if (!isValidEnvironmentHostname(hostname)) {
    throw new EnvironmentSetupError(
      "invalid-url",
      "Enter a valid ThinkWork environment hostname.",
    );
  }

  const port = url.port ? `:${url.port}` : "";
  return `https://${hostname}${port}`;
}

export function environmentSetupError(
  kind: EnvironmentSetupErrorKind,
  message: string,
): EnvironmentSetupErrorDetails {
  return { kind, message };
}

function hasScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function isValidEnvironmentHostname(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname === "localhost") return true;
  return hostname.includes(".") && !/\s/.test(hostname);
}
