"use client";

import * as React from "react";
import {
  type FilterFn,
  type RowData,
  type Table as TanStackTable,
} from "@tanstack/react-table";
import { Check, ChevronLeft, Filter, FilterX, Search, X } from "lucide-react";
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
  | "is_not"
  | "is_any_of"
  | "is_none_of";

export interface DataTableTokenFilterValue {
  operator: DataTableTokenFilterOperator;
  value: string | boolean | Array<string | boolean>;
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
  popoverClassName?: string;
  flattenToolbar?: boolean;
  align?: "start" | "center" | "end";
  addLabel?: string;
  showAddLabel?: boolean;
  clearLabel?: string;
}

const operatorLabels = {
  contains: "contains",
  does_not_contain: "does not contain",
  is: "is",
  is_not: "is not",
  is_any_of: "is any of",
  is_none_of: "is none of",
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
    typeof firstFilterValue(filterValue.value) === "boolean"
      ? Boolean(rowValue)
      : String(rowValue);
  const normalizedFilterValues = filterValueList(filterValue.value).map(
    (value) => (typeof value === "boolean" ? value : String(value)),
  );
  if (normalizedFilterValues.length === 0) return true;
  const isEqual = normalizedFilterValues.some(
    (value) => normalizedRowValue === value,
  );

  return filterValue.operator === "is" || filterValue.operator === "is_any_of"
    ? isEqual
    : !isEqual;
}

export function isDataTableTokenFilterValue(
  value: unknown,
): value is DataTableTokenFilterValue {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DataTableTokenFilterValue>;
  return (
    typeof candidate.operator === "string" &&
    [
      "contains",
      "does_not_contain",
      "is",
      "is_not",
      "is_any_of",
      "is_none_of",
    ].includes(candidate.operator) &&
    isValidFilterValue(candidate.value)
  );
}

