export type AppletSourceStatus = "success" | "partial" | "failed";

export interface AppletRefreshResult<T = unknown> {
  data: T;
  sourceStatuses: Record<string, AppletSourceStatus>;
  errors?: Array<{ message: string; sourceId?: string }>;
}

export interface AppletStateMeta {
  saving: boolean;
  error?: Error;
}

export interface AppletAPI {
  useAppletState<T>(
    key: string,
    initialValue: T,
  ): [T, (nextValue: T) => void, AppletStateMeta];
  useAppletQuery<T>(
    name: string,
    variables?: Record<string, unknown>,
  ): T;
  useAppletMutation<T>(
    name: string,
  ): (variables: Record<string, unknown>) => Promise<T>;
  refresh<T = unknown>(): Promise<AppletRefreshResult<T>>;
}

export interface ThinkworkAppletHost {
  useAppletAPI?: (appId: string, instanceId: string) => AppletAPI;
}

declare global {
  // eslint-disable-next-line no-var
  var __THINKWORK_APPLET_HOST__: ThinkworkAppletHost | undefined;
}

export function useAppletAPI(appId: string, instanceId: string): AppletAPI {
  const host = globalThis.__THINKWORK_APPLET_HOST__;
  if (!host?.useAppletAPI) {
    throw new Error(
      "INERT_NOT_WIRED: globalThis.__THINKWORK_APPLET_HOST__.useAppletAPI is not registered",
    );
  }
  return host.useAppletAPI(appId, instanceId);
}
