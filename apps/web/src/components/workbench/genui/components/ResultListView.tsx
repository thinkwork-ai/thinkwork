import {
  CircleCheck,
  CircleHelp,
  ClipboardList,
  MessageSquareQuote,
} from "lucide-react";
import { Badge } from "@thinkwork/ui";
import { DecisionPanel } from "./DecisionPanel";
import type { ThreadJsonRenderDurableActionDescriptor } from "../../json-render/validation";
import type { JsonRenderActionStatus } from "../../json-render/use-json-render-action";

type ResultListTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "muted";

type ResultListValue = string | number | boolean | null;

interface ResultListGroup {
  id: string;
  title: string;
  summary?: string | null;
}

interface ResultListMetaItem {
  label: string;
  value: ResultListValue;
}

interface ResultListEvidence {
  label?: string | null;
  text: string;
}

interface ResultListBaseItem {
  id: string;
  variant: "workItem" | "question" | "review" | "genericSummary";
  title: string;
  summary?: string | null;
  statusLabel?: string | null;
  statusTone?: ResultListTone | null;
  groupId?: string | null;
  meta?: ResultListMetaItem[];
  evidence?: ResultListEvidence[];
  primaryActionId?: string | null;
  secondaryActionId?: string | null;
}

export type ResultListItem = ResultListBaseItem & {
  priorityLabel?: string | null;
  ownerLabel?: string | null;
  dueLabel?: string | null;
  required?: boolean;
  answerLabel?: string | null;
  reviewerLabel?: string | null;
  recommendationLabel?: string | null;
  sourceLabel?: string | null;
};

export interface ResultListViewProps {
  title: string;
  summary?: string | null;
  groups?: ResultListGroup[];
  items: ResultListItem[];
  emptyState?: {
    title: string;
    summary?: string | null;
  };
  actions?: ThreadJsonRenderDurableActionDescriptor[];
  actionsDisabled?: boolean;
  onAction?: (action: ThreadJsonRenderDurableActionDescriptor) => void;
  statusForAction?: (
    action: ThreadJsonRenderDurableActionDescriptor,
  ) => JsonRenderActionStatus;
}

