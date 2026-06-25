"use client";

import * as React from "react";
import {
  type FilterFn,
  type RowData,
  type Table as TanStackTable,
} from "@tanstack/react-table";
import { Check, ChevronLeft, Filter, X } from "lucide-react";
import { Button } from "./button.js";
import { Input } from "./input.js";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./popover.js";
import { Separator } from "./separator.js";
import { cn } from "../../lib/utils.js";

export type DataTableTokenFilterColumnType = "text" | "option" | "boolean";

export type DataTableTokenFilterOperator =
  | "contains"
  | "does_not_contain"
  | "is"
  | "is_not";

export interface DataTableTokenFilterValue {
  operator: DataTableTokenFilterOperator;
  value: string | boolean;
}

export interface DataTableTokenFilterOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}

export interface DataTableTokenFilterColumn<
  Id extends string = string,
  OptionValue extends string = string,
> {
  id: Id;
  label: string;
  type: DataTableTokenFilterColumnType;
  icon?: React.ReactNode;
  options?: Array<DataTableTokenFilterOption & { value: OptionValue }>;
  loading?: boolean;
  loadingMessage?: string;
  emptyMessage?: string;
  errorMessage?: string;
  disabledReason?: string;
}

export interface DataTableTokenFilterProps<TData extends RowData> {
  table: TanStackTable<TData>;
  columns: DataTableTokenFilterColumn[];
  className?: string;
  align?: "start" | "center" | "end";
  addLabel?: string;
  clearLabel?: string;
}

const operatorLabels = {
  contains: "contains",
  does_not_contain: "does not contain",
  is: "is",
  is_not: "is not",
} satisfies Record<DataTableTokenFilterOperator, string>;

const booleanOptions: DataTableTokenFilterOption[] = [
  { value: "true", label: "True" },
  { value: "false", label: "False" },
];

export const dataTableTokenFilterFns = {
  text: ((row, columnId, filterValue) =>
    matchesDataTableTokenFilter(
      row.getValue(columnId),
      filterValue,
    )) satisfies FilterFn<any>,
  option: ((row, columnId, filterValue) =>
    matchesDataTableTokenFilter(
      row.getValue(columnId),
      filterValue,
    )) satisfies FilterFn<any>,
  boolean: ((row, columnId, filterValue) =>
    matchesDataTableTokenFilter(
      row.getValue(columnId),
      filterValue,
    )) satisfies FilterFn<any>,
};

export function matchesDataTableTokenFilter(
  rowValue: unknown,
  filterValue: unknown,
): boolean {
  if (!isDataTableTokenFilterValue(filterValue)) return true;

  if (filterValue.operator === "contains") {
    const needle = String(filterValue.value).trim().toLocaleLowerCase();
    if (!needle) return true;
    return String(rowValue ?? "")
      .toLocaleLowerCase()
      .includes(needle);
  }

  if (filterValue.operator === "does_not_contain") {
    const needle = String(filterValue.value).trim().toLocaleLowerCase();
    if (!needle) return true;
    return !String(rowValue ?? "")
      .toLocaleLowerCase()
      .includes(needle);
  }

  const normalizedRowValue =
    typeof filterValue.value === "boolean"
      ? Boolean(rowValue)
      : String(rowValue);
  const normalizedFilterValue =
    typeof filterValue.value === "boolean"
      ? filterValue.value
      : String(filterValue.value);
  const isEqual = normalizedRowValue === normalizedFilterValue;

  return filterValue.operator === "is" ? isEqual : !isEqual;
}

export function isDataTableTokenFilterValue(
  value: unknown,
): value is DataTableTokenFilterValue {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DataTableTokenFilterValue>;
  return (
    typeof candidate.operator === "string" &&
    ["contains", "does_not_contain", "is", "is_not"].includes(
      candidate.operator,
    ) &&
    (typeof candidate.value === "string" ||
      typeof candidate.value === "boolean")
  );
}

