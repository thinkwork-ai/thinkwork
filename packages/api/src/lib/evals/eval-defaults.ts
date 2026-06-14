/**
 * Eval defaults — leaf constants with NO heavy imports.
 *
 * Kept separate from `agentcore-direct.ts` (which imports
 * `resolve-agent-runtime-config` → `oauth-token`, a barrel-`schema`
 * consumer) so a module that only needs the default model id doesn't drag
 * that whole chain into widely-imported, partially-mocked code paths.
 */

/** Default model id for eval runs when none is supplied. */
export const DEFAULT_EVAL_MODEL_ID = "moonshotai.kimi-k2.5";