export function ResultListView({
  title,
  summary,
  groups = [],
  items,
  emptyState,
  actions = [],
  actionsDisabled = true,
  onAction,
  statusForAction,
}: ResultListViewProps) {
  const sections = createSections(groups, items);

  return (
    <section
      aria-label={title}
      className="grid gap-3 rounded-md border border-border bg-card p-3 text-sm shadow-sm"
      data-testid="genui-result-list"
    >
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-5 text-foreground">
            {title}
          </h3>
          {summary ? (
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {summary}
            </p>
          ) : null}
        </div>
        <Badge variant="outline" className="shrink-0 rounded-md text-xs">
          {items.length}
        </Badge>
      </header>

      {items.length > 0 ? (
        <div className="grid gap-3">
          {sections.map((section) => (
            <section
              aria-label={section.title}
              className="grid gap-2"
              key={section.id}
            >
              {section.showHeader ? (
                <header className="flex min-w-0 items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                      {section.title}
                    </h4>
                    {section.summary ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {section.summary}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {section.items.length}
                  </span>
                </header>
              ) : null}
              <div className="grid gap-2">
                {section.items.map((item) => (
                  <ResultListRow
                    actions={actions}
                    actionsDisabled={actionsDisabled}
                    item={item}
                    key={item.id}
                    onAction={onAction}
                    statusForAction={statusForAction}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : emptyState ? (
        <div className="rounded-md border border-dashed border-border bg-muted/25 p-3">
          <p className="text-sm font-medium text-foreground">
            {emptyState.title}
          </p>
          {emptyState.summary ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {emptyState.summary}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ResultListRow({
  item,
  actions,
  actionsDisabled,
  onAction,
  statusForAction,
}: {
  item: ResultListItem;
  actions: ThreadJsonRenderDurableActionDescriptor[];
  actionsDisabled: boolean;
  onAction?: (action: ThreadJsonRenderDurableActionDescriptor) => void;
  statusForAction?: (
    action: ThreadJsonRenderDurableActionDescriptor,
  ) => JsonRenderActionStatus;
}) {
  const Icon = iconForVariant(item.variant);
  const rowActions = actionsForItem(item, actions);

  return (
    <article
      className="grid gap-3 rounded-md border border-border/80 bg-background p-3"
      data-result-list-variant={item.variant}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <div className="mt-0.5 rounded-md border border-border bg-muted/35 p-1">
          <Icon className="size-3.5 text-muted-foreground" />
        </div>
        <div className="grid min-w-0 flex-1 gap-2">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h5 className="min-w-0 break-words text-sm font-medium leading-5 text-foreground">
                  {item.title}
                </h5>
                <Badge
                  variant="outline"
                  className="h-5 rounded-md px-1.5 text-[11px]"
                >
                  {variantLabel(item)}
                </Badge>
                {item.statusLabel ? (
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${toneClass(
                      item.statusTone,
                    )}`}
                  >
                    {item.statusLabel}
                  </span>
                ) : null}
              </div>
              {item.summary ? (
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  {item.summary}
                </p>
              ) : null}
            </div>
            {rowActions.length ? (
              <DecisionPanel
                actions={rowActions}
                disabled={actionsDisabled}
                onAction={onAction}
                pendingLabel="Unavailable"
                primaryActionId={item.primaryActionId ?? undefined}
                statusForAction={statusForAction}
              />
            ) : null}
          </div>

          <ResultListDetails item={item} />

          {item.evidence?.length ? (
            <div className="grid gap-1.5 border-l-2 border-border pl-2.5">
              {item.evidence.map((evidence, index) => (
                <p
                  className="text-xs leading-4 text-muted-foreground"
                  key={`${evidence.label ?? "evidence"}-${index}`}
                >
                  {evidence.label ? (
                    <span className="font-medium text-foreground">
                      {evidence.label}:{" "}
                    </span>
                  ) : null}
                  {evidence.text}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ResultListDetails({ item }: { item: ResultListItem }) {
  const details = [...(item.meta ?? []), ...variantDetails(item)].filter(
    (detail) => detail.value !== null && detail.value !== undefined,
  );

  if (details.length === 0) return null;

  return (
    <dl className="grid gap-1.5 sm:grid-cols-2">
      {details.map((detail, index) => (
        <div
          className="grid grid-cols-[minmax(5rem,0.4fr)_minmax(0,1fr)] gap-2 rounded-md bg-muted/35 px-2 py-1.5"
          key={`${detail.label}-${index}`}
        >
          <dt className="min-w-0 truncate text-xs text-muted-foreground">
            {detail.label}
          </dt>
          <dd className="min-w-0 break-words text-xs text-foreground">
            {formatValue(detail.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function createSections(groups: ResultListGroup[], items: ResultListItem[]) {
  if (groups.length === 0) {
    return [
      {
        id: "all",
        title: "Results",
        summary: null,
        items,
        showHeader: false,
      },
    ];
  }

  const grouped = groups
    .map((group) => ({
      id: group.id,
      title: group.title,
      summary: group.summary ?? null,
      items: items.filter((item) => item.groupId === group.id),
      showHeader: true,
    }))
    .filter((group) => group.items.length > 0);
  const ungrouped = items.filter(
    (item) =>
      !item.groupId || !groups.some((group) => group.id === item.groupId),
  );

  if (ungrouped.length > 0) {
    grouped.push({
      id: "ungrouped",
      title: "Other results",
      summary: null,
      items: ungrouped,
      showHeader: true,
    });
  }

  return grouped;
}

function actionsForItem(
  item: ResultListItem,
  actions: ThreadJsonRenderDurableActionDescriptor[],
) {
  const ids = [item.primaryActionId, item.secondaryActionId].filter(
    (id): id is string => Boolean(id),
  );
  return ids
    .map((id) => actions.find((action) => action.id === id))
    .filter(
      (action): action is ThreadJsonRenderDurableActionDescriptor =>
        action !== undefined,
    );
}

function variantDetails(item: ResultListItem): ResultListMetaItem[] {
  switch (item.variant) {
    case "workItem":
      return [
        { label: "Priority", value: item.priorityLabel ?? null },
        { label: "Owner", value: item.ownerLabel ?? null },
        { label: "Due", value: item.dueLabel ?? null },
      ];
    case "question":
      return [
        { label: "Required", value: item.required ?? null },
        { label: "Answer", value: item.answerLabel ?? null },
      ];
    case "review":
      return [
        { label: "Reviewer", value: item.reviewerLabel ?? null },
        { label: "Recommendation", value: item.recommendationLabel ?? null },
      ];
    case "genericSummary":
      return [{ label: "Source", value: item.sourceLabel ?? null }];
  }
}

function iconForVariant(variant: ResultListItem["variant"]) {
  switch (variant) {
    case "workItem":
      return ClipboardList;
    case "question":
      return CircleHelp;
    case "review":
      return MessageSquareQuote;
    case "genericSummary":
    default:
      return CircleCheck;
  }
}

function variantLabel(item: ResultListItem) {
  switch (item.variant) {
    case "workItem":
      return "Work item";
    case "question":
      return item.required ? "Question required" : "Question";
    case "review":
      return "Review";
    case "genericSummary":
      return "Summary";
  }
}

function toneClass(tone: ResultListTone | null | undefined) {
  switch (tone) {
    case "info":
      return "bg-blue-50 text-blue-700";
    case "success":
      return "bg-emerald-50 text-emerald-700";
    case "warning":
      return "bg-amber-50 text-amber-800";
    case "danger":
      return "bg-red-50 text-red-700";
    case "muted":
      return "bg-muted text-muted-foreground";
    case "neutral":
    default:
      return "bg-secondary text-secondary-foreground";
  }
}

function formatValue(value: ResultListValue) {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