export function DataTableTokenFilter<TData extends RowData>({
  table,
  columns,
  className,
  align = "start",
  addLabel = "Add filter",
  clearLabel = "Clear filters",
}: DataTableTokenFilterProps<TData>) {
  const [addOpen, setAddOpen] = React.useState(false);
  const [draftColumnId, setDraftColumnId] = React.useState<string | null>(null);

  const activeFilters = React.useMemo(() => {
    const filterByColumn = new Map(
      columns.map((column) => [column.id, column]),
    );
    return table
      .getState()
      .columnFilters.filter((filter) => filterByColumn.has(filter.id))
      .filter((filter) => isDataTableTokenFilterValue(filter.value))
      .map((filter) => ({
        column: filterByColumn.get(filter.id)!,
        value: filter.value as DataTableTokenFilterValue,
      }));
  }, [columns, table, table.getState().columnFilters]);

  const updateFilter = React.useCallback(
    (column: DataTableTokenFilterColumn, value: DataTableTokenFilterValue) => {
      table.getColumn(column.id)?.setFilterValue(value);
      table.setPageIndex(0);
    },
    [table],
  );

  const removeFilter = React.useCallback(
    (columnId: string) => {
      table.getColumn(columnId)?.setFilterValue(undefined);
      table.setPageIndex(0);
    },
    [table],
  );

  const clearFilters = React.useCallback(() => {
    const columnIds = new Set(columns.map((column) => column.id));
    table.setColumnFilters((current) =>
      current.filter((filter) => !columnIds.has(filter.id)),
    );
    table.setPageIndex(0);
  }, [columns, table]);

  const draftColumn = columns.find((column) => column.id === draftColumnId);

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <Popover
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setDraftColumnId(null);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-2 rounded-md"
            aria-label={addLabel}
          >
            <Filter className="h-4 w-4" aria-hidden="true" />
            <span>{addLabel}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align={align}
          className="w-[min(22rem,calc(100vw-2rem))] p-2"
        >
          {draftColumn ? (
            <FilterValueEditor
              column={draftColumn}
              value={getFilterValue(table, draftColumn.id)}
              onBack={() => setDraftColumnId(null)}
              onApply={(value) => {
                updateFilter(draftColumn, value);
                setAddOpen(false);
                setDraftColumnId(null);
              }}
              onCancel={() => {
                setAddOpen(false);
                setDraftColumnId(null);
              }}
            />
          ) : (
            <FilterSubjectList
              columns={columns}
              onSelect={(column) => setDraftColumnId(column.id)}
            />
          )}
        </PopoverContent>
      </Popover>

      {activeFilters.map(({ column, value }) => (
        <FilterToken
          key={column.id}
          column={column}
          value={value}
          onApply={(nextValue) => updateFilter(column, nextValue)}
          onRemove={() => removeFilter(column.id)}
        />
      ))}

      {activeFilters.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={clearLabel}
          title={clearLabel}
          className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground"
          onClick={clearFilters}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{clearLabel}</span>
        </Button>
      ) : null}
    </div>
  );
}

