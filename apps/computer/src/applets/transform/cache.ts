export const APPLET_TRANSFORM_VERSION = "u5-inert-transform-v1";
export const APPLET_STDLIB_VERSION = "0.1.0";

export interface AppletCacheKeyInput {
  source: string;
  stdlibVersion?: string;
  transformVersion?: string;
}

export class AppletTransformCache {
  private readonly entries = new Map<string, string>();

  constructor(private readonly maxEntries = 50) {}

  get(key: string) {
    const value = this.entries.get(key);
    if (!value) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, moduleUrl: string) {
    const previous = this.entries.get(key);
    if (previous && previous !== moduleUrl) revokeModuleUrl(previous);
    this.entries.delete(key);
    this.entries.set(key, moduleUrl);
    this.evictOverflow();
  }

  clear() {
    for (const moduleUrl of this.entries.values()) {
      revokeModuleUrl(moduleUrl);
    }
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }

  private evictOverflow() {
    while (this.entries.size > this.maxEntries) {
      const [key, moduleUrl] = this.entries.entries().next().value as [
        string,
        string,
      ];
      this.entries.delete(key);
      revokeModuleUrl(moduleUrl);
    }
  }
}

export const appletTransformCache = new AppletTransformCache();

export function createAppletCacheKey(input: AppletCacheKeyInput) {
  return [
    hashSource(input.source),
    input.stdlibVersion ?? APPLET_STDLIB_VERSION,
    input.transformVersion ?? APPLET_TRANSFORM_VERSION,
  ].join(":");
}

function hashSource(source: string) {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function revokeModuleUrl(moduleUrl: string) {
  if (moduleUrl.startsWith("blob:")) {
    URL.revokeObjectURL(moduleUrl);
  }
}
