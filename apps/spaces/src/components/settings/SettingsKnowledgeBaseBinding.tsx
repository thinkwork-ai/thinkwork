import { useCallback, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Switch } from "@thinkwork/ui";
import {
  KnowledgeBaseBindingsQuery,
  SetAgentKnowledgeBasesMutation,
  SetSpaceKnowledgeBasesMutation,
} from "@/lib/kb-queries";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

type Binding = { knowledgeBaseId: string };

/**
 * KB binding home (U11/KTD11). A KB is bound **tenant-wide** (the platform
 * agent — every Space's threads) or **per-Space** (only that Space's threads).
 * The set* mutations replace the whole binding set for an agent/Space, so each
 * toggle reads the current set and writes it back with this KB added/removed.
 */
export function SettingsKnowledgeBaseBinding({
  kbId,
  tenantId,
}: {
  kbId: string;
  tenantId: string;
}) {
  const [result, refetch] = useQuery({
    query: KnowledgeBaseBindingsQuery,
    variables: { tenantId },
    requestPolicy: "cache-and-network",
  });
  const [, setAgentKbs] = useMutation(SetAgentKnowledgeBasesMutation);
  const [, setSpaceKbs] = useMutation(SetSpaceKnowledgeBasesMutation);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const agent = result.data?.tenantAgent ?? null;
  const spaces = result.data?.spaces ?? [];

  const reload = useCallback(
    () => refetch({ requestPolicy: "network-only" }),
    [refetch],
  );

  // Toggle this KB inside a binding set, then write the whole set back.
  const nextSet = (
    current: Binding[],
    on: boolean,
  ): { knowledgeBaseId: string }[] => {
    const ids = new Set(current.map((b) => b.knowledgeBaseId));
    if (on) ids.add(kbId);
    else ids.delete(kbId);
    return [...ids].map((id) => ({ knowledgeBaseId: id }));
  };

  const toggleTenantWide = useCallback(
    async (on: boolean) => {
      if (!agent) return;
      setBusy("tenant");
      setError(null);
      try {
        const res = await setAgentKbs({
          agentId: agent.id,
          knowledgeBases: nextSet(agent.knowledgeBases, on),
        });
        if (res.error) setError(res.error.message);
        else reload();
      } finally {
        setBusy(null);
      }
    },
    [agent, setAgentKbs, reload, kbId],
  );

  const toggleSpace = useCallback(
    async (space: { id: string; knowledgeBases: Binding[] }, on: boolean) => {
      setBusy(space.id);
      setError(null);
      try {
        const res = await setSpaceKbs({
          input: {
            tenantId,
            spaceId: space.id,
            knowledgeBases: nextSet(space.knowledgeBases, on),
          },
        });
        if (res.error) setError(res.error.message);
        else reload();
      } finally {
        setBusy(null);
      }
    },
    [setSpaceKbs, tenantId, reload, kbId],
  );

  const tenantWide =
    agent?.knowledgeBases.some((b) => b.knowledgeBaseId === kbId) ?? false;

  return (
    <SettingsSection label="Binding">
      {error ? (
        <div className="px-4 py-3 text-sm text-destructive">{error}</div>
      ) : null}

      <SettingsRow
        label="Tenant-wide"
        description="Every Space's threads can retrieve this knowledge base."
      >
        <Switch
          checked={tenantWide}
          disabled={!agent || busy !== null}
          onCheckedChange={toggleTenantWide}
        />
      </SettingsRow>

      {result.fetching && !result.data ? (
        <div className="px-4 py-3 text-sm text-muted-foreground">Loading…</div>
      ) : spaces.length === 0 ? (
        <div className="px-4 py-3 text-sm text-muted-foreground">
          No Spaces yet — create a Space to bind this knowledge base to it.
        </div>
      ) : (
        spaces.map((space) => (
          <SettingsRow
            key={space.id}
            label={space.name}
            description="Only this Space's threads retrieve it."
          >
            <Switch
              checked={space.knowledgeBases.some(
                (b) => b.knowledgeBaseId === kbId,
              )}
              disabled={busy !== null}
              onCheckedChange={(on) => toggleSpace(space, on)}
            />
          </SettingsRow>
        ))
      )}
    </SettingsSection>
  );
}
