import { transform as sucraseTransform } from "sucrase";
import {
  APPLET_STDLIB_VERSION,
  APPLET_TRANSFORM_VERSION,
  appletTransformCache,
  createAppletCacheKey,
  type AppletTransformCache,
} from "./cache";
import { rewriteAppletImports } from "./import-shim";

export interface TransformAppletOptions {
  appId?: string;
  stdlibVersion?: string;
  transformVersion?: string;
  useWorker?: boolean;
  cache?: AppletTransformCache;
}

export interface TransformAppletSuccess {
  ok: true;
  compiledModuleUrl: string;
  cacheKey: string;
  cached: boolean;
}

export interface TransformAppletFailure {
  ok: false;
  error: {
    message: string;
    line?: number;
    column?: number;
  };
}

export type TransformAppletResult =
  | TransformAppletSuccess
  | TransformAppletFailure;

interface WorkerResponse {
  ok: boolean;
  compiledCode?: string;
  error?: TransformAppletFailure["error"];
}

export async function transformApplet(
  source: string,
  version: string | number,
  options: TransformAppletOptions = {},
): Promise<TransformAppletResult> {
  const cache = options.cache ?? appletTransformCache;
  const cacheKey = createAppletCacheKey({
    source,
    stdlibVersion: options.stdlibVersion ?? APPLET_STDLIB_VERSION,
    transformVersion: options.transformVersion ?? APPLET_TRANSFORM_VERSION,
  });
  const cached = cache.get(cacheKey);
  if (cached) {
    return { ok: true, compiledModuleUrl: cached, cacheKey, cached: true };
  }

  const compiled =
    options.useWorker === false || typeof Worker === "undefined"
      ? compileAppletSource(source)
      : await compileAppletSourceInWorker(source, version, options.appId);
  if (!compiled.ok) return compiled;

  const compiledModuleUrl = createCompiledModuleUrl(compiled.code);
  cache.set(cacheKey, compiledModuleUrl);
  return { ok: true, compiledModuleUrl, cacheKey, cached: false };
}

export function compileAppletSource(source: string):
  | { ok: true; code: string }
  | TransformAppletFailure {
  try {
    const transformed = sucraseTransform(source, {
      transforms: ["typescript", "jsx"],
      keepUnusedImports: true,
      preserveDynamicImport: true,
      production: true,
      jsxRuntime: "automatic",
    }).code;
    return { ok: true, code: rewriteAppletImports(transformed) };
  } catch (error) {
    return { ok: false, error: normalizeTransformError(error) };
  }
}

function compileAppletSourceInWorker(
  source: string,
  version: string | number,
  appId?: string,
) {
  return new Promise<
    { ok: true; code: string } | TransformAppletFailure
  >((resolve) => {
    const worker = new Worker(new URL("./sucrase-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      worker.terminate();
      if (event.data.ok && event.data.compiledCode) {
        resolve({ ok: true, code: event.data.compiledCode });
      } else {
        resolve({
          ok: false,
          error: event.data.error ?? { message: "Applet transform failed" },
        });
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      resolve({
        ok: false,
        error: { message: event.message || "Applet transform worker failed" },
      });
    };
    worker.postMessage({ source, appId, version });
  });
}

function createCompiledModuleUrl(code: string) {
  if (typeof URL.createObjectURL === "function") {
    return URL.createObjectURL(
      new Blob([code], { type: "application/javascript" }),
    );
  }

  return `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
}

function normalizeTransformError(error: unknown) {
  const maybeLocation = error as {
    message?: string;
    loc?: { line?: number; column?: number };
    line?: number;
    column?: number;
  };
  return {
    message: maybeLocation.message ?? "Applet transform failed",
    line: maybeLocation.loc?.line ?? maybeLocation.line,
    column: maybeLocation.loc?.column ?? maybeLocation.column,
  };
}
