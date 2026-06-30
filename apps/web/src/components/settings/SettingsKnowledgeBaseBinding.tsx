import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Button, Checkbox, Input, Switch } from "@thinkwork/ui";
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
type Space = { id: string; name: string; knowledgeBases: Binding[] };

// Show the search filter once the list is long enough to be unwieldy.
const FILTER_THRESHOLD = 8;

/**
 * Source binding home (U11/KTD11). A source is bound **tenant-wide** (the platform
 * agent — every Space's threads) or **per-Space** (only that Space's threads).
 * The set* mutations replace the whole binding set for an agent/Space, so each
 * toggle reads the current set and writes it back with this source added/removed.
 *
 * Spaces are a **multi-select** checkbox list: an operator can bind/unbind this
 * source across many Spaces in one sitting, with a search filter and select-all/
 * clear affordances that scale to a tenant with many Spaces.
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
  const [filter, setFilter] = useState("");

  const agent = result.data?.tenantAgent ?? null;
  const spaces: Space[] = useMemo(
    () => result.data?.spaces ?? [],
    [result.data],
  );

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
    async (space: Space, on: boolean) => {
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

  const isBound = (s: Space) =>
    s.knowledgeBases.some((b) => b.knowledgeBaseId === kbId);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return spaces;
    return spaces.filter((s) => s.name.toLowerCase().includes(q));
  }, [spaces, filter]);

  // Bind/unbind every (filtered) Space in one pass.
  const setAllFiltered = useCallback(
    async (on: boolean) => {
      const targets = filtered.filter(
        (s) => s.knowledgeBases.some((b) => b.knowledgeBaseId === kbId) !== on,
      );
      if (targets.length === 0) return;
      setBusy("all");
      setError(null);
      try {
        for (const space of targets) {
          const res = await setSpaceKbs({
            input: {
              tenantId,
              spaceId: space.id,
              knowledgeBases: nextSet(space.knowledgeBases, on),
            },
          });
          if (res.error) {
            setError(res.error.message);
            break;
          }
        }
        reload();
      } finally {
        setBusy(null);
      }
    },
    [filtered, setSpaceKbs, tenantId, reload, kbId],
  );

  const boundCount = spaces.filter(isBound).length;
  const allFilteredBound = filtered.length > 0 && filtered.every(isBound);

  return (
    <SettingsSection label="Binding">
      {error ? (
        <div className="px-4 py-3 text-sm text-destructive">{error}</div>
      ) : null}

      <SettingsRow
        label="Tenant-wide"
        description="Every Space's threads can retrieve this Knowledge Base."
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
          No Spaces yet. Create a Space to bind this Knowledge Base to it.
        </div>
      ) : (
        <div className="px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">
              Spaces
              {boundCount > 0 ? (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  ({boundCount} bound)
                </span>
              ) : null}
            </p>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null || filtered.length === 0}
              onClick={() => setAllFiltered(!allFilteredBound)}
            >
              {allFilteredBound ? "Clear all" : "Select all"}
            </Button>
          </div>

          {spaces.length > FILTER_THRESHOLD ? (
            <Input
              className="mb-2"
              placeholder="Filter Spaces…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          ) : null}

          {filtered.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              No Spaces match “{filter}”.
            </p>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((space) => {
                const checkboxId = `kb-bind-space-${space.id}`;
                return (
                  <label
                    key={space.id}
                    htmlFor={checkboxId}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={isBound(space)}
                      disabled={busy !== null}
                      onCheckedChange={(on) => toggleSpace(space, on === true)}
                    />
                    <span className="text-sm text-foreground">
                      {space.name}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
