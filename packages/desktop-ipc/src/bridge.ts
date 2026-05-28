import type {
  DeepLinkCallback,
  DesktopConfig,
  PendingOAuthCallback,
  OAuthErrorEvent,
  PiCancelTurnRequest,
  PiCancelTurnResponse,
  PiDiagnosticEvent,
  PiSidecarState,
  PiSidecarStatus,
  PiStartTurnRequest,
  PiStartTurnResponse,
  RemoveTokenStorageItemRequest,
  ReportInstallOutcomeRequest,
  SessionTokens,
  SetTokenStorageItemRequest,
  SignOutResponse,
  StartOAuthRequest,
  StartOAuthResponse,
  UpdateState,
  UpdateTelemetryEvent,
} from "./schemas.js";

export type Unsubscribe = () => void;

export interface PiBridge {
  status: PiSidecarStatus;
  getStatus(): Promise<PiSidecarState>;
  startTurn(request: PiStartTurnRequest): Promise<PiStartTurnResponse>;
  cancelTurn(request: PiCancelTurnRequest): Promise<PiCancelTurnResponse>;
  onStatusChanged(listener: (state: PiSidecarState) => void): Unsubscribe;
  onDiagnostic?(listener: (event: PiDiagnosticEvent) => void): Unsubscribe;
}

export interface ThinkworkBridge {
  getSessionTokens(): Promise<SessionTokens | null>;
  setTokenStorageItem(request: SetTokenStorageItemRequest): Promise<void>;
  removeTokenStorageItem(request: RemoveTokenStorageItemRequest): Promise<void>;
  clearTokenStorage(): Promise<void>;
  onTokensChanged(listener: (tokens: SessionTokens) => void): Unsubscribe;
  startOAuth(request?: StartOAuthRequest): Promise<StartOAuthResponse>;
  signOut(): Promise<SignOutResponse>;
  onSignedOut(listener: (result: SignOutResponse) => void): Unsubscribe;
  consumePendingOAuth(): Promise<PendingOAuthCallback | null>;
  onDeepLink(listener: (callback: DeepLinkCallback) => void): Unsubscribe;
  onOAuthError(listener: (event: OAuthErrorEvent) => void): Unsubscribe;
  getDesktopConfig(): Promise<DesktopConfig>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateState(listener: (state: UpdateState) => void): Unsubscribe;
  onUpdateTelemetry(
    listener: (event: UpdateTelemetryEvent) => void,
  ): Unsubscribe;
  reportInstallOutcome(outcome: ReportInstallOutcomeRequest): Promise<void>;
  pi?: PiBridge;
}
