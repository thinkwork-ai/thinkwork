import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Loader2, Search } from "lucide-react";
import { Badge, Button, Input, Label } from "@thinkwork/ui";
import {
  EntityResolutionDecision,
  type SettingsEntityResolutionCasesQuery as SettingsEntityResolutionCasesData,
} from "@/gql/graphql";
import {
  SettingsCanonicalEntitiesQuery,
  SettingsEntityResolutionCasesQuery,
  SettingsResolveEntityResolutionCaseMutation,
} from "@/lib/settings-queries";
import { useTenant } from "@/context/TenantContext";
import {
  candidateSummary,
  parseJsonObjectArray,
  relativeAge,
} from "./knowledge-model-utils";

type ResolutionCase =
  SettingsEntityResolutionCasesData["entityResolutionCases"][number];

type PendingAction = "link" | "create" | null;

/**
 * Resolution Queue sub-view of the Model tab: open entity ambiguity cases
 * with link / create / defer / reject actions. Candidates and claims are
 * source-safe identity evidence only. Content only — the title row is owned
 * by KnowledgeModelTab.
 */
export function ResolutionQueue() {
  const { tenantId } = useTenant();
  const [result, reexecute] = useQuery({
    query: SettingsEntityResolutionCasesQuery,
    variables: { tenantId, status: "open", limit: 100 },
    pause: !tenantId,
  });

  const cases = result.data?.entityResolutionCases ?? [];
  const loading = result.fetching && !result.data;
  const refetch = () => reexecute({ requestPolicy: "network-only" });

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {result.error ? (
        <p className="text-destructive mb-3 text-sm" role="alert">
          Failed to load resolution cases: {result.error.message}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 p-2 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading resolution cases...
          </div>
        ) : cases.length === 0 ? (
          <div className="text-muted-foreground rounded-md border p-6 text-sm">
            No open resolution cases. New ambiguities appear here when the
            matcher cannot resolve an entity confidently.
          </div>
        ) : (
          <ul className="space-y-3">
            {cases.map((resolutionCase) => (
              <li key={resolutionCase.id}>
                <ResolutionCaseCard
                  resolutionCase={resolutionCase}
                  tenantId={tenantId}
                  onResolved={refetch}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ResolutionCaseCard({
  resolutionCase,
  tenantId,
  onResolved,
}: {
  resolutionCase: ResolutionCase;
  tenantId: string | null;
  onResolved: () => void;
}) {
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [linkEntityId, setLinkEntityId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<EntityResolutionDecision | null>(
    null,
  );

  const [, resolveCase] = useMutation(
    SettingsResolveEntityResolutionCaseMutation,
  );

  const candidates = useMemo(
    () => parseJsonObjectArray(resolutionCase.candidates),
    [resolutionCase.candidates],
  );
  const hint = resolutionCase.displayHint?.trim() || "Unnamed entity";

  const submit = async (
    decision: EntityResolutionDecision,
    extra?: { canonicalEntityId?: string; displayName?: string },
  ) => {
    if (submitting) return;
    setSubmitting(decision);
    setError(null);
    try {
      const mutationResult = await resolveCase({
        tenantId,
        caseId: resolutionCase.id,
        decision,
        canonicalEntityId: extra?.canonicalEntityId ?? null,
        displayName: extra?.displayName ?? null,
      });
      if (mutationResult.error) {
        setError(
          `${mutationResult.error.message} — the case may have been resolved elsewhere; the queue has been refreshed.`,
        );
        onResolved();
        return;
      }
      onResolved();
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {hint}
        </span>
        <Badge variant="outline" className="text-xs">
          {resolutionCase.entityTypeSlug}
        </Badge>
        <Badge variant="outline" className="text-xs">
          {resolutionCase.itemCount} item
          {resolutionCase.itemCount === 1 ? "" : "s"}
        </Badge>
        <span className="text-muted-foreground text-xs">
          opened {relativeAge(resolutionCase.createdAt)}
        </span>
      </div>

      {candidates.length > 0 ? (
        <div className="mt-3">
          <p className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
            Candidates
          </p>
          <ul className="space-y-0.5">
            {candidates.map((candidate, index) => (
              <li
                key={index}
                className="text-muted-foreground truncate text-xs"
              >
                {candidateSummary(candidate)}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground mt-3 text-xs">
          No candidate matches — this is likely a new entity.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-expanded={pendingAction === "link"}
          onClick={() => {
            setPendingAction(pendingAction === "link" ? null : "link");
            setError(null);
          }}
        >
          Link
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={pendingAction === "create"}
          onClick={() => {
            setPendingAction(pendingAction === "create" ? null : "create");
            setDisplayName("");
            setError(null);
          }}
        >
          Create
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={submitting !== null}
          onClick={() => void submit(EntityResolutionDecision.Defer)}
        >
          {submitting === EntityResolutionDecision.Defer ? (
            <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
          ) : null}
          Defer
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={submitting !== null}
          onClick={() => void submit(EntityResolutionDecision.Reject)}
        >
          {submitting === EntityResolutionDecision.Reject ? (
            <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
          ) : null}
          Reject
        </Button>
      </div>

      {pendingAction === "link" ? (
        <div className="mt-3 space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">
            Link to an existing canonical entity
          </p>
          <CanonicalEntityPicker
            tenantId={tenantId}
            entityTypeSlug={resolutionCase.entityTypeSlug}
            selectedId={linkEntityId}
            onSelect={setLinkEntityId}
          />
          <Button
            size="sm"
            disabled={!linkEntityId || submitting !== null}
            onClick={() =>
              linkEntityId
                ? void submit(EntityResolutionDecision.Link, {
                    canonicalEntityId: linkEntityId,
                  })
                : undefined
            }
          >
            {submitting === EntityResolutionDecision.Link ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
            ) : null}
            Link entity
          </Button>
        </div>
      ) : null}

      {pendingAction === "create" ? (
        <div className="mt-3 space-y-2 rounded-md border p-3">
          <Label htmlFor={`create-name-${resolutionCase.id}`}>
            New canonical entity name
          </Label>
          <Input
            id={`create-name-${resolutionCase.id}`}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={hint}
            className="h-8 text-sm"
          />
          <Button
            size="sm"
            disabled={submitting !== null}
            onClick={() =>
              void submit(EntityResolutionDecision.Create, {
                displayName: displayName.trim() || hint,
              })
            }
          >
            {submitting === EntityResolutionDecision.Create ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
            ) : null}
            Create entity
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="text-destructive mt-3 text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Small picker over canonical entities of the case's type — search box plus a
 * short selectable result list, backed by the canonicalEntities query.
 */
function CanonicalEntityPicker({
  tenantId,
  entityTypeSlug,
  selectedId,
  onSelect,
}: {
  tenantId: string | null;
  entityTypeSlug: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [result] = useQuery({
    query: SettingsCanonicalEntitiesQuery,
    variables: {
      tenantId,
      entityTypeSlug,
      search: search.trim() || null,
      status: "active",
      limit: 25,
    },
    pause: !tenantId,
  });

  const entities = result.data?.canonicalEntities ?? [];
  const loading = result.fetching && !result.data;

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Search ${entityTypeSlug} entities...`}
          aria-label="Search canonical entities to link"
          className="h-8 pl-8 text-sm"
        />
      </div>
      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Searching...
        </div>
      ) : entities.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No active {entityTypeSlug} entities found.
        </p>
      ) : (
        <ul
          className="max-h-40 space-y-0.5 overflow-y-auto"
          aria-label="Canonical entity results"
        >
          {entities.map((entity) => (
            <li key={entity.id}>
              <button
                type="button"
                aria-pressed={selectedId === entity.id}
                className={`hover:bg-muted focus-visible:ring-ring w-full truncate rounded px-2 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 ${
                  selectedId === entity.id ? "bg-primary/10 font-medium" : ""
                }`}
                onClick={() =>
                  onSelect(selectedId === entity.id ? null : entity.id)
                }
              >
                {entity.displayName}
                {selectedId === entity.id ? " (selected)" : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
