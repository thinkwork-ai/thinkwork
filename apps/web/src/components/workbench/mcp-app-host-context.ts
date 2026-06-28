import type { Theme } from "@thinkwork/ui";

export const MCP_APPS_PROTOCOL_VERSION = "2026-01-26";

export type McpUiTheme = "light" | "dark";

export type McpUiStyleVariableKey =
  | "--color-background-primary"
  | "--color-background-secondary"
  | "--color-background-tertiary"
  | "--color-background-inverse"
  | "--color-background-ghost"
  | "--color-background-info"
  | "--color-background-danger"
  | "--color-background-success"
  | "--color-background-warning"
  | "--color-background-disabled"
  | "--color-text-primary"
  | "--color-text-secondary"
  | "--color-text-tertiary"
  | "--color-text-inverse"
  | "--color-text-info"
  | "--color-text-danger"
  | "--color-text-success"
  | "--color-text-warning"
  | "--color-text-disabled"
  | "--color-text-ghost"
  | "--color-border-primary"
  | "--color-border-secondary"
  | "--color-border-tertiary"
  | "--color-border-inverse"
  | "--color-border-ghost"
  | "--color-border-info"
  | "--color-border-danger"
  | "--color-border-success"
  | "--color-border-warning"
  | "--color-border-disabled"
  | "--color-ring-primary"
  | "--color-ring-secondary"
  | "--color-ring-inverse"
  | "--color-ring-info"
  | "--color-ring-danger"
  | "--color-ring-success"
  | "--color-ring-warning"
  | "--font-sans"
  | "--font-mono"
  | "--font-weight-normal"
  | "--font-weight-medium"
  | "--font-weight-semibold"
  | "--font-weight-bold"
  | "--font-text-xs-size"
  | "--font-text-sm-size"
  | "--font-text-md-size"
  | "--font-text-lg-size"
  | "--font-heading-xs-size"
  | "--font-heading-sm-size"
  | "--font-heading-md-size"
  | "--font-heading-lg-size"
  | "--font-heading-xl-size"
  | "--font-heading-2xl-size"
  | "--font-heading-3xl-size"
  | "--font-text-xs-line-height"
  | "--font-text-sm-line-height"
  | "--font-text-md-line-height"
  | "--font-text-lg-line-height"
  | "--font-heading-xs-line-height"
  | "--font-heading-sm-line-height"
  | "--font-heading-md-line-height"
  | "--font-heading-lg-line-height"
  | "--font-heading-xl-line-height"
  | "--font-heading-2xl-line-height"
  | "--font-heading-3xl-line-height"
  | "--border-radius-xs"
  | "--border-radius-sm"
  | "--border-radius-md"
  | "--border-radius-lg"
  | "--border-radius-xl"
  | "--border-radius-full"
  | "--border-width-regular"
  | "--shadow-hairline"
  | "--shadow-sm"
  | "--shadow-md"
  | "--shadow-lg";

export interface McpAppHostContext {
  theme: McpUiTheme;
  styles: {
    variables: Partial<Record<McpUiStyleVariableKey, string>>;
  };
}

type Source =
  | { type: "css-var"; name: string }
  | { type: "computed"; property: "fontFamily" };

