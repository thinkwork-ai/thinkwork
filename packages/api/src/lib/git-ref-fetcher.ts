import { inspectZipBuffer } from "./plugin-zip-safety.js";

export interface GitRefFetchInput {
  url: string;
  ref?: string;
  pat?: string;
}

export type GitRefFetchResult =
  | { ok: true; files: Record<string, string> }
  | { ok: false; error: string; statusCode: number };

const MAX_GIT_ARCHIVE_BYTES = 50 * 1024 * 1024;

export async function fetchGitRefAsFileTree(
  input: GitRefFetchInput,
): Promise<GitRefFetchResult> {
  const parsed = parseGitHubUrl(input.url);
  if (!parsed) {
    return {
      ok: false,
      statusCode: 400,
      error: "Only GitHub HTTPS or git@github.com refs are supported in v1",
    };
  }

  const ref = input.ref || "HEAD";
  const archiveUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/zipball/${encodeURIComponent(ref)}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "thinkwork-folder-bundle-import",
  };
  if (input.pat) headers.Authorization = `Bearer ${input.pat}`;

  const response = await fetch(archiveUrl, { headers });
  if (!response.ok) {
    return {
      ok: false,
      statusCode: response.status,
      error: `Git ref fetch failed with HTTP ${response.status}`,
    };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_GIT_ARCHIVE_BYTES) {
    return {
      ok: false,
      statusCode: 413,
      error: `Git archive is ${bytes.length} bytes, max is ${MAX_GIT_ARCHIVE_BYTES}`,
    };
  }

  const zip = await inspectZipBuffer(bytes);
  if (!zip.valid) {
    return {
      ok: false,
      statusCode: 400,
      error: `Git archive failed zip safety checks: ${zip.errors.map((e) => e.kind).join(", ")}`,
    };
  }

  const files: Record<string, string> = {};
  for (const entry of zip.entries) {
    const withoutRoot = stripArchiveRoot(entry.path);
    if (!withoutRoot) continue;
    if (withoutRoot === ".gitmodules" || withoutRoot.endsWith("/.gitmodules")) {
      return {
        ok: false,
        statusCode: 400,
        error: "Git repositories with submodules are not supported in v1",
      };
    }
    files[withoutRoot] = entry.text;
  }
  return { ok: true, files };
}

function parseGitHubUrl(raw: string): { owner: string; repo: string } | null {
  const ssh = raw.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]!.replace(/\.git$/, "") };

  try {
    const url = new URL(raw);
    if (url.hostname !== "github.com") return null;
    const [owner, repo] = url.pathname.replace(/^\/+/, "").split("/");
    if (!owner || !repo) return null;
    return { owner, repo: repo.replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

function stripArchiveRoot(path: string): string {
  const parts = path.split("/");
  return parts.length <= 1 ? "" : parts.slice(1).join("/");
}
