import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { yaml } from "@codemirror/lang-yaml";
import { languages } from "@codemirror/language-data";

export function languageForFile(
  filePath: string | null | undefined,
): Extension[] {
  if (!filePath) return [];

  const lastSegment = filePath.split("/").pop() ?? filePath;
  const dot = lastSegment.lastIndexOf(".");
  if (dot < 0) return [];

  const ext = lastSegment.slice(dot).toLowerCase();

  switch (ext) {
    case ".md":
    case ".markdown":
      return [markdown({ base: markdownLanguage, codeLanguages: languages })];
    case ".json":
    case ".jsonc":
      return [json()];
    case ".ts":
    case ".tsx":
      return [javascript({ jsx: true, typescript: true })];
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return [javascript({ jsx: true })];
    case ".py":
    case ".pyi":
      return [python()];
    case ".yaml":
    case ".yml":
      return [yaml()];
    default:
      return [];
  }
}
