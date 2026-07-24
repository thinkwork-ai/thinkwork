import { useCallback, useMemo, useState } from "react";
import { BookOpen, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getDocumentViewUrlByKey } from "@/lib/kb-files-api";

/**
 * Knowledge-base citations for one agent turn (AI-Elements-style Sources
 * block): "Used N sources" collapsible, one row per distinct document the
 * turn's `search_knowledge` calls returned passages from. Clicking a row
 * resolves a presigned view URL for the original file (rendered inline for
 * PDFs/text, downloaded otherwise) — the KB manifest is the lookup key, so
 * this works for managed uploads and connected external buckets alike.
 */

/** Extract cited document keys from a turn's tool invocations. Handles both
 * the Pi runner shape ({name, result.content[].text}) and the ledger shape
 * ({tool_name, output_preview}). Order of first citation is preserved. */
export function knowledgeSourceKeysFromInvocations(
  invocations: unknown[],
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const collect = (text: string) => {
    for (const match of text.matchAll(
      /^\s*Source:\s*(.+?)(?:\s+\(edition \d+\))?\s*$/gm,
    )) {
      const key = match[1].trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  };
  for (const value of invocations) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const name =
      (typeof record.tool_name === "string" && record.tool_name) ||
      (typeof record.toolName === "string" && record.toolName) ||
      (typeof record.name === "string" && record.name) ||
      "";
    if (name !== "search_knowledge") continue;
    const result = record.result as Record<string, unknown> | undefined;
    const content = Array.isArray(result?.content) ? result.content : [];
    for (const block of content) {
      const text = (block as Record<string, unknown>)?.text;
      if (typeof text === "string") collect(text);
    }
    if (typeof record.output_preview === "string") {
      collect(record.output_preview);
    }
  }
  return keys;
}

function displayName(documentKey: string): string {
  const base = documentKey.slice(documentKey.lastIndexOf("/") + 1);
  return base || documentKey;
}

export function KnowledgeSourcesCard({
  documentKeys,
  className,
}: {
  documentKeys: string[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const names = useMemo(
    () => documentKeys.map((key) => ({ key, name: displayName(key) })),
    [documentKeys],
  );

  const openSource = useCallback(async (documentKey: string) => {
    setError(null);
    setOpening(documentKey);
    // Open the tab synchronously — popup blockers kill window.open calls
    // issued after an await.
    const tab = window.open("about:blank", "_blank");
    try {
      const url = await getDocumentViewUrlByKey(documentKey);
      if (tab) {
        tab.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "Failed to open source");
    } finally {
      setOpening(null);
    }
  }, []);

  if (documentKeys.length === 0) return null;

  return (
    <div className={cn("min-w-0", className)}>
      <button
        type="button"
        className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        Used {documentKeys.length}{" "}
        {documentKeys.length === 1 ? "source" : "sources"}
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", {
            "rotate-180": open,
          })}
        />
      </button>
      {open ? (
        <ul className="mt-1.5 grid gap-1">
          {names.map(({ key, name }) => (
            <li key={key} className="min-w-0">
              <button
                type="button"
                className="flex min-w-0 max-w-full items-center gap-1.5 text-left text-xs text-primary hover:underline"
                title={key}
                onClick={() => void openSource(key)}
              >
                {opening === key ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : (
                  <BookOpen className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="truncate">{name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
