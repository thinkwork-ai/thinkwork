import {
  buildPiExtensionArtifactDescriptor,
  canonicalJson,
  piExtensionArtifactHash,
  piExtensionArtifactUri,
  sha256Hex,
  type PiExtensionArtifactDescriptor,
} from "./artifacts.js";
import {
  DEFAULT_PI_EXTENSION_MANIFEST_PATH,
  parsePiExtensionManifest,
  PiExtensionManifestError,
  type PiExtensionManifest,
} from "./manifest.js";
import {
  verifyPiExtensionManifest,
  type PiExtensionVerificationReport,
} from "./verification.js";

export interface GitHubPiExtensionImportInput {
  repositoryUrl: string;
  ref: string;
  manifestPath?: string | null;
}

export interface GitHubPiExtensionImportResult {
  source: {
    sourceType: "github";
    repositoryUrl: string;
    owner: string;
    repo: string;
  };
  version: {
    sourceRef: string;
    commitSha: string;
    displayName: string | null;
    description: string | null;
    manifest: PiExtensionManifest | Record<string, never>;
    manifestPath: string;
    manifestHash: string | null;
    artifactDescriptor: PiExtensionArtifactDescriptor | null;
    artifactHash: string | null;
    artifactUri: string | null;
    runtimeTarget: string | null;
    toolNames: string[];
    lifecycleHooks: string[];
    permissionClasses: string[];
    status: "needs_review" | "failed_verification";
    statusReason: string | null;
    verificationReport: PiExtensionVerificationReport;
  };
}

interface GitHubCommitResponse {
  sha?: unknown;
}

export const MAX_PI_EXTENSION_MANIFEST_BYTES = 256 * 1024;

export class GitHubPiExtensionImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubPiExtensionImportError";
  }
}

export async function importPiExtensionFromGitHubSource(input: {
  request: GitHubPiExtensionImportInput;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): Promise<GitHubPiExtensionImportResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? (() => new Date());
  const source = parseGitHubRepositoryUrl(input.request.repositoryUrl);
  const sourceRef = normalizeRef(input.request.ref);
  const manifestPath = normalizeManifestPath(input.request.manifestPath);
  const commitSha = await resolveGitHubCommitSha({
    owner: source.owner,
    repo: source.repo,
    ref: sourceRef,
    fetchImpl,
  });

  let rawManifest: string;
  try {
    rawManifest = await fetchGitHubRawFile({
      owner: source.owner,
      repo: source.repo,
      commitSha,
      path: manifestPath,
      fetchImpl,
    });
  } catch (error) {
    if (!(error instanceof GitHubPiExtensionImportError)) throw error;
    const message = importErrorMessage(error);
    return failedImportResult({
      source,
      sourceRef,
      commitSha,
      manifestPath,
      checkedAt: now(),
      message,
    });
  }

  let manifest: PiExtensionManifest;
  try {
    manifest = parsePiExtensionManifest(rawManifest);
  } catch (error) {
    if (!(error instanceof PiExtensionManifestError)) throw error;
    const message = importErrorMessage(error);
    return failedImportResult({
      source,
      sourceRef,
      commitSha,
      manifestPath,
      checkedAt: now(),
      message,
    });
  }

  const report = verifyPiExtensionManifest({
    manifest,
    checkedAt: now(),
  });
  const descriptor = buildPiExtensionArtifactDescriptor({
    repositoryUrl: source.repositoryUrl,
    owner: source.owner,
    repo: source.repo,
    commitSha,
    sourceRef,
    manifestPath,
    manifest,
  });
  const artifactHash = piExtensionArtifactHash(descriptor);

  return {
    source: {
      sourceType: "github",
      repositoryUrl: source.repositoryUrl,
      owner: source.owner,
      repo: source.repo,
    },
    version: {
      sourceRef,
      commitSha,
      displayName: manifest.displayName,
      description: manifest.description,
      manifest,
      manifestPath,
      manifestHash: sha256Hex(canonicalJson(manifest)),
      artifactDescriptor: descriptor,
      artifactHash,
      artifactUri: piExtensionArtifactUri(descriptor),
      runtimeTarget: manifest.runtimeTarget,
      toolNames: manifest.tools.map((tool) => tool.name),
      lifecycleHooks: manifest.lifecycleHooks,
      permissionClasses: manifest.permissionClasses,
      status:
        report.status === "passed" ? "needs_review" : "failed_verification",
      statusReason:
        report.status === "passed"
          ? null
          : (firstErrorMessage(report) ?? "Extension verification failed"),
      verificationReport: report,
    },
  };
}

export function parseGitHubRepositoryUrl(value: string): {
  repositoryUrl: string;
  owner: string;
  repo: string;
} {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new GitHubPiExtensionImportError("GitHub repository URL is required");
  }

  const sshMatch = trimmed.match(
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/,
  );
  if (sshMatch) {
    return normalizedRepository(sshMatch[1]!, sshMatch[2]!);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new GitHubPiExtensionImportError(
      "GitHub repository URL must be a github.com URL",
    );
  }
  if (url.hostname !== "github.com") {
    throw new GitHubPiExtensionImportError(
      "GitHub repository URL must use github.com",
    );
  }
  const [owner, repo] = url.pathname.replace(/^\/+/, "").split("/");
  if (!owner || !repo) {
    throw new GitHubPiExtensionImportError(
      "GitHub repository URL must include owner and repository",
    );
  }
  return normalizedRepository(owner, repo);
}