const VARIABLE_SOURCES: Array<[McpUiStyleVariableKey, Source]> = [
  ["--color-background-primary", cssVar("--background")],
  ["--color-background-secondary", cssVar("--card")],
  ["--color-background-tertiary", cssVar("--muted")],
  ["--color-background-inverse", cssVar("--foreground")],
  ["--color-background-ghost", cssVar("--accent")],
  ["--color-background-info", cssVar("--primary")],
  ["--color-background-danger", cssVar("--destructive")],
  ["--color-background-success", cssVar("--chart-1")],
  ["--color-background-warning", cssVar("--chart-4")],
  ["--color-background-disabled", cssVar("--muted")],
  ["--color-text-primary", cssVar("--foreground")],
  ["--color-text-secondary", cssVar("--muted-foreground")],
  ["--color-text-tertiary", cssVar("--muted-foreground")],
  ["--color-text-inverse", cssVar("--background")],
  ["--color-text-info", cssVar("--primary")],
  ["--color-text-danger", cssVar("--destructive")],
  ["--color-text-success", cssVar("--chart-1")],
  ["--color-text-warning", cssVar("--chart-4")],
  ["--color-text-disabled", cssVar("--muted-foreground")],
  ["--color-text-ghost", cssVar("--muted-foreground")],
  ["--color-border-primary", cssVar("--border")],
  ["--color-border-secondary", cssVar("--input")],
  ["--color-border-tertiary", cssVar("--muted")],
  ["--color-border-inverse", cssVar("--foreground")],
  ["--color-border-ghost", cssVar("--accent")],
  ["--color-border-info", cssVar("--primary")],
  ["--color-border-danger", cssVar("--destructive")],
  ["--color-border-success", cssVar("--chart-1")],
  ["--color-border-warning", cssVar("--chart-4")],
  ["--color-border-disabled", cssVar("--muted")],
  ["--color-ring-primary", cssVar("--ring")],
  ["--color-ring-secondary", cssVar("--border")],
  ["--color-ring-inverse", cssVar("--foreground")],
  ["--color-ring-info", cssVar("--primary")],
  ["--color-ring-danger", cssVar("--destructive")],
  ["--color-ring-success", cssVar("--chart-1")],
  ["--color-ring-warning", cssVar("--chart-4")],
  ["--font-sans", cssVar("--font-sans")],
  ["--font-sans", { type: "computed", property: "fontFamily" }],
  ["--font-mono", cssVar("--font-mono")],
  ["--font-weight-normal", cssVar("--font-weight-normal")],
  ["--font-weight-medium", cssVar("--font-weight-medium")],
  ["--font-weight-semibold", cssVar("--font-weight-semibold")],
  ["--font-weight-bold", cssVar("--font-weight-bold")],
  ["--font-text-xs-size", cssVar("--text-xs")],
  ["--font-text-sm-size", cssVar("--text-sm")],
  ["--font-text-md-size", cssVar("--text-base")],
  ["--font-text-lg-size", cssVar("--text-lg")],
  ["--font-heading-xs-size", cssVar("--text-sm")],
  ["--font-heading-sm-size", cssVar("--text-base")],
  ["--font-heading-md-size", cssVar("--text-lg")],
  ["--font-heading-lg-size", cssVar("--text-xl")],
  ["--font-heading-xl-size", cssVar("--text-2xl")],
  ["--font-heading-2xl-size", cssVar("--text-3xl")],
  ["--font-heading-3xl-size", cssVar("--text-4xl")],
  ["--font-text-xs-line-height", cssVar("--text-xs--line-height")],
  ["--font-text-sm-line-height", cssVar("--text-sm--line-height")],
  ["--font-text-md-line-height", cssVar("--text-base--line-height")],
  ["--font-text-lg-line-height", cssVar("--text-lg--line-height")],
  ["--font-heading-xs-line-height", cssVar("--text-sm--line-height")],
  ["--font-heading-sm-line-height", cssVar("--text-base--line-height")],
  ["--font-heading-md-line-height", cssVar("--text-lg--line-height")],
  ["--font-heading-lg-line-height", cssVar("--text-xl--line-height")],
  ["--font-heading-xl-line-height", cssVar("--text-2xl--line-height")],
  ["--font-heading-2xl-line-height", cssVar("--text-3xl--line-height")],
  ["--font-heading-3xl-line-height", cssVar("--text-4xl--line-height")],
  ["--border-radius-xs", cssVar("--radius-sm")],
  ["--border-radius-sm", cssVar("--radius-sm")],
  ["--border-radius-md", cssVar("--radius-md")],
  ["--border-radius-lg", cssVar("--radius-lg")],
  ["--border-radius-xl", cssVar("--radius-xl")],
  ["--border-radius-full", cssVar("--radius-full")],
  ["--border-width-regular", cssVar("--border-width-regular")],
  ["--shadow-hairline", cssVar("--shadow-hairline")],
  ["--shadow-sm", cssVar("--shadow-sm")],
  ["--shadow-md", cssVar("--shadow-md")],
  ["--shadow-lg", cssVar("--shadow-lg")],
];

export function buildMcpAppHostContext(
  theme: Theme,
  root: Element | null =
    typeof document === "undefined" ? null : document.documentElement,
): McpAppHostContext {
  return {
    theme: theme === "light" ? "light" : "dark",
    styles: {
      variables: root ? readMcpStyleVariables(root) : {},
    },
  };
}

export function readMcpStyleVariables(
  root: Element,
): Partial<Record<McpUiStyleVariableKey, string>> {
  const styles = getComputedStyle(root);
  const variables: Partial<Record<McpUiStyleVariableKey, string>> = {};

  for (const [target, source] of VARIABLE_SOURCES) {
    if (variables[target]) continue;
    const value = readSource(styles, source);
    if (value) variables[target] = value;
  }

  return variables;
}

function cssVar(name: string): Source {
  return { type: "css-var", name };
}

function readSource(styles: CSSStyleDeclaration, source: Source) {
  const raw =
    source.type === "css-var"
      ? styles.getPropertyValue(source.name)
      : styles[source.property];
  return raw.trim() || undefined;
}