export function DataTableTokenFilter<TData extends RowData>({
  table,
  columns,
  className,
  popoverClassName,
  flattenToolbar = false,
  align = "start",
  addLabel = "Add filter",
  showAddLabel = true,
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
      if (isEmptyFilterValue(value)) {
        table.getColumn(column.id)?.setFilterValue(undefined);
        table.setPageIndex(0);
        return;
      }
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
    <div
      className={cn(
        flattenToolbar
          ? "contents"
          : "flex min-w-0 flex-wrap items-center gap-2",
        className,
      )}
    >
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
            {showAddLabel ? <span>{addLabel}</span> : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align={align}
          className={cn(
            "w-[min(22rem,calc(100vw-2rem))] p-2",
            popoverClassName,
          )}
        >
          {draftColumn ? (
            <FilterValueEditor
              column={draftColumn}
              value={getFilterValue(table, draftColumn.id)}
              showOperators={draftColumn.type !== "option"}
              onBack={() => setDraftColumnId(null)}
              onApply={(value) => {
                updateFilter(draftColumn, value);
                if (draftColumn.type !== "option") {
                  setAddOpen(false);
                  setDraftColumnId(null);
                }
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
          size="sm"
          aria-label={clearLabel}
          title={clearLabel}
          className="h-8 rounded-md bg-red-700 px-3 text-white hover:bg-red-800 hover:text-white"
          onClick={clearFilters}
        >
          <FilterX className="h-4 w-4" aria-hidden="true" />
          <span>Clear</span>
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
  const [valueOpen, setValueOpen] = React.useState(false);
  const [operatorOpen, setOperatorOpen] = React.useState(false);
  const label = getValueLabel(column, value.value);
  const valueIcons = getSelectedOptionIcons(column, value.value);

  return (
    <div
      aria-label={`${column.label} filter`}
      data-token-filter-token
      className="flex h-8 max-w-full items-stretch overflow-hidden rounded-full border bg-background shadow-sm"
    >
      <Popover open={valueOpen} onOpenChange={setValueOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-token-filter-subject
            className="flex min-w-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-medium hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
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
            showOperators={column.type !== "option"}
            onApply={(nextValue) => {
              onApply(nextValue);
              if (column.type !== "option") setValueOpen(false);
            }}
            onCancel={() => setValueOpen(false)}
          />
        </PopoverContent>
      </Popover>
      <Popover open={operatorOpen} onOpenChange={setOperatorOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-token-filter-operator
            className="whitespace-nowrap border-l px-3 text-sm font-medium text-muted-foreground hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            aria-label={`Edit ${column.label} operator`}
          >
            {operatorLabels[value.operator]}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <OperatorList
            column={column}
            value={value}
            onSelect={(operator) => {
              onApply({ ...value, operator });
              setOperatorOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        data-token-filter-value
        className="min-w-0 max-w-56 whitespace-nowrap border-l px-3 text-sm font-medium hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
        onClick={() => setValueOpen(true)}
        aria-label={`Edit ${column.label} values`}
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {valueIcons.map((icon, index) => (
            <span
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground"
            >
              {icon}
            </span>
          ))}
          <span className="truncate">{label}</span>
        </span>
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
  showOperators = true,
}: {
  column: DataTableTokenFilterColumn;
  value?: DataTableTokenFilterValue;
  onBack?: () => void;
  onApply: (value: DataTableTokenFilterValue) => void;
  onCancel: () => void;
  showOperators?: boolean;
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

      {showOperators ? (
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
      ) : null}

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
          onCancel={onCancel}
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
  onCancel,
}: {
  column: DataTableTokenFilterColumn;
  value?: DataTableTokenFilterValue;
  operator: DataTableTokenFilterOperator;
  onApply: (value: DataTableTokenFilterValue) => void;
  onCancel: () => void;
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

  if (column.type === "option") {
    return (
      <MultiOptionValueList
        options={options}
        value={value}
        operator={operator}
        onApply={onApply}
      />
    );
  }

  return (
    <div className="grid max-h-64 gap-1 overflow-y-auto">
      {options.map((option) => {
        const rawValue = option.value === "true";
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

function MultiOptionValueList({
  options,
  value,
  operator,
  onApply,
}: {
  options: DataTableTokenFilterOption[];
  value?: DataTableTokenFilterValue;
  operator: DataTableTokenFilterOperator;
  onApply: (value: DataTableTokenFilterValue) => void;
}) {
  const [selectedValues, setSelectedValues] = React.useState<string[]>(() =>
    selectedOptionValues(value),
  );
  const [searchValue, setSearchValue] = React.useState("");

  React.useEffect(() => {
    setSelectedValues(selectedOptionValues(value));
  }, [value?.value]);

  const selectedSet = new Set(selectedValues);
  const filteredOptions = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(searchValue.toLocaleLowerCase()),
  );
  const commitSelection = React.useCallback(
    (nextValues: string[]) => {
      setSelectedValues(nextValues);
      onApply({ operator, value: nextValues });
    },
    [onApply, operator],
  );

  return (
    <div className="grid gap-2">
      <label className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search filter values"
          className="h-9 pl-9"
          placeholder="Search..."
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
        />
      </label>
      <div className="grid max-h-64 gap-1 overflow-y-auto">
        {filteredOptions.map((option) => {
          const checked = selectedSet.has(option.value);
          return (
            <button
              key={option.value}
              type="button"
              role="checkbox"
              aria-checked={checked}
              disabled={option.disabled}
              className={cn(
                "flex min-h-8 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                checked && "bg-accent/30",
              )}
              onClick={() => {
                const nextValues = checked
                  ? selectedValues.filter((item) => item !== option.value)
                  : [...selectedValues, option.value];
                commitSelection(nextValues);
              }}
            >
              <CheckboxIndicator checked={checked} />
              {option.icon ? (
                <span className="shrink-0 text-muted-foreground">
                  {option.icon}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.disabledReason ? (
                <span className="max-w-32 truncate text-xs text-muted-foreground">
                  {option.disabledReason}
                </span>
              ) : null}
            </button>
          );
        })}
        {filteredOptions.length === 0 ? (
          <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            No matching values.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function OperatorList({
  column,
  value,
  onSelect,
}: {
  column: DataTableTokenFilterColumn;
  value: DataTableTokenFilterValue;
  onSelect: (operator: DataTableTokenFilterOperator) => void;
}) {
  const operators = operatorsFor(column);
  const [searchValue, setSearchValue] = React.useState("");
  const filteredOperators = operators.filter((operator) =>
    operatorLabels[operator]
      .toLocaleLowerCase()
      .includes(searchValue.toLocaleLowerCase()),
  );

  return (
    <div className="grid gap-2">
      <label className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search filter operators"
          className="h-9 pl-9"
          placeholder="Search..."
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
        />
      </label>
      <PopoverHeader className="px-1 pb-0">
        <PopoverTitle className="text-xs text-muted-foreground">
          Operators
        </PopoverTitle>
      </PopoverHeader>
      <div className="grid gap-1">
        {filteredOperators.map((operator) => (
          <button
            key={operator}
            type="button"
            className={cn(
              "flex min-h-8 w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted",
              value.operator === operator && "bg-muted",
            )}
            aria-pressed={value.operator === operator}
            onClick={() => onSelect(operator)}
          >
            <span>{operatorLabels[operator]}</span>
            {value.operator === operator ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : null}
          </button>
        ))}
        {filteredOperators.length === 0 ? (
          <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            No matching operators.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CheckboxIndicator({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border border-input",
        checked && "border-primary bg-primary text-primary-foreground",
      )}
    >
      {checked ? <Check className="h-3 w-3" /> : null}
    </span>
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
  if (column.type === "text") return ["contains", "does_not_contain"];
  if (column.type === "option") return ["is_any_of", "is_none_of"];
  return ["is", "is_not"];
}

function defaultOperatorFor(
  column: DataTableTokenFilterColumn,
): DataTableTokenFilterOperator {
  if (column.type === "text") return "contains";
  if (column.type === "option") return "is_any_of";
  return "is";
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
  if (Array.isArray(value)) {
    if (value.length === 1) return getValueLabel(column, value[0]);
    return `${value.length} ${pluralize(column.label)}`;
  }
  if (column.type === "boolean") return value === true ? "True" : "False";
  const option = column.options?.find((item) => item.value === value);
  return option?.label ?? String(value);
}

function getSelectedOptionIcons(
  column: DataTableTokenFilterColumn,
  value: DataTableTokenFilterValue["value"],
) {
  if (column.type !== "option") return [];
  const selectedValues = filterValueList(value).map(String);
  return selectedValues
    .map(
      (selectedValue) =>
        column.options?.find((option) => option.value === selectedValue)?.icon,
    )
    .filter(Boolean)
    .slice(0, 2);
}

function pluralize(label: string) {
  const normalized = label.trim().toLocaleLowerCase();
  if (normalized.endsWith("status")) return `${normalized}es`;
  return normalized.endsWith("s") ? normalized : `${normalized}s`;
}

function isEmptyFilterValue(value: DataTableTokenFilterValue) {
  if (Array.isArray(value.value)) return value.value.length === 0;
  if (typeof value.value === "string") return value.value.trim().length === 0;
  return false;
}

function isValidFilterValue(
  value: Partial<DataTableTokenFilterValue>["value"],
) {
  if (typeof value === "string" || typeof value === "boolean") return true;
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" || typeof item === "boolean")
  );
}

function firstFilterValue(value: DataTableTokenFilterValue["value"]) {
  return Array.isArray(value) ? value[0] : value;
}

function filterValueList(value: DataTableTokenFilterValue["value"]) {
  return Array.isArray(value) ? value : [value];
}

function selectedOptionValues(value?: DataTableTokenFilterValue) {
  if (!isDataTableTokenFilterValue(value)) return [];
  return filterValueList(value.value)
    .filter((item): item is string => typeof item === "string")
    .map(String);
}
