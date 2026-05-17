import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  FileSearch,
  GitBranch,
  Loader2,
  Network,
  Pencil,
  Play,
  RotateCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import {
  ApproveOntologyChangeSetMutation,
  OntologyChangeSetsQuery,
  OntologyDefinitionsQuery,
  OntologyReprocessJobQuery,
  OntologySuggestionScanJobQuery,
  RejectOntologyChangeSetMutation,
  StartOntologySuggestionScanMutation,
  UpdateOntologyChangeSetMutation,
} from "@/lib/graphql-queries";
import { apiFetch, NotReadyError } from "@/lib/api-fetch";
import { cn, formatDateTime } from "@/lib/utils";
import {
  OntologyChangeSetStatus,
  OntologyJobStatus,
  OntologyLifecycleStatus,
} from "@/gql/graphql";

export const Route = createFileRoute("/_authed/_tenant/ontology")({
  component: OntologyStudioPage,
});

type JsonValue = unknown;

type EvidenceExample = {
  id: string;
  sourceKind: string;
  sourceRef?: string | null;
  sourceLabel?: string | null;
  quote: string;
  metadata?: JsonValue;
  observedAt?: string | null;
};

type ChangeSetItem = {
  id: string;
  itemType: string;
  action: string;
  status: OntologyChangeSetStatus;
  targetKind?: string | null;
  targetSlug?: string | null;
  title: string;
  description?: string | null;
  proposedValue: JsonValue;
  editedValue?: JsonValue;
  confidence?: number | null;
  position: number;
  evidenceExamples: EvidenceExample[];
};

type ChangeSetRow = {
  id: string;
  title: string;
  summary?: string | null;
  status: OntologyChangeSetStatus;
  confidence?: number | null;
  observedFrequency: number;
  expectedImpact: JsonValue;
  proposedBy: string;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  appliedVersionId?: string | null;
  createdAt: string;
  updatedAt: string;
  items: ChangeSetItem[];
  evidenceExamples: EvidenceExample[];
};

type ItemDraft = {
  status: OntologyChangeSetStatus;
  editedValueInput: string;
};

type ChangeSetDraft = {
  title: string;
  summary: string;
};

type ParseResult =
  | { ok: true; value: JsonValue }
  | { ok: false; message: string };

const REVIEWABLE_STATUSES = new Set<OntologyChangeSetStatus>([
  OntologyChangeSetStatus.Draft,
  OntologyChangeSetStatus.PendingReview,
]);

const STATUS_OPTIONS = [
  OntologyChangeSetStatus.Draft,
  OntologyChangeSetStatus.PendingReview,
  OntologyChangeSetStatus.Approved,
  OntologyChangeSetStatus.Rejected,
];

export function stringifyJsonValue(value: JsonValue): string {
  return JSON.stringify(value ?? {}, null, 2);
}

export function parseEditedValueInput(input: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}

export function itemDraftFromItem(item: ChangeSetItem): ItemDraft {
  return {
    status: item.status,
    editedValueInput: stringifyJsonValue(
      item.editedValue ?? item.proposedValue,
    ),
  };
}

export function changeSetDraftFromChangeSet(
  changeSet: ChangeSetRow,
): ChangeSetDraft {
  return {
    title: changeSet.title,
    summary: changeSet.summary ?? "",
  };
}

