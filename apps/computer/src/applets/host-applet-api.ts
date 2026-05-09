import { useCallback, useEffect, useRef, useState } from "react";
import { gql, useMutation, useQuery, type DocumentInput } from "urql";
import type { AppletAPI, AppletStateMeta } from "@thinkwork/computer-stdlib";
import { AppletQuery, AppletsQuery } from "@/lib/graphql-queries";

const APPLET_STATE_SAVE_DEBOUNCE_MS = 1_000;

const AppletStateQuery = gql`
  query AppletState($appId: ID!, $instanceId: ID!, $key: String!) {
    appletState(appId: $appId, instanceId: $instanceId, key: $key) {
      appId
      instanceId
      key
      value
      updatedAt
    }
  }
`;

const SaveAppletStateMutation = gql`
  mutation SaveAppletState($input: SaveAppletStateInput!) {
    saveAppletState(input: $input) {
      appId
      instanceId
      key
      value
      updatedAt
    }
  }
`;

const QUERY_CATALOG = {
  applet: AppletQuery,
  applets: AppletsQuery,
} satisfies Record<string, DocumentInput<unknown, Record<string, unknown>>>;

const MUTATION_CATALOG = {
  saveAppletState: SaveAppletStateMutation,
} satisfies Record<string, DocumentInput<unknown, Record<string, unknown>>>;

interface AppletStateResult<T> {
  appletState?: {
    value: T;
  } | null;
}

interface SaveAppletStateResult<T> {
  saveAppletState?: {
    value: T;
  } | null;
}

export function createHostAppletAPI(appId: string, instanceId: string): AppletAPI {
  return {
    useAppletState<T>(key: string, initialValue: T) {
      return useHostAppletState(appId, instanceId, key, initialValue);
    },
    useAppletQuery<T>(name: string, variables?: Record<string, unknown>) {
      return useHostAppletQuery<T>(name, variables);
    },
    useAppletMutation<T>(name: string) {
      return useHostAppletMutation<T>(name);
    },
    async refresh() {
      throw new Error(
        "INERT_NOT_WIRED: applet refresh is registered but U10 will activate it",
      );
    },
  };
}

function useHostAppletState<T>(
  appId: string,
  instanceId: string,
  key: string,
  initialValue: T,
): [T, (nextValue: T) => void, AppletStateMeta] {
  const [{ data }] = useQuery<AppletStateResult<T>>({
    query: AppletStateQuery,
    variables: { appId, instanceId, key },
    requestPolicy: "cache-and-network",
  });
  const [, saveAppletState] =
    useMutation<SaveAppletStateResult<T>>(SaveAppletStateMutation);
  const [value, setValue] = useState<T>(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const latestValue = useRef(value);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (data?.appletState) {
      latestValue.current = data.appletState.value;
      setValue(data.appletState.value);
    }
  }, [data]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const setAppletValue = useCallback(
    (nextValue: T) => {
      latestValue.current = nextValue;
      setValue(nextValue);
      setSaving(true);
      setError(undefined);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveAppletState({
          input: {
            appId,
            instanceId,
            key,
            value: latestValue.current,
          },
        }).then((result) => {
          if (result.error) {
            setSaving(false);
            setError(result.error);
            return;
          }
          if (result.data?.saveAppletState) {
            latestValue.current = result.data.saveAppletState.value;
            setValue(result.data.saveAppletState.value);
          }
          setSaving(false);
        });
      }, APPLET_STATE_SAVE_DEBOUNCE_MS);
    },
    [appId, instanceId, key, saveAppletState],
  );

  return [value, setAppletValue, { saving, error }];
}

function useHostAppletQuery<T>(
  name: string,
  variables?: Record<string, unknown>,
): T {
  const query = QUERY_CATALOG[name as keyof typeof QUERY_CATALOG];
  if (!query) throw unknownAppletQuery(name);
  const [{ data, error }] = useQuery<T>({ query, variables });
  if (error) throw error;
  return data as T;
}

function useHostAppletMutation<T>(name: string) {
  const mutation = MUTATION_CATALOG[name as keyof typeof MUTATION_CATALOG];
  if (!mutation) throw unknownAppletMutation(name);
  const [, executeMutation] = useMutation<T>(mutation);
  return async (variables: Record<string, unknown>) => {
    const result = await executeMutation(variables);
    if (result.error) throw result.error;
    return result.data as T;
  };
}

function unknownAppletQuery(name: string) {
  return new Error(`Unknown applet query "${name}"`);
}

function unknownAppletMutation(name: string) {
  return new Error(`Unknown applet mutation "${name}"`);
}
