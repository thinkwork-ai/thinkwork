import { useQuery } from "urql";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  Badge,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@thinkwork/ui";
import type { KnowledgeGraphConnectedEdge } from "@thinkwork/graph";
import { SettingsKnowledgeGraphEntityQuery } from "@/lib/settings-queries";

export function KnowledgeGraphEntitySheet({
  tenantId,
  entityId,
  title,
  connectedEdges = [],
  historyDepth = 0,
  onBack,
  onNeighborClick,
}: {
  tenantId: string;
  entityId: string;
  title: string;
  connectedEdges?: KnowledgeGraphConnectedEdge[];
  historyDepth?: number;
  onBack?: () => void;
  onNeighborClick?: (entityId: string) => void;
}) {
  const [result] = useQuery({
    query: SettingsKnowledgeGraphEntityQuery,
    variables: { tenantId, entityId },
    pause: !tenantId || !entityId,
  });

  const entity = result.data?.knowledgeGraphEntity;
  const loading = result.fetching && !result.data;
  const relationships = entity?.relationships ?? [];
  const evidence = entity?.evidence ?? [];

  return (
    <>
      <SheetHeader className="p-6 pb-0">
        <SheetTitle className="flex items-center gap-2">
          {historyDepth > 0 && onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="-ml-1 mr-1 text-muted-foreground hover:text-foreground"
              aria-label="Back"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : null}
          <span className="truncate">{entity?.label ?? title}</span>
          {entity ? (
            <StatusBadge
              groundingStatus={entity.groundingStatus}
              provenanceStatus={entity.provenanceStatus}
            />
          ) : null}
        </SheetTitle>
        <SheetDescription>
          {entity?.typeLabel ?? entity?.ontologyTypeSlug ?? "Untyped entity"}
          {entity
            ? ` · ${entity.relationshipCount} relationship${entity.relationshipCount === 1 ? "" : "s"} · ${entity.evidenceCount} evidence`
            : ""}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-5 overflow-y-auto px-6 pt-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading entity...
          </div>
        ) : result.error ? (
          <p className="text-sm text-muted-foreground">
            {result.error.message}
          </p>
        ) : !entity ? (
          <p className="text-sm text-muted-foreground">
            This entity could not be loaded.
          </p>
        ) : (
          <>
            {entity.summary ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {entity.summary}
              </p>
            ) : null}

            {entity.aliases.length > 0 ? (
              <section>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Aliases
                </h4>
                <div className="flex flex-wrap gap-1">
                  {entity.aliases.map((alias) => (
                    <Badge
                      key={alias}
                      variant="outline"
                      className="font-normal"
                    >
                      {alias}
                    </Badge>
                  ))}
                </div>
              </section>
            ) : null}

            {hasObjectKeys(entity.properties) ? (
              <section>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Properties
                </h4>
                <pre className="max-h-36 overflow-auto rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                  {JSON.stringify(entity.properties, null, 2)}
                </pre>
              </section>
            ) : null}

            <section>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Relationships
              </h4>
              {connectedEdges.length > 0 ? (
                <div className="space-y-2">
                  {connectedEdges.map((edge) => (
                    <RelationshipButton
                      key={`${edge.relationshipId}:${edge.targetId}`}
                      label={edge.label}
                      targetLabel={edge.targetLabel}
                      groundingStatus={edge.groundingStatus}
                      provenanceStatus={edge.provenanceStatus}
                      evidenceCount={edge.evidenceCount}
                      onClick={() => onNeighborClick?.(edge.targetId)}
                    />
                  ))}
                </div>
              ) : relationships.length > 0 ? (
                <div className="space-y-2">
                  {relationships.map((relationship) => {
                    const targetId =
                      relationship.sourceEntityId === entity.id
                        ? relationship.targetEntityId
                        : relationship.sourceEntityId;
                    return (
                      <RelationshipButton
                        key={relationship.id}
                        label={relationship.label}
                        targetLabel={shortId(targetId)}
                        groundingStatus={relationship.groundingStatus}
                        provenanceStatus={relationship.provenanceStatus}
                        evidenceCount={relationship.evidenceCount}
                        onClick={() => onNeighborClick?.(targetId)}
                      />
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No relationships captured yet.
                </p>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Evidence
              </h4>
              {evidence.length > 0 ? (
                <div className="space-y-2">
                  {evidence.slice(0, 12).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-md border border-border bg-muted/20 px-3 py-2"
                    >
                      <p className="text-sm leading-relaxed">{item.snippet}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.speakerLabel ?? "Source evidence"}
                        {item.messageCreatedAt
                          ? ` · ${formatDate(item.messageCreatedAt)}`
                          : ""}
                        {item.messageId ? ` · ${shortId(item.messageId)}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No direct source evidence captured for this entity.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function RelationshipButton({
  label,
  targetLabel,
  groundingStatus,
  provenanceStatus,
  evidenceCount,
  onClick,
}: {
  label: string;
  targetLabel: string;
  groundingStatus: string;
  provenanceStatus: string;
  evidenceCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2 rounded-md bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/50"
    >
      <StatusBadge
        groundingStatus={groundingStatus}
        provenanceStatus={provenanceStatus}
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {targetLabel}
        </p>
        <p className="text-xs text-muted-foreground">
          {label}
          {evidenceCount ? ` · ${evidenceCount} evidence` : ""}
        </p>
      </div>
    </button>
  );
}

function StatusBadge({
  groundingStatus,
  provenanceStatus,
}: {
  groundingStatus: string;
  provenanceStatus: string;
}) {
  const weak = provenanceStatus !== "STRONG";
  const diagnostic = !weak && groundingStatus !== "GROUNDED";
  return (
    <Badge
      variant={diagnostic ? "secondary" : weak ? "outline" : "default"}
      className="shrink-0 font-normal"
    >
      {weak ? "weak" : diagnostic ? "diagnostic" : "trusted"}
    </Badge>
  );
}

function hasObjectKeys(value: unknown) {
  return !!value && typeof value === "object" && Object.keys(value).length > 0;
}

function shortId(value: string) {
  return value.length > 10 ? `${value.slice(0, 8)}...` : value;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
