import type { ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, DataTable as UiDataTable } from "@thinkwork/ui";

export interface AppletTableColumn<TRow extends Record<string, unknown>> {
  key: keyof TRow & string;
  header: ReactNode;
  align?: "left" | "right";
  width?: number;
  render?: (value: TRow[keyof TRow], row: TRow) => ReactNode;
}

export interface AppletDataTableProps<TRow extends Record<string, unknown>> {
  title?: string;
  description?: string;
  columns: Array<AppletTableColumn<TRow>>;
  rows: TRow[];
  emptyState?: ReactNode;
  badges?: ReactNode[];
}

export function DataTable<TRow extends Record<string, unknown>>({
  title,
  description,
  columns,
  rows,
  emptyState = "No rows yet.",
  badges = [],
}: AppletDataTableProps<TRow>) {
  return (
    <section className="rounded-lg border border-border/70 bg-background">
      {title || description || badges.length ? (
        <div className="flex flex-col gap-2 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {title ? <h3 className="text-sm font-semibold">{title}</h3> : null}
            {description ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {badges.length ? (
            <div className="flex flex-wrap gap-1.5">
              {badges.map((badge, index) => (
                <Badge key={index} variant="secondary" className="rounded-md">
                  {badge}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          {emptyState}
        </div>
      ) : (
        <div className="p-0">
          <UiDataTable
            columns={toColumnDefs(columns)}
            data={rows}
            pageSize={0}
            tableClassName="min-w-[720px]"
          />
        </div>
      )}
    </section>
  );
}

function toColumnDefs<TRow extends Record<string, unknown>>(
  columns: Array<AppletTableColumn<TRow>>,
): Array<ColumnDef<TRow, unknown>> {
  return columns.map((column) => ({
    accessorKey: column.key,
    header: () => (
      <span className={column.align === "right" ? "block text-right" : ""}>
        {column.header}
      </span>
    ),
    size: column.width,
    cell: ({ row, getValue }) => {
      const value = getValue();
      const rendered = column.render
        ? column.render(value as TRow[keyof TRow], row.original)
        : String(value ?? "");
      return (
        <span
          className={
            column.align === "right"
              ? "block text-right font-mono tabular-nums"
              : "block min-w-0 truncate"
          }
        >
          {rendered}
        </span>
      );
    },
  }));
}
