import type {
  DeepLinkCallback,
  ReportInstallOutcomeRequest,
  SessionTokens,
  UpdateState,
} from "./schemas.js";

export type Unsubscribe = () => void;

export interface ThinkworkBridge {
  getSessionTokens(): Promise<SessionTokens | null>;
  startOAuth(): Promise<void>;
  signOut(): Promise<void>;
  consumePendingOAuth(): Promise<DeepLinkCallback | null>;
  onDeepLink(listener: (callback: DeepLinkCallback) => void): Unsubscribe;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateState(listener: (state: UpdateState) => void): Unsubscribe;
  reportInstallOutcome(outcome: ReportInstallOutcomeRequest): Promise<void>;
}
