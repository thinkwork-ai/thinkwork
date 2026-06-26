export const THREAD_JSON_RENDER_UI_CAPABILITY = "thread-json-render-ui";
export const EMIT_JSON_RENDER_UI_TOOL_NAME = "emit_json_render_ui";

export interface AgentCapabilityRow {
  capability: string;
  enabled: boolean | null;
}

export function threadJsonRenderUiEnabledFromCapabilities(
  capabilityRows: readonly AgentCapabilityRow[],
  blockedTools: readonly string[],
): boolean {
  if (
    blockedTools.includes(THREAD_JSON_RENDER_UI_CAPABILITY) ||
    blockedTools.includes(EMIT_JSON_RENDER_UI_TOOL_NAME)
  ) {
    return false;
  }
  return capabilityRows.some(
    (row) =>
      row.capability === THREAD_JSON_RENDER_UI_CAPABILITY &&
      row.enabled === true,
  );
}
