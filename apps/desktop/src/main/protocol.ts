import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

export const DESKTOP_APP_ORIGIN = "thinkwork://app";
export const DESKTOP_APP_URL = `${DESKTOP_APP_ORIGIN}/`;

const DEFAULT_FRAME_SRC = "https://sandbox.thinkwork.ai";

export interface ElectronProtocolLike {
  handle(
    scheme: string,
    handler: (request: { url: string }) => Promise<Response>,
  ): void;
}

export interface DesktopCspOptions {
  apiUrl?: string | null;
  graphqlHttpUrl?: string | null;
  graphqlUrl?: string | null;
  graphqlWsUrl?: string | null;
  cognitoDomain?: string | null;
  sandboxFrameSrc?: string | null;
}

export interface RegisterThinkworkProtocolOptions {
  protocol: ElectronProtocolLike;
  rendererRoot: string;
  csp: string;
  scheme?: string;
}

export interface HandleThinkworkProtocolOptions {
  rendererRoot: string;
  csp: string;
}

interface FileResolution {
  status: 200 | 403 | 404;
  filePath: string | null;
  contentType: string;
}

export function registerThinkworkProtocol(
  options: RegisterThinkworkProtocolOptions,
): void {
  options.protocol.handle(options.scheme ?? "thinkwork", async (request) =>
    handleThinkworkProtocolUrl(request.url, {
      rendererRoot: options.rendererRoot,
      csp: options.csp,
    }),
  );
}

export async function handleThinkworkProtocolUrl(
  url: string,
  options: HandleThinkworkProtocolOptions,
): Promise<Response> {
  const resolution = await resolveRendererFile(url, options.rendererRoot);

  if (!resolution.filePath) {
    return new Response(null, {
      status: resolution.status,
      headers: responseHeaders(options.csp, resolution.contentType),
    });
  }

  return new Response(await readFile(resolution.filePath), {
    status: 200,
    headers: responseHeaders(options.csp, resolution.contentType),
  });
}

export async function resolveRendererFile(
  url: string,
  rendererRoot: string,
): Promise<FileResolution> {
  const parsedUrl = new URL(url);

  if (parsedUrl.hostname !== "app") {
    return notFound();
  }

  const root = resolve(rendererRoot);
  const normalized = normalizeRendererPath(
    rawPathnameFromUrl(url, parsedUrl),
    root,
  );

  if (!normalized.safe) {
    return forbidden();
  }

  if (normalized.pathHasExtension) {
    return (await fileExists(normalized.targetPath))
      ? ok(normalized.targetPath)
      : notFound();
  }

  const directoryIndexPath = resolve(normalized.targetPath, "index.html");
  if (
    isPathInsideRoot(directoryIndexPath, root) &&
    (await fileExists(directoryIndexPath))
  ) {
    return ok(directoryIndexPath);
  }

  const appIndexPath = resolve(root, "index.html");
  return (await fileExists(appIndexPath)) ? ok(appIndexPath) : notFound();
}

export function buildDesktopCsp(options: DesktopCspOptions = {}): string {
  const connectSrc = uniqueSources([
    "'self'",
    // `data:` + `blob:` are required so the renderer can `fetch()` the
    // data/blob URLs the composer produces when reifying an attached file
    // (fileUiPartsToFiles). `connect-src` governs fetch(), and without these
    // the packaged build silently fails every attachment upload — the dev
    // server's looser CSP masked it. img-src/font-src already allow data:.
    "data:",
    "blob:",
    // Attachment uploads PUT the file bytes directly to an S3 presigned URL
    // (`<bucket>.s3.<region>.amazonaws.com`), and downloads/finalize hit other
    // AWS endpoints. fetch() is governed by connect-src, so the S3 origin must
    // be allowed or the PUT is refused and the upload fails after presign — the
    // exact symptom that left new threads empty on packaged builds.
    "https://*.amazonaws.com",
    DESKTOP_APP_ORIGIN,
    originFromUrl(options.graphqlHttpUrl),
    originFromUrl(options.apiUrl),
    originFromUrl(options.graphqlUrl),
    originFromUrl(options.graphqlWsUrl),
    cognitoOrigin(options.cognitoDomain),
  ]);
  const frameSrc = uniqueSources([
    originFromUrl(options.sandboxFrameSrc),
    DEFAULT_FRAME_SRC,
  ]);

  return [
    `default-src 'self' ${DESKTOP_APP_ORIGIN}`,
    `script-src 'self' ${DESKTOP_APP_ORIGIN}`,
    `style-src 'self' ${DESKTOP_APP_ORIGIN} 'unsafe-inline'`,
    `img-src 'self' ${DESKTOP_APP_ORIGIN} data: https://*.thinkwork.ai`,
    `font-src 'self' ${DESKTOP_APP_ORIGIN} data:`,
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src ${frameSrc.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function normalizeRendererPath(
  rawPathname: string,
  rendererRoot: string,
):
  | { safe: true; targetPath: string; pathHasExtension: boolean }
  | { safe: false } {
  const segments: string[] = [];

  for (const rawSegment of rawPathname.split("/")) {
    if (!rawSegment) continue;

    let segment: string;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      return { safe: false };
    }

    if (
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes("\0")
    ) {
      return { safe: false };
    }
    if (segment === ".") continue;
    segments.push(segment);
  }

  const targetPath = resolve(rendererRoot, ...segments);
  if (!isPathInsideRoot(targetPath, rendererRoot)) return { safe: false };

  return {
    safe: true,
    targetPath,
    pathHasExtension: extname(targetPath).length > 0,
  };
}

function rawPathnameFromUrl(url: string, parsedUrl: URL): string {
  const schemeAndHost = `${parsedUrl.protocol}//${parsedUrl.host}`;
  const suffix = url.slice(schemeAndHost.length);
  const rawPathAndSearch = suffix.startsWith("/") ? suffix : "/";
  const queryOrHashIndex = rawPathAndSearch.search(/[?#]/);

  return queryOrHashIndex === -1
    ? rawPathAndSearch
    : rawPathAndSearch.slice(0, queryOrHashIndex);
}

function responseHeaders(csp: string, contentType: string): Headers {
  return new Headers({
    "Content-Security-Policy": csp,
    "Content-Type": contentType,
  });
}

function ok(filePath: string): FileResolution {
  return {
    status: 200,
    filePath,
    contentType: contentTypeForPath(filePath),
  };
}

function forbidden(): FileResolution {
  return {
    status: 403,
    filePath: null,
    contentType: "text/plain; charset=utf-8",
  };
}

function notFound(): FileResolution {
  return {
    status: 404,
    filePath: null,
    contentType: "text/plain; charset=utf-8",
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

function isPathInsideRoot(filePath: string, rendererRoot: string): boolean {
  const root = resolve(rendererRoot);
  const target = resolve(filePath);
  return target === root || target.startsWith(`${root}${sep}`);
}

function contentTypeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function uniqueSources(sources: Array<string | null | undefined>): string[] {
  return [...new Set(sources.filter((source): source is string => !!source))];
}

function originFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function cognitoOrigin(domain: string | null | undefined): string | null {
  if (!domain) return null;
  if (/^https?:\/\//i.test(domain)) return originFromUrl(domain);

  const trimmedDomain = domain.replace(/\/$/, "");
  if (trimmedDomain.includes(".auth.")) {
    return originFromUrl(`https://${trimmedDomain}`);
  }

  return originFromUrl(
    `https://${trimmedDomain}.auth.us-east-1.amazoncognito.com`,
  );
}
