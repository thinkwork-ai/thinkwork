export const THREAD_JSON_RENDER_UI_CAPABILITY = "thread-json-render-ui";
export const EMIT_JSON_RENDER_UI_TOOL_NAME = "emit_json_render_ui";

/**
 * Generated-UI enablement from the agent's `json_render_ui` opt-in column
 * (THINK-291 — same jsonb shape as sandbox/web_search/send_email). Absent or
 * malformed config counts as enabled (the column defaults to
 * `{"enabled": true}`); `blocked_tools` vetoes under either the capability
 * name or the tool name. Replaces the legacy hidden `agent_capabilities`
 * 'thread-json-render-ui' row, which had no operator surface anywhere.
 */
export function threadJsonRenderUiEnabledFromAgentConfig(
  configValue: unknown,
  blockedTools: readonly string[],
): boolean {
  if (
    blockedTools.includes(THREAD_JSON_RENDER_UI_CAPABILITY) ||
    blockedTools.includes(EMIT_JSON_RENDER_UI_TOOL_NAME)
  ) {
    return false;
  }
  if (
    configValue &&
    typeof configValue === "object" &&
    !Array.isArray(configValue)
  ) {
    return (configValue as { enabled?: unknown }).enabled !== false;
  }
  return true;
}
