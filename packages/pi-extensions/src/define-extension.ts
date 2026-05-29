import type {
  ExtensionAPI,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import type {
  DelegationProvider,
  MemoryProvider,
  ModelProvider,
  WorkspaceProvider,
} from "@thinkwork/pi-runtime-core";

// Type-only imports above: this package carries no runtime dependency on the
// heavy `@earendil-works/pi-coding-agent` module. Extensions receive the live
// `ExtensionAPI` from the host at load time; we only need its shape here.

/**
 * The U3 provider seam handed to every extension. Extensions call these host
 * capabilities (creds/clients supplied by the cloud or desktop host) rather
 * than constructing AWS/Bedrock/Hindsight clients themselves — that is what
 * keeps a single extension package host-agnostic. Each provider is optional
 * because a host only supplies what a given deployment needs.
 */
export interface ProviderBundle {
  model?: ModelProvider;
  workspace?: WorkspaceProvider;
  memory?: MemoryProvider;
  delegation?: DelegationProvider;
}

/**
 * A thinkwork platform capability authored as a Pi extension. `register`
 * receives the live Pi {@link ExtensionAPI} (to `registerTool` / `on(event)` /
 * edit the system prompt) plus the {@link ProviderBundle} host seam. The
 * authoring convention is: register tools/hooks on `pi`, reach host services
 * only through `providers`.
 */
export interface ThinkworkExtension {
  /** Stable identifier (kebab-case), used in logs and load ordering. */
  name: string;
  register(pi: ExtensionAPI, providers: ProviderBundle): void | Promise<void>;
}

/**
 * Validate and brand an extension definition. Rejects a malformed extension
 * (missing name or `register`) at authoring time rather than at host load.
 */
export function defineExtension(
  extension: ThinkworkExtension,
): ThinkworkExtension {
  if (!extension || typeof extension !== "object") {
    throw new Error("defineExtension requires an extension object.");
  }
  if (typeof extension.name !== "string" || extension.name.trim() === "") {
    throw new Error("Extension is missing a non-empty `name`.");
  }
  if (typeof extension.register !== "function") {
    throw new Error(
      `Extension "${extension.name}" is missing a \`register\` function.`,
    );
  }
  return extension;
}

/**
 * Bind a {@link ThinkworkExtension} to a {@link ProviderBundle}, producing a
 * plain Pi {@link ExtensionFactory} the host loads via the resource loader's
 * `extensionFactories` (the serverless loading mechanism resolved in the U1
 * spike). The factory closes over the providers so the host supplies creds once.
 */
export function toExtensionFactory(
  extension: ThinkworkExtension,
  providers: ProviderBundle,
): ExtensionFactory {
  return (pi: ExtensionAPI) => extension.register(pi, providers);
}

/**
 * Bind a set of extensions to one provider bundle, in declaration order.
 * Convenience for a host wiring the whole shared package at once.
 */
export function toExtensionFactories(
  extensions: ThinkworkExtension[],
  providers: ProviderBundle,
): ExtensionFactory[] {
  return extensions.map((extension) =>
    toExtensionFactory(extension, providers),
  );
}
