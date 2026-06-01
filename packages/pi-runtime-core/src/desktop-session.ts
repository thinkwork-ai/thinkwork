export const PI_APPLICATION_SDK_PACKAGE =
  "@earendil-works/pi-coding-agent" as const;
export const PI_APPLICATION_SDK_MIN_VERSION = "0.76.0" as const;
export const PI_APPLICATION_SDK_DOCS_URL =
  "https://pi.dev/docs/latest/sdk" as const;

export interface PiSdkEmbeddingContract {
  packageName: typeof PI_APPLICATION_SDK_PACKAGE;
  minimumVersion: typeof PI_APPLICATION_SDK_MIN_VERSION;
  docsUrl: typeof PI_APPLICATION_SDK_DOCS_URL;
  sessionFactory: "createAgentSession";
  runtimeFactory: "createAgentSessionRuntime";
  sessionManager: "in-memory";
  authStorage: "runtime-overrides";
  resourceLoader: "thinkwork-rendered-workspace";
  modelSource: "prepared-invocation";
  toolSource: "thinkwork-prepared-policy";
}

export const DESKTOP_PI_SDK_EMBEDDING_CONTRACT: PiSdkEmbeddingContract = {
  packageName: PI_APPLICATION_SDK_PACKAGE,
  minimumVersion: PI_APPLICATION_SDK_MIN_VERSION,
  docsUrl: PI_APPLICATION_SDK_DOCS_URL,
  sessionFactory: "createAgentSession",
  runtimeFactory: "createAgentSessionRuntime",
  sessionManager: "in-memory",
  authStorage: "runtime-overrides",
  resourceLoader: "thinkwork-rendered-workspace",
  modelSource: "prepared-invocation",
  toolSource: "thinkwork-prepared-policy",
};

export interface PiRuntimeHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface DesktopPiRuntimeInvocation extends Record<string, unknown> {
  pi_sdk: PiSdkEmbeddingContract;
  tenant_id: string;
  workspace_tenant_id: string;
  assistant_id: string;
  thread_id: string;
  user_id: string;
  current_user_email: string;
  trace_id: string;
  message: string;
  messages_history: PiRuntimeHistoryMessage[];
  runtime_type: string;
  runtime_host: "desktop-local";
  model: string | null;
  trigger_channel: "desktop";
  finalize_callback_secret: string;
  thread_turn_id: string;
  use_memory?: boolean;
  tenant_slug?: string;
  instance_id?: string;
  agent_name?: string | null;
  system_prompt?: string;
  human_name?: string;
  workspace_bucket?: string;
  rendered_workspace_prefix?: string;
  thinkwork_api_url?: string;
  hindsight_endpoint?: string;
  finalize_callback_url?: string;
  message_attachments?: DesktopRuntimeMessageAttachment[];
}

export interface DesktopRuntimeMessageAttachment {
  attachment_id: string;
  s3_key: string;
  /** Short-lived presigned GET URL the credential-less runtime fetches. */
  download_url: string;
  name: string;
  mime_type: string;
  size_bytes: number;
}

export interface PreparedDesktopPiRuntimeSession<SidecarCredentials = unknown> {
  threadTurnId: string;
  expiresAt: string;
  finalizeCallbackUrl: string | null;
  finalizeCallbackSecret: string;
  sidecarCredentials: SidecarCredentials;
  invocation: DesktopPiRuntimeInvocation;
}
