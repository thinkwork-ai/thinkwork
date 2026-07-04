import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { print } from "graphql";

import { useAppSyncSubscription } from "@/hooks/useAppSyncSubscription";
import { useAuth } from "@/lib/auth-context";
import {
  OnAgentStatusChangedSubscription,
  OnHeartbeatActivitySubscription,
  OnInboxItemStatusChangedSubscription,
  OnThreadTurnUpdatedSubscription,
  OnThreadUpdatedSubscription,
} from "@/lib/graphql-queries";

type RefetchCallback = () => void;

type RefetchRegistration = {
  ids: Set<string>;
  callback: RefetchCallback;
};

type LiveStatusContextValue = {
  agentStatusChanged: any | null;
  heartbeatActivity: any | null;
  threadUpdated: any | null;
  threadTurnUpdated: any | null;
  inboxItemStatusChanged: any | null;
  registerThreadListRefetch: (
    ids: string[],
    callback: RefetchCallback,
  ) => () => void;
  registerInboxRefetch: (callback: RefetchCallback) => () => void;
};

const LiveStatusContext = createContext<LiveStatusContextValue | null>(null);

export const LIVE_STATUS_SUBSCRIPTION_QUERIES = {
  agentStatusChanged: print(OnAgentStatusChangedSubscription as any),
  heartbeatActivity: print(OnHeartbeatActivitySubscription as any),
  threadUpdated: print(OnThreadUpdatedSubscription as any),
  threadTurnUpdated: print(OnThreadTurnUpdatedSubscription as any),
  inboxItemStatusChanged: print(OnInboxItemStatusChangedSubscription as any),
};

export function shouldRefetchForEntity(
  registeredIds: Set<string>,
  entityId: string | null | undefined,
): boolean {
  if (!entityId) return false;
  return registeredIds.size === 0 || registeredIds.has(entityId);
}

export function LiveStatusProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user, getToken } = useAuth();
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState,
  );
  const [tokenRefreshVersion, setTokenRefreshVersion] = useState(0);
  const tenantId = user?.tenantId;
  const isForeground = Platform.OS === "web" || appState === "active";
  const enabled = Boolean(isAuthenticated && tenantId && isForeground);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", async (next) => {
      if (next === "active" && isAuthenticated) {
        await getToken();
        setTokenRefreshVersion((version) => version + 1);
      }
      setAppState(next);
    });
    return () => subscription.remove();
  }, [getToken, isAuthenticated]);

  return (
    <LiveStatusContextShell>
      {enabled ? (
        <LiveStatusSubscriptions
          key={tokenRefreshVersion}
          tenantId={tenantId!}
          tokenRefreshVersion={tokenRefreshVersion}
        >
          {children}
        </LiveStatusSubscriptions>
      ) : (
        children
      )}
    </LiveStatusContextShell>
  );
}

function LiveStatusContextShell({ children }: { children: ReactNode }) {
  const threadRegistrations = useRef(new Set<RefetchRegistration>());
  const inboxRegistrations = useRef(new Set<RefetchCallback>());
  const [events, setEvents] = useState({
    agentStatusChanged: null as any | null,
    heartbeatActivity: null as any | null,
    threadUpdated: null as any | null,
    threadTurnUpdated: null as any | null,
    inboxItemStatusChanged: null as any | null,
  });

  const registerThreadListRefetch = useCallback(
    (ids: string[], callback: RefetchCallback) => {
      const registration = { ids: new Set(ids), callback };
      threadRegistrations.current.add(registration);
      return () => {
        threadRegistrations.current.delete(registration);
      };
    },
    [],
  );

  const registerInboxRefetch = useCallback((callback: RefetchCallback) => {
    inboxRegistrations.current.add(callback);
    return () => {
      inboxRegistrations.current.delete(callback);
    };
  }, []);

  const contextValue = useMemo<LiveStatusContextValue>(
    () => ({
      ...events,
      registerThreadListRefetch,
      registerInboxRefetch,
    }),
    [events, registerThreadListRefetch, registerInboxRefetch],
  );

  return (
    <LiveStatusInternalContext.Provider
      value={{
        setEvents,
        threadRegistrations,
        inboxRegistrations,
      }}
    >
      <LiveStatusContext.Provider value={contextValue}>
        {children}
      </LiveStatusContext.Provider>
    </LiveStatusInternalContext.Provider>
  );
}

