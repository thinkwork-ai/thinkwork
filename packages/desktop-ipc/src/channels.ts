export const GET_SESSION_TOKENS_CHANNEL = "desktop:get-session-tokens";
export const SET_TOKEN_STORAGE_ITEM_CHANNEL = "desktop:set-token-storage-item";
export const REMOVE_TOKEN_STORAGE_ITEM_CHANNEL =
  "desktop:remove-token-storage-item";
export const CLEAR_TOKEN_STORAGE_CHANNEL = "desktop:clear-token-storage";
export const TOKENS_CHANGED_EVENT_CHANNEL = "desktop:tokens-changed";
export const START_OAUTH_CHANNEL = "desktop:start-oauth";
export const SIGN_OUT_CHANNEL = "desktop:sign-out";
export const SIGNED_OUT_EVENT_CHANNEL = "desktop:signed-out";
export const CONSUME_PENDING_OAUTH_CHANNEL = "desktop:consume-pending-oauth";
export const DEEP_LINK_EVENT_CHANNEL = "desktop:deep-link";
export const OAUTH_ERROR_EVENT_CHANNEL = "desktop:oauth-error";
export const GET_DESKTOP_CONFIG_CHANNEL = "desktop:get-config";
export const GET_UPDATE_STATE_CHANNEL = "desktop:get-update-state";
export const CHECK_FOR_UPDATES_CHANNEL = "desktop:check-for-updates";
export const DOWNLOAD_UPDATE_CHANNEL = "desktop:download-update";
export const INSTALL_UPDATE_CHANNEL = "desktop:install-update";
export const UPDATE_STATE_EVENT_CHANNEL = "desktop:update-state";
export const UPDATE_TELEMETRY_EVENT_CHANNEL = "desktop:update-telemetry";
export const REPORT_INSTALL_OUTCOME_CHANNEL = "desktop:report-install-outcome";
export const GET_PI_STATUS_CHANNEL = "desktop:pi:get-status";
export const PREWARM_PI_WORKSPACE_CHANNEL = "desktop:pi:prewarm-workspace";
export const START_PI_TURN_CHANNEL = "desktop:pi:start-turn";
export const CANCEL_PI_TURN_CHANNEL = "desktop:pi:cancel-turn";
export const PI_STATUS_EVENT_CHANNEL = "desktop:pi:status";
export const PI_DIAGNOSTIC_EVENT_CHANNEL = "desktop:pi:diagnostic";
// Renderer → main (invoke): raise a native thread notification.
export const RAISE_THREAD_NOTIFICATION_CHANNEL = "desktop:notification:raise";
// Main → renderer (send): a notification was clicked — open this thread.
export const OPEN_THREAD_EVENT_CHANNEL = "desktop:open-thread";
// Main → renderer (send): app window focus/blur transitions.
export const WINDOW_FOCUS_EVENT_CHANNEL = "desktop:window-focus";
// Renderer → main (invoke): read the local Pi workspace cache as a tree.
export const READ_WORKSPACE_TREE_CHANNEL = "desktop:workspace:read-tree";
// Renderer → main (invoke): read one file from the local Pi workspace cache.
export const READ_WORKSPACE_FILE_CHANNEL = "desktop:workspace:read-file";
// Renderer → main (send): sync the native window appearance to the app theme
// so macOS vibrancy materials render light/dark to match.
export const SET_NATIVE_THEME_CHANNEL = "desktop:set-native-theme";

export const IPC_CHANNELS = {
  GET_SESSION_TOKENS: GET_SESSION_TOKENS_CHANNEL,
  SET_TOKEN_STORAGE_ITEM: SET_TOKEN_STORAGE_ITEM_CHANNEL,
  REMOVE_TOKEN_STORAGE_ITEM: REMOVE_TOKEN_STORAGE_ITEM_CHANNEL,
  CLEAR_TOKEN_STORAGE: CLEAR_TOKEN_STORAGE_CHANNEL,
  TOKENS_CHANGED_EVENT: TOKENS_CHANGED_EVENT_CHANNEL,
  START_OAUTH: START_OAUTH_CHANNEL,
  SIGN_OUT: SIGN_OUT_CHANNEL,
  SIGNED_OUT_EVENT: SIGNED_OUT_EVENT_CHANNEL,
  CONSUME_PENDING_OAUTH: CONSUME_PENDING_OAUTH_CHANNEL,
  DEEP_LINK_EVENT: DEEP_LINK_EVENT_CHANNEL,
  OAUTH_ERROR_EVENT: OAUTH_ERROR_EVENT_CHANNEL,
  GET_DESKTOP_CONFIG: GET_DESKTOP_CONFIG_CHANNEL,
  GET_UPDATE_STATE: GET_UPDATE_STATE_CHANNEL,
  CHECK_FOR_UPDATES: CHECK_FOR_UPDATES_CHANNEL,
  DOWNLOAD_UPDATE: DOWNLOAD_UPDATE_CHANNEL,
  INSTALL_UPDATE: INSTALL_UPDATE_CHANNEL,
  UPDATE_STATE_EVENT: UPDATE_STATE_EVENT_CHANNEL,
  UPDATE_TELEMETRY_EVENT: UPDATE_TELEMETRY_EVENT_CHANNEL,
  REPORT_INSTALL_OUTCOME: REPORT_INSTALL_OUTCOME_CHANNEL,
  GET_PI_STATUS: GET_PI_STATUS_CHANNEL,
  PREWARM_PI_WORKSPACE: PREWARM_PI_WORKSPACE_CHANNEL,
  START_PI_TURN: START_PI_TURN_CHANNEL,
  CANCEL_PI_TURN: CANCEL_PI_TURN_CHANNEL,
  PI_STATUS_EVENT: PI_STATUS_EVENT_CHANNEL,
  PI_DIAGNOSTIC_EVENT: PI_DIAGNOSTIC_EVENT_CHANNEL,
  RAISE_THREAD_NOTIFICATION: RAISE_THREAD_NOTIFICATION_CHANNEL,
  OPEN_THREAD_EVENT: OPEN_THREAD_EVENT_CHANNEL,
  WINDOW_FOCUS_EVENT: WINDOW_FOCUS_EVENT_CHANNEL,
  READ_WORKSPACE_TREE: READ_WORKSPACE_TREE_CHANNEL,
  READ_WORKSPACE_FILE: READ_WORKSPACE_FILE_CHANNEL,
} as const;
