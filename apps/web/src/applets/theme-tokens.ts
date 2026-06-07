const SAFE_TOKEN_NAME = /^--[a-z0-9-]+$/i;
const UNSAFE_TOKEN_VALUE =
  /[{};<>]|url\s*\(|expression\s*\(|@import|javascript:/i;

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

function isSafeTokenValue(value: string) {
  if (!value || value.length > 180) return false;
  return !UNSAFE_TOKEN_VALUE.test(value);
}