export function sortChangeSets(changeSets: ChangeSetRow[]): ChangeSetRow[] {
  const priority: Record<OntologyChangeSetStatus, number> = {
    [OntologyChangeSetStatus.PendingReview]: 0,
    [OntologyChangeSetStatus.Draft]: 1,
    [OntologyChangeSetStatus.Approved]: 2,
    [OntologyChangeSetStatus.Applied]: 3,
    [OntologyChangeSetStatus.Rejected]: 4,
  };
  return [...changeSets].sort((a, b) => {
    const statusDelta = priority[a.status] - priority[b.status];
    if (statusDelta !== 0) return statusDelta;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

export function statusTone(
  status: OntologyChangeSetStatus | OntologyJobStatus | OntologyLifecycleStatus,
) {
  switch (status) {
    case OntologyChangeSetStatus.PendingReview:
    case OntologyJobStatus.Running:
      return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
    case OntologyChangeSetStatus.Approved:
    case OntologyChangeSetStatus.Applied:
    case OntologyJobStatus.Succeeded:
      return "bg-green-500/15 text-green-700 dark:text-green-300";
    case OntologyChangeSetStatus.Rejected:
    case OntologyJobStatus.Failed:
    case OntologyJobStatus.Canceled:
      return "bg-destructive/15 text-destructive";
    case OntologyJobStatus.Pending:
    case OntologyChangeSetStatus.Draft:
    case OntologyLifecycleStatus.Proposed:
    default:
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  }
}

function compactLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatPercent(value?: number | null): string {
  if (value == null) return "n/a";
  return `${Math.round(value * 100)}%`;
}

function jsonObject(value: JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metricValue(value: JsonValue, key: string): string | null {
  const raw = jsonObject(value)[key];
  if (raw == null) return null;
  if (typeof raw === "number") return raw.toLocaleString();
  if (typeof raw === "string") return raw;
  return JSON.stringify(raw);
}

function StatusBadge({
  status,
}: {
  status: OntologyChangeSetStatus | OntologyJobStatus | OntologyLifecycleStatus;
}) {
  return (
    <Badge variant="secondary" className={cn("text-xs", statusTone(status))}>
      {compactLabel(status)}
    </Badge>
  );
}

function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
      <p className={cn("truncate text-sm", mono && "font-mono text-xs")}>
        {value}
      </p>
    </div>
  );
}

function JsonPreview({ value }: { value: JsonValue }) {
  return (
    <pre className="max-h-56 overflow-auto rounded-md bg-muted/40 p-3 text-xs leading-relaxed">
      {stringifyJsonValue(value)}
    </pre>
  );
}

function EvidenceList({ examples }: { examples: EvidenceExample[] }) {
  if (examples.length === 0) {
    return (
      <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
        No evidence examples captured yet.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {examples.slice(0, 4).map((example) => (
        <div key={example.id} className="rounded-md border p-3">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="font-mono text-[10px]">
              {example.sourceKind}
            </Badge>
            {example.sourceLabel && (
              <span className="text-xs text-muted-foreground">
                {example.sourceLabel}
              </span>
            )}
          </div>
          <p className="text-sm leading-relaxed">{example.quote}</p>
          {example.observedAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDateTime(example.observedAt)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-md border border-dashed p-8 text-center">
      <Icon className="mx-auto h-8 w-8 text-muted-foreground" />
      <h3 className="mt-3 text-sm font-medium">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

function DefinitionList({
  definitions,
}: {
  definitions:
    | {
        activeVersion?: {
          versionNumber: number;
          activatedAt?: string | null;
        } | null;
        entityTypes: Array<{
          id: string;
          slug: string;
          name: string;
          description?: string | null;
          broadType: string;
          aliases: string[];
          lifecycleStatus: OntologyLifecycleStatus;
          guidanceNotes?: string | null;
          facetTemplates: Array<{
            id: string;
            slug: string;
            heading: string;
            facetType: string;
            lifecycleStatus: OntologyLifecycleStatus;
          }>;
          externalMappings: Array<{
            id: string;
            mappingKind: string;
            vocabulary: string;
            externalUri: string;
            externalLabel?: string | null;
          }>;
        }>;
        relationshipTypes: Array<{
          id: string;
          slug: string;
          name: string;
          description?: string | null;
          inverseName?: string | null;
          sourceTypeSlugs: string[];
          targetTypeSlugs: string[];
          lifecycleStatus: OntologyLifecycleStatus;
          externalMappings: Array<{
            id: string;
            mappingKind: string;
            vocabulary: string;
            externalUri: string;
            externalLabel?: string | null;
          }>;
        }>;
      }
    | undefined;
}) {
  if (!definitions) {
    return (
      <EmptyState
        icon={Database}
        title="Loading definitions"
        body="Fetching the active business ontology."
      />
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Fact
          label="Active version"
          value={
            definitions.activeVersion
              ? `v${definitions.activeVersion.versionNumber}`
              : "No active version"
          }
        />
        <Fact
          label="Entity types"
          value={String(definitions.entityTypes.length)}
        />
        <Fact
          label="Relationships"
          value={String(definitions.relationshipTypes.length)}
        />
        <Fact
          label="Last activated"
          value={
            definitions.activeVersion?.activatedAt
              ? formatDateTime(definitions.activeVersion.activatedAt)
              : "n/a"
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Entity Types</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {definitions.entityTypes.length === 0 ? (
              <EmptyState
                icon={Database}
                title="No entity types"
                body="Approved entity definitions will appear here."
              />
            ) : (
              definitions.entityTypes.map((entity) => (
                <div key={entity.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="font-medium">{entity.name}</p>
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px]"
                        >
                          {entity.slug}
                        </Badge>
                        <StatusBadge status={entity.lifecycleStatus} />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {entity.description ?? "No description yet."}
                      </p>
                    </div>
                    <Badge variant="secondary">{entity.broadType}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <Fact
                      label="Aliases"
                      value={entity.aliases.join(", ") || "none"}
                    />
                    <Fact
                      label="Facet templates"
                      value={
                        entity.facetTemplates
                          .map((facet) => facet.heading)
                          .join(", ") || "none"
                      }
                    />
                  </div>
                  {entity.guidanceNotes && (
                    <p className="mt-3 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                      {entity.guidanceNotes}
                    </p>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Relationship Types</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {definitions.relationshipTypes.length === 0 ? (
              <EmptyState
                icon={GitBranch}
                title="No relationship types"
                body="Approved relationship definitions will appear here."
              />
            ) : (
              definitions.relationshipTypes.map((relationship) => (
                <div key={relationship.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-medium">{relationship.name}</p>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {relationship.slug}
                    </Badge>
                    <StatusBadge status={relationship.lifecycleStatus} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {relationship.description ?? "No description yet."}
                  </p>
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <Fact
                      label="From"
                      value={relationship.sourceTypeSlugs.join(", ") || "any"}
                    />
                    <Fact
                      label="To"
                      value={relationship.targetTypeSlugs.join(", ") || "any"}
                    />
                  </div>
                  {relationship.inverseName && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Inverse: {relationship.inverseName}
                    </p>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MappingsPanel({
  definitions,
}: {
  definitions:
    | {
        externalMappings: Array<{
          id: string;
          subjectKind: string;
          subjectId: string;
          mappingKind: string;
          vocabulary: string;
          externalUri: string;
          externalLabel?: string | null;
          notes?: string | null;
        }>;
      }
    | undefined;
}) {
  const mappings = definitions?.externalMappings ?? [];
  if (mappings.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="No external mappings"
        body="Schema.org and industry vocabulary links will appear here once approved."
      />
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          External Vocabulary Mappings
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Subject</th>
                <th className="px-3 py-2 text-left font-medium">Vocabulary</th>
                <th className="px-3 py-2 text-left font-medium">Match</th>
                <th className="px-3 py-2 text-left font-medium">URI</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {mappings.map((mapping) => (
                <tr key={mapping.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {mapping.externalLabel ?? mapping.subjectId}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {mapping.subjectKind}
                    </div>
                  </td>
                  <td className="px-3 py-2">{mapping.vocabulary}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">
                      {compactLabel(mapping.mappingKind)}
                    </Badge>
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 font-mono text-xs">
                    {mapping.externalUri}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ChangeSetList({
  changeSets,
  selectedId,
  onSelect,
}: {
  changeSets: ChangeSetRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (changeSets.length === 0) {
    return (
      <EmptyState
        icon={FileSearch}
        title="No change sets"
        body="Run a suggestion scan to identify missing business types, relationships, facets, and mappings."
      />
    );
  }
  return (
    <div className="space-y-2">
      {changeSets.map((changeSet) => (
        <button
          key={changeSet.id}
          type="button"
          onClick={() => onSelect(changeSet.id)}
          className={cn(
            "w-full rounded-md border p-3 text-left transition-colors hover:bg-muted/40",
            selectedId === changeSet.id && "border-primary bg-primary/5",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{changeSet.title}</p>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {changeSet.summary ?? "No summary."}
              </p>
            </div>
            <StatusBadge status={changeSet.status} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <Fact
              label="Confidence"
              value={formatPercent(changeSet.confidence)}
            />
            <Fact
              label="Observed"
              value={changeSet.observedFrequency.toLocaleString()}
            />
            <Fact label="Items" value={String(changeSet.items.length)} />
          </div>
        </button>
      ))}
    </div>
  );
}

function ChangeSetEditor({
  changeSet,
  draft,
  itemDrafts,
  canManage,
  saving,
  approving,
  rejecting,
  onDraftChange,
  onItemDraftChange,
  onSave,
  onApprove,
  onReject,
}: {
  changeSet: ChangeSetRow | null;
  draft?: ChangeSetDraft;
  itemDrafts: Record<string, ItemDraft>;
  canManage: boolean;
  saving: boolean;
  approving: boolean;
  rejecting: boolean;
  onDraftChange: (changeSetId: string, draft: ChangeSetDraft) => void;
  onItemDraftChange: (itemId: string, draft: ItemDraft) => void;
  onSave: (changeSet: ChangeSetRow) => void;
  onApprove: (changeSet: ChangeSetRow) => void;
  onReject: (changeSet: ChangeSetRow) => void;
}) {
  if (!changeSet || !draft) {
    return (
      <EmptyState
        icon={SlidersHorizontal}
        title="Select a change set"
        body="Choose a draft or review-ready change set to inspect evidence and edit proposed ontology payloads."
      />
    );
  }
  const reviewable = REVIEWABLE_STATUSES.has(changeSet.status);
  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{changeSet.title}</CardTitle>
              <StatusBadge status={changeSet.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Proposed by {changeSet.proposedBy} - updated{" "}
              {formatDateTime(changeSet.updatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSave(changeSet)}
              disabled={!canManage || saving || !reviewable}
            >
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onReject(changeSet)}
              disabled={!canManage || rejecting || !reviewable}
            >
              {rejecting ? <Loader2 className="animate-spin" /> : <XCircle />}
              Reject
            </Button>
            <Button
              size="sm"
              onClick={() => onApprove(changeSet)}
              disabled={!canManage || approving || !reviewable}
            >
              {approving ? (
                <Loader2 className="animate-spin" />
              ) : (
                <ShieldCheck />
              )}
              Approve
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canManage && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <p>
              Only tenant owners and admins can save, approve, or reject
              ontology changes.
            </p>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <Fact
            label="Confidence"
            value={formatPercent(changeSet.confidence)}
          />
          <Fact
            label="Frequency"
            value={changeSet.observedFrequency.toLocaleString()}
          />
          <Fact
            label="Impact"
            value={
              metricValue(changeSet.expectedImpact, "affectedPages") ??
              metricValue(changeSet.expectedImpact, "affectedRecords") ??
              "review"
            }
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`title-${changeSet.id}`}>Title</Label>
            <Input
              id={`title-${changeSet.id}`}
              value={draft.title}
              disabled={!canManage || !reviewable}
              onChange={(event) =>
                onDraftChange(changeSet.id, {
                  ...draft,
                  title: event.target.value,
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`summary-${changeSet.id}`}>Summary</Label>
            <Input
              id={`summary-${changeSet.id}`}
              value={draft.summary}
              disabled={!canManage || !reviewable}
              onChange={(event) =>
                onDraftChange(changeSet.id, {
                  ...draft,
                  summary: event.target.value,
                })
              }
            />
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-3">
            {changeSet.items
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((item) => {
                const itemDraft =
                  itemDrafts[item.id] ?? itemDraftFromItem(item);
                return (
                  <div key={item.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="font-medium">{item.title}</p>
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px]"
                          >
                            {item.itemType}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px]"
                          >
                            {item.action}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {item.description ?? "No description."}
                        </p>
                      </div>
                      <StatusBadge status={itemDraft.status} />
                    </div>

                    <div className="mt-3 grid gap-3 lg:grid-cols-[12rem_minmax(0,1fr)]">
                      <div className="space-y-2">
                        <div className="space-y-1.5">
                          <Label>Status</Label>
                          <Select
                            value={itemDraft.status}
                            disabled={!canManage || !reviewable}
                            onValueChange={(value) =>
                              onItemDraftChange(item.id, {
                                ...itemDraft,
                                status: value as OntologyChangeSetStatus,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map((status) => (
                                <SelectItem key={status} value={status}>
                                  {compactLabel(status)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!canManage || !reviewable}
                            onClick={() =>
                              onItemDraftChange(item.id, {
                                ...itemDraft,
                                status: OntologyChangeSetStatus.PendingReview,
                              })
                            }
                          >
                            <Clock />
                            Hold
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!canManage || !reviewable}
                            onClick={() =>
                              onItemDraftChange(item.id, {
                                ...itemDraft,
                                status: OntologyChangeSetStatus.Rejected,
                              })
                            }
                          >
                            <XCircle />
                            Remove
                          </Button>
                        </div>
                        <Fact
                          label="Item confidence"
                          value={formatPercent(item.confidence)}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`edited-${item.id}`}>
                          Edited payload
                        </Label>
                        <Textarea
                          id={`edited-${item.id}`}
                          value={itemDraft.editedValueInput}
                          disabled={!canManage || !reviewable}
                          className="min-h-52 font-mono text-xs"
                          onChange={(event) =>
                            onItemDraftChange(item.id, {
                              ...itemDraft,
                              editedValueInput: event.target.value,
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="mt-3">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">
                        Evidence
                      </p>
                      <EvidenceList examples={item.evidenceExamples} />
                    </div>
                  </div>
                );
              })}
          </div>

          <div className="space-y-3">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Change-set evidence
              </p>
              <EvidenceList examples={changeSet.evidenceExamples} />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Expected impact
              </p>
              <JsonPreview value={changeSet.expectedImpact} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ReprocessPanel({
  jobIdInput,
  setJobIdInput,
  activeJobId,
  setActiveJobId,
  job,
  fetching,
  approvedChangeSets,
}: {
  jobIdInput: string;
  setJobIdInput: (value: string) => void;
  activeJobId: string | null;
  setActiveJobId: (value: string | null) => void;
  job:
    | {
        id: string;
        status: OntologyJobStatus;
        attempt: number;
        changeSetId?: string | null;
        ontologyVersionId?: string | null;
        startedAt?: string | null;
        finishedAt?: string | null;
        impact: JsonValue;
        metrics: JsonValue;
        error?: string | null;
        updatedAt: string;
      }
    | null
    | undefined;
  fetching: boolean;
  approvedChangeSets: ChangeSetRow[];
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reprocess Job Monitor</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={jobIdInput}
              onChange={(event) => setJobIdInput(event.target.value)}
              placeholder="Paste a reprocess job id"
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setActiveJobId(jobIdInput.trim() || null)}
            >
              {fetching ? <Loader2 className="animate-spin" /> : <FileSearch />}
              Monitor
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Approval queues one async reprocess job. Use the emitted job id to
            track pending, running, succeeded, or failed runs.
          </p>
        </CardContent>
      </Card>

      {activeJobId && !job && !fetching && (
        <EmptyState
          icon={Clock}
          title="Job not found yet"
          body="The worker may not have claimed the queued job, or the id may be from another tenant."
        />
      )}

      {job && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Job {job.id}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Attempt {job.attempt} - updated{" "}
                  {formatDateTime(job.updatedAt)}
                </p>
              </div>
              <div className="flex gap-2">
                <StatusBadge status={job.status} />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled
                  title="Retry requires a backend retry mutation."
                >
                  <RotateCw />
                  Retry
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Fact label="Change set" value={job.changeSetId ?? "n/a"} mono />
              <Fact
                label="Ontology version"
                value={job.ontologyVersionId ?? "pending"}
                mono
              />
              <Fact
                label="Started"
                value={
                  job.startedAt ? formatDateTime(job.startedAt) : "pending"
                }
              />
              <Fact
                label="Finished"
                value={
                  job.finishedAt ? formatDateTime(job.finishedAt) : "pending"
                }
              />
            </div>
            {job.error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {job.error}
              </div>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Before / after impact
                </p>
                <JsonPreview value={job.impact} />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Metrics
                </p>
                <JsonPreview value={job.metrics} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Recently Approved Change Sets
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {approvedChangeSets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Approved or applied change sets will appear here after review.
            </p>
          ) : (
            approvedChangeSets.slice(0, 6).map((changeSet) => (
              <div
                key={changeSet.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <div>
                  <p className="font-medium">{changeSet.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {changeSet.approvedAt
                      ? `Approved ${formatDateTime(changeSet.approvedAt)}`
                      : `Updated ${formatDateTime(changeSet.updatedAt)}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {changeSet.appliedVersionId && (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      version {changeSet.appliedVersionId}
                    </Badge>
                  )}
                  <StatusBadge status={changeSet.status} />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function OntologyStudioPage() {
  const { tenantId } = useTenant();
  useBreadcrumbs([
    { label: "Manage", href: "/settings" },
    { label: "Ontology" },
  ]);

  const [tab, setTab] = useState("change-sets");
  const [selectedChangeSetId, setSelectedChangeSetId] = useState<string | null>(
    null,
  );
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [reprocessJobIdInput, setReprocessJobIdInput] = useState("");
  const [activeReprocessJobId, setActiveReprocessJobId] = useState<
    string | null
  >(null);
  const [itemDrafts, setItemDrafts] = useState<Record<string, ItemDraft>>({});
  const [changeSetDrafts, setChangeSetDrafts] = useState<
    Record<string, ChangeSetDraft>
  >({});
  const [callerRole, setCallerRole] = useState<string | null>(null);
  const [roleRetryTick, setRoleRetryTick] = useState(0);

  const [definitionsResult, refetchDefinitions] = useQuery({
    query: OntologyDefinitionsQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [changeSetsResult, refetchChangeSets] = useQuery({
    query: OntologyChangeSetsQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [scanJobResult, refetchScanJob] = useQuery({
    query: OntologySuggestionScanJobQuery,
    variables: { tenantId: tenantId ?? "", jobId: scanJobId ?? "" },
    pause: !tenantId || !scanJobId,
    requestPolicy: "cache-and-network",
  });
  const [reprocessJobResult, refetchReprocessJob] = useQuery({
    query: OntologyReprocessJobQuery,
    variables: {
      tenantId: tenantId ?? "",
      jobId: activeReprocessJobId ?? "",
    },
    pause: !tenantId || !activeReprocessJobId,
    requestPolicy: "cache-and-network",
  });

  const [{ fetching: scanStarting }, startScan] = useMutation(
    StartOntologySuggestionScanMutation,
  );
  const [{ fetching: savingChangeSet }, updateChangeSet] = useMutation(
    UpdateOntologyChangeSetMutation,
  );
  const [{ fetching: approvingChangeSet }, approveChangeSet] = useMutation(
    ApproveOntologyChangeSetMutation,
  );
  const [{ fetching: rejectingChangeSet }, rejectChangeSet] = useMutation(
    RejectOntologyChangeSetMutation,
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        const data = await apiFetch<{ role?: string | null }>("/api/auth/me");
        if (!cancelled) setCallerRole(data.role ?? null);
      } catch (error) {
        if (error instanceof NotReadyError && !cancelled) {
          timer = setTimeout(() => setRoleRetryTick((tick) => tick + 1), 100);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [roleRetryTick]);

  const changeSets = useMemo(
    () =>
      sortChangeSets(
        (changeSetsResult.data?.ontologyChangeSets ?? []) as ChangeSetRow[],
      ),
    [changeSetsResult.data],
  );
  const definitions = definitionsResult.data?.ontologyDefinitions;
  const selectedChangeSet = useMemo(
    () =>
      changeSets.find((changeSet) => changeSet.id === selectedChangeSetId) ??
      changeSets.find((changeSet) =>
        REVIEWABLE_STATUSES.has(changeSet.status),
      ) ??
      changeSets[0] ??
      null,
    [changeSets, selectedChangeSetId],
  );
  const activeScanJob = scanJobResult.data?.ontologySuggestionScanJob;
  const activeReprocessJob = reprocessJobResult.data?.ontologyReprocessJob;
  const canManage = callerRole === "owner" || callerRole === "admin";
  const reviewableCount = changeSets.filter((changeSet) =>
    REVIEWABLE_STATUSES.has(changeSet.status),
  ).length;
  const approvedChangeSets = changeSets.filter(
    (changeSet) =>
      changeSet.status === OntologyChangeSetStatus.Approved ||
      changeSet.status === OntologyChangeSetStatus.Applied,
  );

  useEffect(() => {
    setItemDrafts((current) => {
      const next = { ...current };
      for (const changeSet of changeSets) {
        for (const item of changeSet.items) {
          if (!next[item.id]) next[item.id] = itemDraftFromItem(item);
        }
      }
      return next;
    });
    setChangeSetDrafts((current) => {
      const next = { ...current };
      for (const changeSet of changeSets) {
        if (!next[changeSet.id]) {
          next[changeSet.id] = changeSetDraftFromChangeSet(changeSet);
        }
      }
      return next;
    });
  }, [changeSets]);

  async function runScan() {
    if (!tenantId) return;
    const result = await startScan({
      input: {
        tenantId,
        trigger: "manual",
        dedupeKey: `admin-manual-${Date.now()}`,
      },
    });
    if (result.error) {
      toast.error(`Scan failed: ${result.error.message}`);
      return;
    }
    const job = result.data?.startOntologySuggestionScan;
    if (job) {
      setScanJobId(job.id);
      toast.success("Ontology suggestion scan started");
      refetchChangeSets({ requestPolicy: "network-only" });
    }
  }

  function buildChangeSetUpdateInput(changeSet: ChangeSetRow) {
    if (!tenantId) return null;
    const changeDraft = changeSetDrafts[changeSet.id];
    const parsedItems = [];
    for (const item of changeSet.items) {
      const draft = itemDrafts[item.id] ?? itemDraftFromItem(item);
      const parsed = parseEditedValueInput(draft.editedValueInput);
      if (!parsed.ok) {
        toast.error(`${item.title} has invalid JSON: ${parsed.message}`);
        return;
      }
      parsedItems.push({
        id: item.id,
        status: draft.status,
        editedValue: parsed.value,
      });
    }
    return {
      tenantId,
      changeSetId: changeSet.id,
      title: changeDraft?.title ?? changeSet.title,
      summary: changeDraft?.summary ?? changeSet.summary ?? "",
      items: parsedItems,
    };
  }

  async function saveChangeSet(changeSet: ChangeSetRow) {
    const input = buildChangeSetUpdateInput(changeSet);
    if (!input) return;
    const result = await updateChangeSet({ input });
    if (result.error) {
      toast.error(`Save failed: ${result.error.message}`);
      return;
    }
    toast.success("Change set saved");
    refetchChangeSets({ requestPolicy: "network-only" });
  }

  async function approveSelected(changeSet: ChangeSetRow) {
    if (!tenantId) return;
    const input = buildChangeSetUpdateInput(changeSet);
    if (!input) return;
    const saveResult = await updateChangeSet({ input });
    if (saveResult.error) {
      toast.error(`Save before approval failed: ${saveResult.error.message}`);
      return;
    }
    const result = await approveChangeSet({
      input: { tenantId, changeSetId: changeSet.id },
    });
    if (result.error) {
      toast.error(`Approval failed: ${result.error.message}`);
      return;
    }
    toast.success("Approved. A reprocess job has been queued.");
    setTab("reprocess");
    refetchChangeSets({ requestPolicy: "network-only" });
    refetchDefinitions({ requestPolicy: "network-only" });
  }

  async function rejectSelected(changeSet: ChangeSetRow) {
    if (!tenantId) return;
    const result = await rejectChangeSet({
      input: {
        tenantId,
        changeSetId: changeSet.id,
        reason: "Rejected from Ontology Studio",
      },
    });
    if (result.error) {
      toast.error(`Reject failed: ${result.error.message}`);
      return;
    }
    toast.success("Change set rejected");
    refetchChangeSets({ requestPolicy: "network-only" });
  }

  useEffect(() => {
    if (!scanJobId) return;
    const status = activeScanJob?.status;
    if (
      status === OntologyJobStatus.Succeeded ||
      status === OntologyJobStatus.Failed ||
      status === OntologyJobStatus.Canceled
    ) {
      refetchChangeSets({ requestPolicy: "network-only" });
      return;
    }
    const timer = setTimeout(
      () => refetchScanJob({ requestPolicy: "network-only" }),
      5000,
    );
    return () => clearTimeout(timer);
  }, [activeScanJob?.status, refetchChangeSets, refetchScanJob, scanJobId]);

  useEffect(() => {
    if (!activeReprocessJobId) return;
    const status = activeReprocessJob?.status;
    if (
      status === OntologyJobStatus.Succeeded ||
      status === OntologyJobStatus.Failed ||
      status === OntologyJobStatus.Canceled
    ) {
      refetchDefinitions({ requestPolicy: "network-only" });
      return;
    }
    const timer = setTimeout(
      () => refetchReprocessJob({ requestPolicy: "network-only" }),
      5000,
    );
    return () => clearTimeout(timer);
  }, [
    activeReprocessJob?.status,
    activeReprocessJobId,
    refetchDefinitions,
    refetchReprocessJob,
  ]);

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Ontology Studio
            </h1>
            {reviewableCount > 0 && (
              <Badge
                variant="secondary"
                className="bg-amber-500/15 text-amber-700"
              >
                {reviewableCount} need review
              </Badge>
            )}
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Review suggested business types, relationships, facets, and
            vocabulary mappings before they reshape the Company Brain.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {activeScanJob && (
            <Badge
              variant="secondary"
              className={statusTone(activeScanJob.status)}
            >
              <CheckCircle2 className="h-3 w-3" />
              Scan {compactLabel(activeScanJob.status)}
            </Badge>
          )}
          <Button onClick={runScan} disabled={!tenantId || scanStarting}>
            {scanStarting ? <Loader2 className="animate-spin" /> : <Play />}
            Scan
          </Button>
        </div>
      </div>

      {changeSetsResult.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {changeSetsResult.error.message}
        </div>
      )}
      {activeScanJob?.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {activeScanJob.error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <Fact
          label="Definitions"
          value={`${definitions?.entityTypes.length ?? 0} entities`}
        />
        <Fact
          label="Relationships"
          value={String(definitions?.relationshipTypes.length ?? 0)}
        />
        <Fact label="Change sets" value={String(changeSets.length)} />
        <Fact
          label="Scan status"
          value={activeScanJob ? compactLabel(activeScanJob.status) : "idle"}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="change-sets">
            <Pencil />
            Change Sets
          </TabsTrigger>
          <TabsTrigger value="definitions">
            <Database />
            Definitions
          </TabsTrigger>
          <TabsTrigger value="mappings">
            <Network />
            Mappings
          </TabsTrigger>
          <TabsTrigger value="reprocess">
            <RotateCw />
            Reprocess Jobs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="change-sets" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[23rem_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Suggestions</CardTitle>
              </CardHeader>
              <CardContent>
                {changeSetsResult.fetching && changeSets.length === 0 ? (
                  <EmptyState
                    icon={Loader2}
                    title="Loading change sets"
                    body="Fetching the latest ontology suggestions."
                  />
                ) : (
                  <ChangeSetList
                    changeSets={changeSets}
                    selectedId={selectedChangeSet?.id ?? null}
                    onSelect={setSelectedChangeSetId}
                  />
                )}
              </CardContent>
            </Card>

            <ChangeSetEditor
              changeSet={selectedChangeSet}
              draft={
                selectedChangeSet
                  ? changeSetDrafts[selectedChangeSet.id]
                  : undefined
              }
              itemDrafts={itemDrafts}
              canManage={canManage}
              saving={savingChangeSet}
              approving={approvingChangeSet}
              rejecting={rejectingChangeSet}
              onDraftChange={(changeSetId, draft) =>
                setChangeSetDrafts((current) => ({
                  ...current,
                  [changeSetId]: draft,
                }))
              }
              onItemDraftChange={(itemId, draft) =>
                setItemDrafts((current) => ({ ...current, [itemId]: draft }))
              }
              onSave={saveChangeSet}
              onApprove={approveSelected}
              onReject={rejectSelected}
            />
          </div>
        </TabsContent>

        <TabsContent value="definitions">
          <DefinitionList definitions={definitions} />
        </TabsContent>

        <TabsContent value="mappings">
          <MappingsPanel definitions={definitions} />
        </TabsContent>

        <TabsContent value="reprocess">
          <ReprocessPanel
            jobIdInput={reprocessJobIdInput}
            setJobIdInput={setReprocessJobIdInput}
            activeJobId={activeReprocessJobId}
            setActiveJobId={setActiveReprocessJobId}
            job={activeReprocessJob}
            fetching={reprocessJobResult.fetching}
            approvedChangeSets={approvedChangeSets}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
