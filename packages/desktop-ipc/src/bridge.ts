import type {
  DeepLinkCallback,
  DesktopConfig,
  PendingOAuthCallback,
  OAuthErrorEvent,
  PiCancelTurnRequest,
  PiCancelTurnResponse,
  PiCancelEvalRunRequest,
  PiCancelEvalRunResponse,
  PiDiagnosticEvent,
  PiPrewarmWorkspaceRequest,
  PiPrewarmWorkspaceResponse,
  PiSidecarState,
  PiSidecarStatus,
  PiStartEvalRunRequest,
  PiStartEvalRunResponse,
  PiStartTurnRequest,
  PiStartTurnResponse,
  ReadWorkspaceFileRequest,
  ReadWorkspaceFileResponse,
  ReadWorkspaceTreeResponse,
  RemoveTokenStorageItemRequest,
  ReportInstallOutcomeRequest,
  RaiseThreadNotificationRequest,
  OpenThreadEvent,
  WindowFocusEvent,
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
  prewarmWorkspace(
    request: PiPrewarmWorkspaceRequest,
  ): Promise<PiPrewarmWorkspaceResponse>;
  startTurn(request: PiStartTurnRequest): Promise<PiStartTurnResponse>;
  cancelTurn(request: PiCancelTurnRequest): Promise<PiCancelTurnResponse>;
  startEvalRun(request: PiStartEvalRunRequest): Promise<PiStartEvalRunResponse>;
  cancelEvalRun(
    request: PiCancelEvalRunRequest,
  ): Promise<PiCancelEvalRunResponse>;
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
  /** Raise a native OS notification for a thread (renderer → main). */
  raiseThreadNotification(
    request: RaiseThreadNotificationRequest,
  ): Promise<void>;
  /** Subscribe to notification-click open-thread events (main → renderer). */
  onOpenThread(listener: (event: OpenThreadEvent) => void): Unsubscribe;
  /** Subscribe to app window focus/blur transitions (main → renderer). */
  onWindowFocusChange(listener: (event: WindowFocusEvent) => void): Unsubscribe;
  /** Read the local Pi workspace cache as a tree (read-only inspector). */
  readWorkspaceTree(): Promise<ReadWorkspaceTreeResponse>;
  /** Read one file from the local Pi workspace cache (read-only inspector). */
  readWorkspaceFile(
    request: ReadWorkspaceFileRequest,
  ): Promise<ReadWorkspaceFileResponse>;
  /** Sync the native window appearance to the app theme (renderer → main) so
   *  macOS vibrancy materials render light/dark to match. */
  setNativeTheme(theme: "light" | "dark"): void;
  pi?: PiBridge;
}
