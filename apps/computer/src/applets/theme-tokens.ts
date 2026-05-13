const SAFE_TOKEN_NAME = /^--[a-z0-9-]+$/i;
const UNSAFE_TOKEN_VALUE =
  /[{};<>]|url\s*\(|expression\s*\(|@import|javascript:/i;

export interface AppletTheme {
  source?: string;
  css: string;
}

export function parseShadcnThemeCss(
  css: string | null | undefined,
  theme: "light" | "dark",
): Record<string, string> {
  if (!css) return {};
  const root = extractVariablesForSelector(css, ":root");
  if (theme !== "dark") return root;
  return {
    ...root,
    ...extractVariablesForSelector(css, ".dark"),
  };
}

export function appletThemeCssFromMetadata(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;
  return appletThemeCssFromValue(metadata.appletTheme ?? metadata.shadcnTheme);
}

export function appletThemeCssFromValue(value: unknown): string | null {
  if (typeof value === "string") return cleanThemeCss(value);
  if (!isRecord(value)) return null;
  if (typeof value.css === "string") return cleanThemeCss(value.css);
  return null;
}

export function buildAppletTheme(css: string): AppletTheme | null {
  const cleaned = cleanThemeCss(css);
  if (!cleaned) return null;
  const tokenCount =
    Object.keys(parseShadcnThemeCss(cleaned, "light")).length +
    Object.keys(parseShadcnThemeCss(cleaned, "dark")).length;
  if (tokenCount === 0) return null;
  return {
    source: "shadcn-create",
    css: cleaned,
  };
}

function extractVariablesForSelector(
  css: string,
  selector: ":root" | ".dark",
): Record<string, string> {
  const variables: Record<string, string> = {};
  const escapedSelector = selector.replace(".", "\\.");
  const blockPattern = new RegExp(
    `${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`,
    "g",
  );
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockPattern.exec(css))) {
    const body = blockMatch[1] ?? "";
    const variablePattern = /(--[a-z0-9-]+)\s*:\s*([^;{}<>]+)\s*;?/gi;
    let variableMatch: RegExpExecArray | null;
    while ((variableMatch = variablePattern.exec(body))) {
      const name = variableMatch[1]?.trim();
      const value = variableMatch[2]?.trim();
      if (!name || !value) continue;
      if (!SAFE_TOKEN_NAME.test(name)) continue;
      if (!isSafeTokenValue(value)) continue;
      variables[name] = value;
    }
  }
  return variables;
}

function cleanThemeCss(css: string): string | null {
  const trimmed = css.trim();
  if (!trimmed || trimmed.length > 20_000) return null;
  if (!trimmed.includes(":root") && !trimmed.includes(".dark")) return null;
  return trimmed;
}

function isSafeTokenValue(value: string) {
  if (!value || value.length > 180) return false;
  return !UNSAFE_TOKEN_VALUE.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