function normalizedRepository(owner: string, repo: string) {
  const cleanRepo = repo.replace(/\.git$/, "");
  if (
    !/^[A-Za-z0-9_.-]+$/.test(owner) ||
    !/^[A-Za-z0-9_.-]+$/.test(cleanRepo)
  ) {
    throw new GitHubPiExtensionImportError(
      "GitHub repository owner and name contain invalid characters",
    );
  }
  return {
    owner,
    repo: cleanRepo,
    repositoryUrl: `https://github.com/${owner}/${cleanRepo}`,
  };
}

function normalizeRef(value: string): string {
  const ref = value.trim();
  if (!ref || ref.includes("..") || ref.startsWith("/") || ref.endsWith("/")) {
    throw new GitHubPiExtensionImportError("GitHub ref is invalid");
  }
  return ref;
}

function normalizeManifestPath(value: string | null | undefined): string {
  const path = (value ?? DEFAULT_PI_EXTENSION_MANIFEST_PATH).trim();
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("..") ||
    path.includes("//")
  ) {
    throw new GitHubPiExtensionImportError(
      "Extension manifest path is invalid",
    );
  }
  return path;
}

async function resolveGitHubCommitSha(input: {
  owner: string;
  repo: string;
  ref: string;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const response = await input.fetchImpl(
    `https://api.github.com/repos/${input.owner}/${input.repo}/commits/${encodeURIComponent(input.ref)}`,
    { headers: githubHeaders("application/vnd.github+json") },
  );
  if (!response.ok) {
    throw new GitHubPiExtensionImportError(
      `GitHub ref could not be resolved (${response.status})`,
    );
  }
  const body = (await response.json()) as GitHubCommitResponse;
  if (typeof body.sha !== "string" || !/^[a-f0-9]{40}$/i.test(body.sha)) {
    throw new GitHubPiExtensionImportError(
      "GitHub commit response did not include a valid commit SHA",
    );
  }
  return body.sha;
}

async function fetchGitHubRawFile(input: {
  owner: string;
  repo: string;
  commitSha: string;
  path: string;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const response = await input.fetchImpl(
    `https://raw.githubusercontent.com/${input.owner}/${input.repo}/${input.commitSha}/${input.path}`,
    { headers: githubHeaders("application/json,text/plain,*/*") },
  );
  if (!response.ok) {
    throw new GitHubPiExtensionImportError(
      `Extension manifest could not be fetched (${response.status})`,
    );
  }
  return readResponseTextWithLimit(response, MAX_PI_EXTENSION_MANIFEST_BYTES);
}

function githubHeaders(accept: string): Record<string, string> {
  return {
    Accept: accept,
    "User-Agent": "thinkwork-pi-extension-importer",
    ...(process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {}),
  };
}

async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new GitHubPiExtensionImportError(
      `Extension manifest exceeds ${maxBytes} byte limit`,
    );
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new GitHubPiExtensionImportError(
        `Extension manifest exceeds ${maxBytes} byte limit`,
      );
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new GitHubPiExtensionImportError(
        `Extension manifest exceeds ${maxBytes} byte limit`,
      );
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function failedImportResult(input: {
  source: { repositoryUrl: string; owner: string; repo: string };
  sourceRef: string;
  commitSha: string;
  manifestPath: string;
  checkedAt: Date;
  message: string;
}): GitHubPiExtensionImportResult {
  return {
    source: {
      sourceType: "github",
      repositoryUrl: input.source.repositoryUrl,
      owner: input.source.owner,
      repo: input.source.repo,
    },
    version: {
      sourceRef: input.sourceRef,
      commitSha: input.commitSha,
      displayName: null,
      description: null,
      manifest: {},
      manifestPath: input.manifestPath,
      manifestHash: null,
      artifactDescriptor: null,
      artifactHash: null,
      artifactUri: null,
      runtimeTarget: null,
      toolNames: [],
      lifecycleHooks: [],
      permissionClasses: [],
      status: "failed_verification",
      statusReason: input.message,
      verificationReport: {
        schemaVersion: 1,
        status: "failed",
        checkedAt: input.checkedAt.toISOString(),
        findings: [
          {
            severity: "error",
            code: "import_failed",
            message: input.message,
          },
        ],
      },
    },
  };
}

function importErrorMessage(error: unknown): string {
  if (
    error instanceof GitHubPiExtensionImportError ||
    error instanceof PiExtensionManifestError
  ) {
    return error.message;
  }
  return error instanceof Error ? error.message : "Extension import failed";
}

function firstErrorMessage(
  report: PiExtensionVerificationReport,
): string | null {
  return (
    report.findings.find((finding) => finding.severity === "error")?.message ??
    null
  );
}
