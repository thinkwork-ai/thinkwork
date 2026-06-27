"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "./badge.js";
import { cn } from "../../lib/utils.js";

export interface GroupedListGroup<Row> {
  id: string;
  label: string;
  rows: Row[];
  subgroups?: GroupedListGroup<Row>[];
}

export interface GroupedListViewProps<Row> {
  groups: GroupedListGroup<Row>[];
  getRowId: (row: Row) => string;
  renderRow: (row: Row) => React.ReactNode;
  emptyState?: React.ReactNode;
  className?: string;
  groupCountPlacement?: "end" | "inline";
  groupCountClassName?: string;
  groupLabelClassName?: string;
  rowClassName?: string;
  "data-testid"?: string;
}

export function GroupedListView<Row>({
  groups,
  getRowId,
  renderRow,
  emptyState = "No results.",
  className,
  groupCountPlacement = "end",
  groupCountClassName,
  groupLabelClassName,
  rowClassName,
  "data-testid": testId,
}: GroupedListViewProps<Row>) {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(
    () => new Set(),
  );
  const groupSignature = React.useMemo(
    () =>
      groups
        .map((group) =>
          [
            group.id,
            ...(group.subgroups?.map((subgroup) => subgroup.id) ?? []),
          ].join("/"),
        )
        .join("|"),
    [groups],
  );
  const visibleRowCount = groups.reduce(
    (count, group) => count + countRows(group),
    0,
  );

  React.useEffect(() => {
    setCollapsed(new Set());
  }, [groupSignature]);

  const toggle = React.useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (visibleRowCount === 0) {
    return (
      <div
        className={cn(
          "flex h-full min-h-32 items-center justify-center rounded-md border text-sm text-muted-foreground",
          className,
        )}
        data-testid={testId}
      >
        {emptyState}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "h-full overflow-y-auto rounded-md border bg-background",
        className,
      )}
      data-testid={testId}
    >
      <div className="min-w-0 divide-y">
        {groups.map((group) => (
          <GroupSection
            key={group.id}
            group={group}
            collapseId={group.id}
            collapsed={collapsed}
            getRowId={getRowId}
            renderRow={renderRow}
            groupCountPlacement={groupCountPlacement}
            groupCountClassName={groupCountClassName}
            groupLabelClassName={groupLabelClassName}
            rowClassName={rowClassName}
            onToggle={toggle}
          />
        ))}
      </div>
    </div>
  );
}

function GroupSection<Row>({
  group,
  collapseId,
  collapsed,
  getRowId,
  renderRow,
  groupCountPlacement,
  groupCountClassName,
  groupLabelClassName,
  rowClassName,
  onToggle,
  depth = 0,
}: {
  group: GroupedListGroup<Row>;
  collapseId: string;
  collapsed: Set<string>;
  getRowId: (row: Row) => string;
  renderRow: (row: Row) => React.ReactNode;
  groupCountPlacement: "end" | "inline";
  groupCountClassName?: string;
  groupLabelClassName?: string;
  rowClassName?: string;
  onToggle: (id: string) => void;
  depth?: number;
}) {
  const isCollapsed = collapsed.has(collapseId);
  const totalRows = countRows(group);

  return (
    <section className={depth > 0 ? "border-t" : undefined}>
      <button
        type="button"
        className={cn(
          "flex h-9 w-full items-center gap-2 bg-muted/70 px-3 text-left text-xs font-medium text-muted-foreground",
          depth === 0 && "sticky top-0 z-10 backdrop-blur",
          depth > 0 && "h-8 bg-background px-3",
        )}
        onClick={() => onToggle(collapseId)}
      >
        {isCollapsed ? (
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <span className={cn("min-w-0 truncate", groupLabelClassName)}>
          {group.label}
        </span>
        <Badge
          variant="secondary"
          className={cn(
            groupCountPlacement === "end"
              ? "ml-auto h-5 px-1.5 text-[11px]"
              : "h-auto rounded-none border-transparent bg-transparent px-0 text-xs font-medium text-muted-foreground shadow-none",
            groupCountClassName,
          )}
        >
          {totalRows}
        </Badge>
      </button>
      {isCollapsed ? null : (
        <div className={cn(depth > 0 ? "divide-y" : undefined)}>
          {group.subgroups?.length
            ? group.subgroups.map((subgroup) => (
                <GroupSection
                  key={subgroup.id}
                  group={subgroup}
                  collapseId={`${collapseId}/${subgroup.id}`}
                  collapsed={collapsed}
                  getRowId={getRowId}
                  renderRow={renderRow}
                  groupCountPlacement={groupCountPlacement}
                  groupCountClassName={groupCountClassName}
                  groupLabelClassName={groupLabelClassName}
                  rowClassName={rowClassName}
                  onToggle={onToggle}
                  depth={depth + 1}
                />
              ))
            : group.rows.map((row) => (
                <div
                  key={getRowId(row)}
                  className={cn(
                    "min-h-12 border-t px-3 py-2 transition-colors hover:bg-muted/35",
                    depth > 0 && "px-6",
                    rowClassName,
                  )}
                >
                  {renderRow(row)}
                </div>
              ))}
          {totalRows === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              No items
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function countRows<Row>(group: GroupedListGroup<Row>): number {
  if (group.subgroups?.length) {
    return group.subgroups.reduce(
      (count, subgroup) => count + countRows(subgroup),
      0,
    );
  }
  return group.rows.length;
}