const LiveStatusInternalContext = createContext<{
  setEvents: Dispatch<
    SetStateAction<{
      agentStatusChanged: any | null;
      heartbeatActivity: any | null;
      threadUpdated: any | null;
      threadTurnUpdated: any | null;
      inboxItemStatusChanged: any | null;
    }>
  >;
  threadRegistrations: MutableRefObject<Set<RefetchRegistration>>;
  inboxRegistrations: MutableRefObject<Set<RefetchCallback>>;
} | null>(null);

function LiveStatusSubscriptions({
  tenantId,
  tokenRefreshVersion: _tokenRefreshVersion,
  children,
}: {
  tenantId: string;
  tokenRefreshVersion: number;
  children: ReactNode;
}) {
  const internal = useContext(LiveStatusInternalContext);
  if (!internal) return <>{children}</>;

  const agentStatus = useAppSyncSubscription<any>(
    LIVE_STATUS_SUBSCRIPTION_QUERIES.agentStatusChanged,
    { tenantId },
  );
  const heartbeatActivity = useAppSyncSubscription<any>(
    LIVE_STATUS_SUBSCRIPTION_QUERIES.heartbeatActivity,
    { tenantId },
  );
  const threadUpdated = useAppSyncSubscription<any>(
    LIVE_STATUS_SUBSCRIPTION_QUERIES.threadUpdated,
    { tenantId },
  );
  const threadTurnUpdated = useAppSyncSubscription<any>(
    LIVE_STATUS_SUBSCRIPTION_QUERIES.threadTurnUpdated,
    { tenantId },
  );
  const inboxItemStatus = useAppSyncSubscription<any>(
    LIVE_STATUS_SUBSCRIPTION_QUERIES.inboxItemStatusChanged,
    { tenantId },
  );

  useEffect(() => {
    const event = agentStatus.data?.onAgentStatusChanged;
    if (!event) return;
    internal.setEvents((current) => ({
      ...current,
      agentStatusChanged: event,
    }));
    notifyThreadRegistrations(internal.threadRegistrations.current, null);
  }, [agentStatus.data?.onAgentStatusChanged?.updatedAt]);

  useEffect(() => {
    const event = heartbeatActivity.data?.onHeartbeatActivity;
    if (!event) return;
    internal.setEvents((current) => ({ ...current, heartbeatActivity: event }));
    notifyThreadRegistrations(internal.threadRegistrations.current, null);
  }, [heartbeatActivity.data?.onHeartbeatActivity?.createdAt]);

  useEffect(() => {
    const event = threadUpdated.data?.onThreadUpdated;
    if (!event) return;
    internal.setEvents((current) => ({ ...current, threadUpdated: event }));
    notifyThreadRegistrations(
      internal.threadRegistrations.current,
      event.threadId,
    );
  }, [
    threadUpdated.data?.onThreadUpdated?.threadId,
    threadUpdated.data?.onThreadUpdated?.updatedAt,
  ]);

  useEffect(() => {
    const event = threadTurnUpdated.data?.onThreadTurnUpdated;
    if (!event) return;
    internal.setEvents((current) => ({ ...current, threadTurnUpdated: event }));
    notifyThreadRegistrations(
      internal.threadRegistrations.current,
      event.threadId,
    );
  }, [
    threadTurnUpdated.data?.onThreadTurnUpdated?.threadId,
    threadTurnUpdated.data?.onThreadTurnUpdated?.updatedAt,
  ]);

  useEffect(() => {
    const event = inboxItemStatus.data?.onInboxItemStatusChanged;
    if (!event) return;
    internal.setEvents((current) => ({
      ...current,
      inboxItemStatusChanged: event,
    }));
    for (const callback of internal.inboxRegistrations.current) callback();
  }, [
    inboxItemStatus.data?.onInboxItemStatusChanged?.inboxItemId,
    inboxItemStatus.data?.onInboxItemStatusChanged?.updatedAt,
  ]);

  return <>{children}</>;
}

function notifyThreadRegistrations(
  registrations: Set<RefetchRegistration>,
  threadId: string | null,
) {
  for (const registration of registrations) {
    if (threadId === null || shouldRefetchForEntity(registration.ids, threadId)) {
      registration.callback();
    }
  }
}

export function useLiveStatus() {
  const ctx = useContext(LiveStatusContext);
  if (!ctx) throw new Error("useLiveStatus must be used within provider");
  return ctx;
}
