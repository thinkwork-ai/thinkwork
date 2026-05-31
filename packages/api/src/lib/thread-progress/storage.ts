import {
  readThreadGoalFile,
  threadGoalFileKey,
  truncateThreadGoalFileForPrompt,
  writeThreadGoalFile,
  type ThreadGoalStorageDeps,
} from "../thread-goals/storage.js";

export const MAX_THREAD_PROGRESS_BYTES = 64 * 1024;
export const MAX_INJECTED_THREAD_PROGRESS_CHARS = 24_000;

export type ThreadProgressStorageDeps = ThreadGoalStorageDeps;

export interface ThreadProgressAddress {
  tenantSlug: string;
  threadId: string;
  threadFolderName?: string | null;
}

export function threadProgressKey(input: ThreadProgressAddress): string {
  return threadGoalFileKey({ ...input, file: "PROGRESS.md" });
}

export async function readThreadProgressMarkdown(
  input: ThreadProgressAddress,
  deps: ThreadProgressStorageDeps = {},
): Promise<string | null> {
  return readThreadGoalFile({ ...input, file: "PROGRESS.md" }, deps);
}

export async function writeThreadProgressMarkdown(
  input: ThreadProgressAddress & { content: string },
  deps: ThreadProgressStorageDeps = {},
): Promise<{ key: string; bytes: number }> {
  return writeThreadGoalFile({ ...input, file: "PROGRESS.md" }, deps);
}

export function formatThreadProgressPromptBlock(content: string): string {
  const bounded = truncateThreadProgressMarkdown(content);
  return [
    "<thread_progress_md>",
    "The following is the current thread PROGRESS.md. Treat it as the latest operational state for this Thread. Do not edit it directly unless a workflow tool explicitly writes thread progress.",
    "",
    bounded,
    "</thread_progress_md>",
  ].join("\n");
}

export function prependThreadProgressPromptBlock(
  agentMessage: string,
  content: string | null,
): string {
  if (!content) return agentMessage;
  return `${formatThreadProgressPromptBlock(content)}\n\n---\n\n${agentMessage}`;
}

export function truncateThreadProgressMarkdown(content: string): string {
  return truncateThreadGoalFileForPrompt("PROGRESS.md", content);
}
