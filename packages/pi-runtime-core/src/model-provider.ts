/**
 * ModelProvider — the host-supplied seam for turning a requested model ID into
 * whatever the host's framework needs to make a model call, with fail-loud
 * resolution.
 *
 * Inert in this unit: the core defines the contract and the typed error; no host
 * implements it yet (cloud wiring lands in U7). Each host supplies its own
 * supported-ID set so the core can reject an unrecognized model uniformly
 * instead of silently substituting a default (the bug where the desktop UI could
 * label a turn "Kimi" while Sonnet actually ran).
 *
 * Resolution is the FIRST gate. A model ID can pass `supports()`/`resolve()` and
 * still fail at the provider with a ValidationException — notably a Bedrock model
 * missing its `us.` inference-profile prefix, which today zeroes tokens silently.
 * Host implementations (U7) must surface that post-resolution failure as a
 * terminal error rather than recording a zero-token success; the typed error
 * below covers only the pre-call unsupported-ID case.
 *
 * Credential discipline: any implementation that reaches AWS/Bedrock to resolve
 * or validate a model must use credentials/identity snapshotted at loop entry,
 * never re-read from `process.env` mid-turn (see
 * feedback_completion_callback_snapshot_pattern).
 */

/**
 * Thrown when a model ID is not in the host's supported set. Typed so callers can
 * branch on it (e.g. finalize a turn `status: failed` with a surfaced error)
 * rather than pattern-matching on a message string. This is the uniform failure
 * mode that replaces the silent Sonnet fallback.
 */
export class UnsupportedModelError extends Error {
  readonly modelId: string;
  readonly supportedModelIds?: readonly string[];

  constructor(modelId: string, supportedModelIds?: readonly string[]) {
    const known =
      supportedModelIds && supportedModelIds.length > 0
        ? ` Supported models: ${supportedModelIds.join(", ")}.`
        : "";
    super(`Unsupported model "${modelId}".${known}`);
    this.name = "UnsupportedModelError";
    this.modelId = modelId;
    this.supportedModelIds = supportedModelIds;
    // Preserve the prototype chain for `instanceof` across transpile targets.
    Object.setPrototypeOf(this, UnsupportedModelError.prototype);
  }
}

/**
 * @typeParam TResolved - the host's model representation returned by `resolve()`.
 * Host-defined and opaque to the core (a Bedrock model descriptor, a pi-ai model
 * object, etc.); defaults to `unknown` so the core depends on the resolution
 * contract, not the resolved value's internals. Hosts specialize it, e.g.
 * `ModelProvider<BedrockModelDescriptor>`.
 */
export interface ModelProvider<TResolved = unknown> {
  /**
   * Whether the given model ID is in this host's supported set. Pure and
   * side-effect free — callers use it to gate before `resolve()`.
   */
  supports(modelId: string): boolean;

  /**
   * Resolve a model ID into the host's model representation.
   *
   * MUST throw {@link UnsupportedModelError} for any ID where
   * `supports(modelId)` is false. Implementations must not fall back to a
   * default model — the throw is the contract.
   */
  resolve(modelId: string): TResolved;
}
