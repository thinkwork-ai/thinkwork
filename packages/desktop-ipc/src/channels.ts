export const GET_SESSION_TOKENS_CHANNEL = "desktop:get-session-tokens";
export const START_OAUTH_CHANNEL = "desktop:start-oauth";
export const SIGN_OUT_CHANNEL = "desktop:sign-out";
export const CONSUME_PENDING_OAUTH_CHANNEL = "desktop:consume-pending-oauth";
export const DEEP_LINK_EVENT_CHANNEL = "desktop:deep-link";
export const GET_UPDATE_STATE_CHANNEL = "desktop:get-update-state";
export const CHECK_FOR_UPDATES_CHANNEL = "desktop:check-for-updates";
export const DOWNLOAD_UPDATE_CHANNEL = "desktop:download-update";
export const INSTALL_UPDATE_CHANNEL = "desktop:install-update";
export const UPDATE_STATE_EVENT_CHANNEL = "desktop:update-state";
export const REPORT_INSTALL_OUTCOME_CHANNEL = "desktop:report-install-outcome";

export const IPC_CHANNELS = {
  GET_SESSION_TOKENS: GET_SESSION_TOKENS_CHANNEL,
  START_OAUTH: START_OAUTH_CHANNEL,
  SIGN_OUT: SIGN_OUT_CHANNEL,
  CONSUME_PENDING_OAUTH: CONSUME_PENDING_OAUTH_CHANNEL,
  DEEP_LINK_EVENT: DEEP_LINK_EVENT_CHANNEL,
  GET_UPDATE_STATE: GET_UPDATE_STATE_CHANNEL,
  CHECK_FOR_UPDATES: CHECK_FOR_UPDATES_CHANNEL,
  DOWNLOAD_UPDATE: DOWNLOAD_UPDATE_CHANNEL,
  INSTALL_UPDATE: INSTALL_UPDATE_CHANNEL,
  UPDATE_STATE_EVENT: UPDATE_STATE_EVENT_CHANNEL,
  REPORT_INSTALL_OUTCOME: REPORT_INSTALL_OUTCOME_CHANNEL,
} as const;
