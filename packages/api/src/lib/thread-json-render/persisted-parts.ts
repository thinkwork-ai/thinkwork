export {
  THREAD_JSON_RENDER_PART_TYPE,
  THREAD_JSON_RENDER_SCHEMA_VERSION,
  THREAD_JSON_RENDER_CATALOG_VERSION,
  createThreadJsonRenderSpecHash,
  stableStringify,
  type ThreadJsonRenderDurableActionDescriptor,
  type ThreadJsonRenderPart,
  type ThreadJsonRenderPrimitive,
} from "@thinkwork/thread-json-render";

import {
  validateThreadJsonRenderPart,
  type ThreadJsonRenderPart,
} from "@thinkwork/thread-json-render";

export function validateThreadJsonRenderPersistedPart(
  input: unknown,
):
  | { ok: true; part: ThreadJsonRenderPart }
  | { ok: false; diagnostics: string[] } {
  const result = validateThreadJsonRenderPart(input);
  if (result.ok) return result;
  return {
    ok: false,
    diagnostics: result.diagnostics.map(
      (diagnostic) => `${diagnostic.code}: ${diagnostic.message}`,
    ),
  };
}
