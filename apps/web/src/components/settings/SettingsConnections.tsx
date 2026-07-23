import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@thinkwork/ui";
import { useAuth } from "@/context/AuthContext";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsMySlackLinksQuery,
  SettingsUnlinkSlackIdentityMutation,
} from "@/lib/settings-queries";
import {
  buildConnectAuthorizeUrl,
  disconnectConnection,
  listConnections,
  type ConnectionRow,
} from "@/lib/connections-api";

/**
 * Connections tab — the per-user integrations surface (web counterpart of
 * mobile's Credential Locker "Connected Accounts" section). One row per OAuth
 * provider from the connect_providers registry, plus the caller's Slack
 * identity links. Connect/Reconnect drive the same `/api/oauth/authorize`
 * flow mobile uses; the callback deep-links back to this page with
 * `?status=connected&provider=…` appended.
 */

// The first-party provider registry mobile renders. Providers the backend
// knows about but that aren't listed here still render (from the caller's
// connection rows) — this list only guarantees the "not connected yet" rows.
const OAUTH_PROVIDERS = [
  {
    name: "google_productivity",
    displayName: "Google Workspace",
    subtitle: "Gmail + Google Calendar",
  },
  {
    name: "microsoft_365",
    displayName: "Microsoft 365",
    subtitle: "Outlook + Calendar",
  },
] as const;

type ConnectionStatus = "active" | "expired" | "pending" | "none";

type SlackLink = {
  id: string;
  slackTeamId: string;
  slackTeamName?: string | null;
  slackUserId: string;
  slackUserName?: string | null;
  slackUserEmail?: string | null;
  status: string;
  linkedAt: string;
};

/**
 * Pick the row that best represents a provider's state: active beats
 * expired beats pending (authorize inserts a pending row per attempt, so
 * stale pendings must not mask a live connection).
 */
export function bestConnectionForProvider(
  rows: ConnectionRow[],
  providerName: string,
): ConnectionRow | null {
  const candidates = rows.filter((row) => row.provider_name === providerName);
  const rank = (status: string) =>
    status === "active"
      ? 3
      : status === "expired"
        ? 2
        : status === "pending"
          ? 1
          : 0;
  let best: ConnectionRow | null = null;
  for (const row of candidates) {
    if (rank(row.status) === 0) continue;
    if (!best || rank(row.status) > rank(best.status)) best = row;
  }
  return best;
}

function statusOf(conn: ConnectionRow | null): ConnectionStatus {
  if (!conn) return "none";
  if (conn.status === "active") return "active";
  if (conn.status === "expired") return "expired";
  if (conn.status === "pending") return "pending";
  return "none";
}

function grantedScopes(conn: ConnectionRow | null): string[] {
  const raw = conn?.metadata?.["requested_scopes"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string" && s.length > 0);
}

/** Current URL minus the OAuth round-trip params — used as the returnUrl. */
function connectionsReturnUrl(): string {
  if (typeof window === "undefined") return "/";
  const url = new URL(window.location.href);
  url.searchParams.delete("status");
  url.searchParams.delete("provider");
  url.searchParams.delete("reason");
  return url.toString();
}

function StatusPill({ status }: { status: ConnectionStatus }) {
  if (status === "active") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/40 text-emerald-400"
      >
        active
      </Badge>
    );
  }
  if (status === "expired") {
    return (
      <Badge variant="outline" className="border-yellow-500/40 text-yellow-500">
        expired
      </Badge>
    );
  }
  if (status === "pending") {
    return <Badge variant="secondary">pending</Badge>;
  }
  return <Badge variant="outline">not connected</Badge>;
}

