import { useState } from "react";
import { useQuery } from "urql";
import { Badge, Button, Input, Spinner } from "@thinkwork/ui";
import { ComputerMemorySearchQuery } from "@/lib/graphql-queries";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsHeader,
  SettingsPane,
} from "@/components/settings/SettingsContent";

type MemoryRecord = {
  memoryRecordId: string;
  content?: { text?: string | null } | null;
  namespace?: string | null;
  createdAt?: string | null;
};

export function SettingsMemory() {
  const { tenantId } = useTenant();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("");

  const [result] = useQuery<{
    memorySearch?: { records?: MemoryRecord[] | null } | null;
  }>({
    query: ComputerMemorySearchQuery,
    variables: { tenantId: tenantId ?? "", query: active, limit: 50 },
    pause: !tenantId || !active,
  });

  const records = result.data?.memorySearch?.records ?? [];

  return (
    <SettingsPane className="max-w-4xl">
      <SettingsHeader
        title="Memory"
        description="Search the tenant’s long-term memory records."
      />
      <form
        className="mb-5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setActive(query.trim());
        }}
      >
        <Input
          placeholder="Search memory…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-md"
        />
        <Button type="submit" disabled={!query.trim()}>
          Search
        </Button>
      </form>

      {!active ? (
        <p className="text-sm text-muted-foreground">
          Enter a query to search memory records.
        </p>
      ) : result.fetching ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" /> Searching…
        </div>
      ) : records.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matching records.</p>
      ) : (
        <div className="divide-y rounded-xl border border-border bg-card">
          {records.map((r) => (
            <div key={r.memoryRecordId} className="px-4 py-3">
              <p className="text-sm">{r.content?.text ?? "—"}</p>
              <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                {r.namespace ? (
                  <Badge variant="outline">{r.namespace}</Badge>
                ) : null}
                {r.createdAt ? (
                  <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsPane>
  );
}