function FilterSubjectList({
  columns,
  onSelect,
}: {
  columns: DataTableTokenFilterColumn[];
  onSelect: (column: DataTableTokenFilterColumn) => void;
}) {
  return (
    <>
      <PopoverHeader className="px-1 pb-1">
        <PopoverTitle>Filters</PopoverTitle>
      </PopoverHeader>
      <div className="grid gap-1">
        {columns.map((column) => (
          <button
            key={column.id}
            type="button"
            disabled={Boolean(column.disabledReason)}
            className={cn(
              "flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
            )}
            onClick={() => onSelect(column)}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
              {column.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{column.label}</span>
            {column.disabledReason ? (
              <span className="max-w-36 truncate text-xs text-muted-foreground">
                {column.disabledReason}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </>
  );
}

function FilterToken({
  column,
  value,
  onApply,
  onRemove,
}: {
  column: DataTableTokenFilterColumn;
  value: DataTableTokenFilterValue;
  onApply: (value: DataTableTokenFilterValue) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const label = getValueLabel(column, value.value);

  return (
    <div
      aria-label={`${column.label} filter`}
      className="flex h-8 min-w-0 max-w-full items-stretch overflow-hidden rounded-full border bg-background shadow-sm"
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 items-center gap-1.5 px-3 text-sm font-medium hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            aria-label={`Edit ${column.label} filter`}
          >
            {column.icon ? (
              <span className="text-muted-foreground">{column.icon}</span>
            ) : null}
            <span className="truncate">{column.label}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-2">
          <FilterValueEditor
            column={column}
            value={value}
            onApply={(nextValue) => {
              onApply(nextValue);
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        className="border-l px-3 text-sm font-medium text-muted-foreground hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
        onClick={() => setOpen(true)}
      >
        {operatorLabels[value.operator]}
      </button>
      <button
        type="button"
        className="min-w-0 max-w-56 border-l px-3 text-sm font-medium hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
        onClick={() => setOpen(true)}
      >
        <span className="block truncate">{label}</span>
      </button>
      <button
        type="button"
        aria-label={`Remove ${column.label} filter`}
        className="flex w-9 shrink-0 items-center justify-center border-l text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-none"
        onClick={onRemove}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function FilterValueEditor({
  column,
  value,
  onBack,
  onApply,
  onCancel,
}: {
  column: DataTableTokenFilterColumn;
  value?: DataTableTokenFilterValue;
  onBack?: () => void;
  onApply: (value: DataTableTokenFilterValue) => void;
  onCancel: () => void;
}) {
  const [operator, setOperator] = React.useState<DataTableTokenFilterOperator>(
    value?.operator ?? defaultOperatorFor(column),
  );
  const [textValue, setTextValue] = React.useState(
    typeof value?.value === "string" ? value.value : "",
  );

  React.useEffect(() => {
    setOperator(value?.operator ?? defaultOperatorFor(column));
    setTextValue(typeof value?.value === "string" ? value.value : "");
  }, [column.id, column.type, value?.operator, value?.value]);

  const operators = operatorsFor(column);

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2 px-1">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Back to filter subjects"
            onClick={onBack}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : null}
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{column.label}</div>
          <div className="text-xs text-muted-foreground">Filter value</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-md bg-muted/60 p-1">
        {operators.map((nextOperator) => (
          <Button
            key={nextOperator}
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 justify-center rounded-md text-xs",
              operator === nextOperator &&
                "bg-background text-foreground shadow-sm ring-1 ring-border hover:bg-background",
            )}
            aria-pressed={operator === nextOperator}
            onClick={() => setOperator(nextOperator)}
          >
            {operatorLabels[nextOperator]}
          </Button>
        ))}
      </div>

      {column.type === "text" ? (
        <TextValueEditor
          label={`${column.label} value`}
          value={textValue}
          onValueChange={setTextValue}
          onCancel={onCancel}
          onApply={() => {
            const trimmed = textValue.trim();
            if (!trimmed) {
              onCancel();
              return;
            }
            onApply({ operator, value: trimmed });
          }}
        />
      ) : (
        <OptionValueList
          column={column}
          value={value}
          operator={operator}
          onApply={onApply}
        />
      )}
    </div>
  );
}

function TextValueEditor({
  label,
  value,
  onValueChange,
  onApply,
  onCancel,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="grid gap-2">
      <Input
        aria-label={label}
        value={value}
        autoFocus
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onApply();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="default" size="sm" onClick={onApply}>
          Apply
        </Button>
      </div>
    </div>
  );
}

function OptionValueList({
  column,
  value,
  operator,
  onApply,
}: {
  column: DataTableTokenFilterColumn;
  value?: DataTableTokenFilterValue;
  operator: DataTableTokenFilterOperator;
  onApply: (value: DataTableTokenFilterValue) => void;
}) {
  if (column.loading) {
    return (
      <OptionStateMessage>
        {column.loadingMessage ?? "Loading..."}
      </OptionStateMessage>
    );
  }

  if (column.errorMessage) {
    return <OptionStateMessage>{column.errorMessage}</OptionStateMessage>;
  }

  const options =
    column.type === "boolean" ? booleanOptions : (column.options ?? []);

  if (!options.length) {
    return (
      <OptionStateMessage>
        {column.emptyMessage ?? "No options available."}
      </OptionStateMessage>
    );
  }

  return (
    <div className="grid max-h-64 gap-1 overflow-y-auto">
      {options.map((option) => {
        const rawValue =
          column.type === "boolean" ? option.value === "true" : option.value;
        const checked =
          isDataTableTokenFilterValue(value) &&
          value.operator === operator &&
          value.value === rawValue;
        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            className="flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => onApply({ operator, value: rawValue })}
          >
            {option.icon ? (
              <span className="text-muted-foreground">{option.icon}</span>
            ) : null}
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.disabledReason ? (
              <span className="max-w-32 truncate text-xs text-muted-foreground">
                {option.disabledReason}
              </span>
            ) : null}
            {checked ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function OptionStateMessage({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Separator />
      <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
        {children}
      </div>
    </>
  );
}

function operatorsFor(
  column: DataTableTokenFilterColumn,
): DataTableTokenFilterOperator[] {
  return column.type === "text"
    ? ["contains", "does_not_contain"]
    : ["is", "is_not"];
}

function defaultOperatorFor(
  column: DataTableTokenFilterColumn,
): DataTableTokenFilterOperator {
  return column.type === "text" ? "contains" : "is";
}

function getFilterValue<TData extends RowData>(
  table: TanStackTable<TData>,
  columnId: string,
): DataTableTokenFilterValue | undefined {
  const value = table
    .getState()
    .columnFilters.find((filter) => filter.id === columnId)?.value;
  return isDataTableTokenFilterValue(value) ? value : undefined;
}

function getValueLabel(
  column: DataTableTokenFilterColumn,
  value: DataTableTokenFilterValue["value"],
): string {
  if (column.type === "boolean") return value === true ? "True" : "False";
  const option = column.options?.find((item) => item.value === value);
  return option?.label ?? String(value);
}