export function SettingsConnections() {
  const { user } = useAuth();
  const { tenantId, userId } = useTenant();
  const principalId = userId ?? user?.sub ?? null;

  const [connections, setConnections] = useState<ConnectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<{
    kind: "connection" | "slack";
    id: string;
    label: string;
  } | null>(null);

  const [slackLinksResult, refetchSlackLinks] = useQuery({
    query: SettingsMySlackLinksQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [, unlinkSlackIdentity] = useMutation(
    SettingsUnlinkSlackIdentityMutation,
  );

  const load = useCallback(() => {
    if (!tenantId || !principalId) return;
    setError(null);
    listConnections(tenantId, principalId)
      .then(setConnections)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load connections"),
      );
  }, [principalId, tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  // OAuth deep-link return: the callback lands back here with
  // `?status=connected&provider=…` (or `status=error&reason=…`). Surface the
  // outcome once, then strip the params so refresh/bookmark stays clean.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    if (!status) return;
    const provider = params.get("provider");
    const providerLabel =
      OAUTH_PROVIDERS.find((p) => p.name === provider)?.displayName ??
      provider ??
      "Provider";
    if (status === "connected") {
      setNotice(`${providerLabel} connected.`);
    } else if (status === "error") {
      setError(
        `Connection failed${params.get("reason") ? `: ${params.get("reason")}` : "."}`,
      );
    }
    window.history.replaceState({}, "", connectionsReturnUrl());
  }, []);

  // Refetch when the tab regains focus — covers OAuth flows finished in
  // another tab/window and long-lived pages in general.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const startOAuth = useCallback(
    (provider: string) => {
      if (!tenantId || !principalId) return;
      setNotice("Opening authorization…");
      window.location.assign(
        buildConnectAuthorizeUrl({
          provider,
          userId: principalId,
          tenantId,
          returnUrl: connectionsReturnUrl(),
        }),
      );
    },
    [principalId, tenantId],
  );

  async function onConfirmDisconnect() {
    if (!confirm || !tenantId) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      if (confirm.kind === "connection") {
        await disconnectConnection(tenantId, confirm.id);
        load();
      } else {
        const result = await unlinkSlackIdentity({ id: confirm.id });
        if (result.error) throw result.error;
        refetchSlackLinks({ requestPolicy: "network-only" });
      }
      setNotice(`${confirm.label} disconnected.`);
      setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setPending(false);
    }
  }

  const rows = connections ?? [];
  const slackLinks: SlackLink[] = slackLinksResult.data?.mySlackLinks ?? [];

  // Providers beyond the static registry that the caller has live rows for
  // (the connect_providers registry is server-side; the join gives us the
  // display name).
  const extraProviders = useMemo(() => {
    const known = new Set<string>([
      ...OAUTH_PROVIDERS.map((p) => p.name),
      "slack",
    ]);
    const seen = new Map<string, ConnectionRow>();
    for (const row of rows) {
      if (known.has(row.provider_name) || seen.has(row.provider_name)) continue;
      if (
        row.status === "active" ||
        row.status === "expired" ||
        row.status === "pending"
      ) {
        seen.set(row.provider_name, row);
      }
    }
    return [...seen.keys()];
  }, [rows]);

  const loading = connections === null && !error && !!tenantId && !!principalId;

  return (
    <div className="space-y-6">
      {notice ? <p className="text-sm text-emerald-500">{notice}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading connections…</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {[
            ...OAUTH_PROVIDERS.map((provider) => ({
              key: provider.name,
              name: provider.name,
              displayName: provider.displayName,
              subtitle: provider.subtitle,
            })),
            ...extraProviders.map((name) => {
              const conn = bestConnectionForProvider(rows, name);
              return {
                key: name,
                name,
                displayName: conn?.provider_display_name ?? name,
                subtitle: conn?.provider_type ?? "",
              };
            }),
          ].map((provider) => {
            const conn = bestConnectionForProvider(rows, provider.name);
            const status = statusOf(conn);
            const scopes = grantedScopes(conn);
            return (
              <li
                key={provider.key}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{provider.displayName}</span>
                    <StatusPill status={status} />
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {conn?.external_id || provider.subtitle}
                  </p>
                  {scopes.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {scopes.map((scope) => (
                        <Badge
                          key={scope}
                          variant="secondary"
                          className="font-mono text-[10px]"
                        >
                          {scope}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {status === "active" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending || !conn}
                      onClick={() =>
                        conn &&
                        setConfirm({
                          kind: "connection",
                          id: conn.id,
                          label: provider.displayName,
                        })
                      }
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant={status === "expired" ? "default" : "outline"}
                      disabled={pending || !tenantId || !principalId}
                      onClick={() => startOAuth(provider.name)}
                    >
                      {status === "expired" ? "Reconnect" : "Connect"}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
          <SlackRow
            links={slackLinks}
            fetching={slackLinksResult.fetching && !slackLinksResult.data}
            pending={pending}
            onConnect={() => startOAuth("slack")}
            onDisconnect={(link) =>
              setConfirm({
                kind: "slack",
                id: link.id,
                label: link.slackTeamName || "Slack",
              })
            }
          />
        </ul>
      )}

      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {confirm?.label}?</DialogTitle>
            <DialogDescription>
              {confirm?.kind === "slack"
                ? "Your Computer will no longer respond as you in that Slack workspace."
                : "Your agent will no longer be able to access this account. Stored credentials are deleted."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={onConfirmDisconnect}
            >
              {pending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SlackRow({
  links,
  fetching,
  pending,
  onConnect,
  onDisconnect,
}: {
  links: SlackLink[];
  fetching: boolean;
  pending: boolean;
  onConnect: () => void;
  onDisconnect: (link: SlackLink) => void;
}) {
  const primary = links[0];
  const subtitle = primary
    ? [
        primary.slackTeamName || primary.slackTeamId,
        primary.slackUserEmail || primary.slackUserName,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Invoke your Computer from Slack";

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">Slack</span>
          <StatusPill status={primary ? "active" : "none"} />
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {fetching ? "Loading…" : subtitle}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {primary ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => onDisconnect(primary)}
          >
            Disconnect
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || fetching}
            onClick={onConnect}
          >
            Connect
          </Button>
        )}
      </div>
    </li>
  );
}
