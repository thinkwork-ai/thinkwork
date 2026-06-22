import type {
  ExtensionAPI,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type {
  DelegationProvider,
  KnowledgeGraphProvider,
  MemoryProvider,
  ModelProvider,
  OkfWikiNavigatorProvider,
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
  knowledgeGraph?: KnowledgeGraphProvider;
  okfWiki?: OkfWikiNavigatorProvider;
}

/**
 * A typed empty TypeBox parameter schema for tools that take no arguments.
 * Use this (or a real `Type.Object({...})`) for `ToolDefinition.parameters`
 * rather than casting — the schema is the most error-prone field, so authors
 * should get type-checking, not a hole.
 */
export const emptyToolParameters = Type.Object({});

/**
 * A thinkwork platform capability authored as a Pi extension. `register`
 * receives the live Pi {@link ExtensionAPI} (to `registerTool` / `on(event)` /
 * edit the system prompt) plus the {@link ProviderBundle} host seam. The
 * authoring convention is: register tools/hooks on `pi`, reach host services
 * only through `providers`.
 */
export interface ThinkworkExtension {
  /** Authoring-time identifier (kebab-case). Surfaced in `defineExtension`
   *  validation errors; not yet plumbed into the Pi runtime (Pi keys
   *  extensions by load path). */
  name: string;
  /**
   * Names of the LLM-callable tools this extension registers via
   * `pi.registerTool`. The host MUST fold these into the `createAgentSession`
   * tool allowlist: when an allowlist is provided the SDK enables ONLY the
   * listed names, so extension tools omitted from it register but are silently
   * gated out and never reach the model. Empty/omitted for hook-only extensions
   * (e.g. the system-prompt extension's `before_agent_start`).
   */
  toolNames?: readonly string[];
  register(pi: ExtensionAPI, providers: ProviderBundle): void | Promise<void>;
}

/** Collect the declared tool names across a set of extensions (deduped), for
 *  the host to add to the `createAgentSession` allowlist. */
export function collectExtensionToolNames(
  extensions: readonly ThinkworkExtension[],
): string[] {
  return [...new Set(extensions.flatMap((ext) => ext.toolNames ?? []))];
}

/**
 * Acquire a required provider up front, throwing a descriptive error naming the
 * extension when the host did not supply it. The authoring convention for any
 * extension that genuinely needs a capability: fail loud at load rather than
 * silently no-op mid-turn (the all-optional {@link ProviderBundle} otherwise
 * invites silent degradation). Provider-optional extensions read the bundle
 * directly instead.
 */
export function requireProvider<K extends keyof ProviderBundle>(
  providers: ProviderBundle,
  key: K,
  extensionName: string,
): NonNullable<ProviderBundle[K]> {
  const provider = providers[key];
  if (provider == null) {
    throw new Error(
      `Extension "${extensionName}" requires a "${key}" provider, but the host supplied none.`,
    );
  }
  return provider as NonNullable<ProviderBundle[K]>;
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
