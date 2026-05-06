import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function ensureWorkspace(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const markerPath = join(root, ".thinkwork-computer-health");
  await writeFile(markerPath, `ok ${new Date().toISOString()}\n`, {
    encoding: "utf8",
  });
  return markerPath;
}

export async function writeHealthCheck(root: string, taskId: string) {
  const path = join(root, `.thinkwork-health-${taskId}`);
  await writeFile(path, JSON.stringify({ taskId, ok: true }) + "\n", {
    encoding: "utf8",
  });
  return path;
}
