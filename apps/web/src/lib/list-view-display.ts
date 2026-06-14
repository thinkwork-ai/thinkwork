export type DisplayViewMode = "table" | "list";
export type DisplaySortDirection = "asc" | "desc";

export interface DisplayOption<Value extends string = string> {
  value: Value;
  label: string;
}

export interface DisplayListState<
  Group extends string = string,
  Sort extends string = string,
  Property extends string = string,
> {
  view: DisplayViewMode;
  group: Group | "none";
  subgroup: Group | "none";
  sort: Sort;
  dir: DisplaySortDirection;
  showEmptyGroups: boolean;
  showEmptySubgroups: boolean;
  properties: Property[];
}

export interface DisplayListConfig<
  Group extends string = string,
  Sort extends string = string,
  Property extends string = string,
> {
  modes: DisplayViewMode[];
  groups: DisplayOption<Group | "none">[];
  subgroups: DisplayOption<Group | "none">[];
  sorts: DisplayOption<Sort>[];
  properties: DisplayOption<Property>[];
  defaults: DisplayListState<Group, Sort, Property>;
}

export interface DisplaySearchParams {
  view?: DisplayViewMode;
  group?: string;
  subgroup?: string;
  sort?: string;
  dir?: DisplaySortDirection;
  emptyGroups?: boolean;
  emptySubgroups?: boolean;
  props?: string;
}

export interface DisplayGroup<Row> {
  id: string;
  label: string;
  rows: Row[];
  subgroups?: DisplayGroup<Row>[];
}

export interface DisplayGroupingOption<
  Value extends string = string,
  Row = unknown,
> {
  value: Value;
  label: string;
  group: (row: Row) => string;
  labelFor: (key: string) => string;
  emptyKeys?: Array<{ key: string; label: string }>;
}

export interface DisplaySortOption<
  Value extends string = string,
  Row = unknown,
> {
  value: Value;
  compare: (left: Row, right: Row) => number;
}

export function normalizeDisplayState<
  Group extends string,
  Sort extends string,
  Property extends string,
>(
  search: Record<string, unknown>,
  config: DisplayListConfig<Group, Sort, Property>,
): DisplayListState<Group, Sort, Property> {
  const defaults = config.defaults;
  const view = isOneOf(search.view, config.modes) ? search.view : defaults.view;
  const group = normalizeOption(search.group, config.groups, defaults.group);
  const rawSubgroup = normalizeOption(
    search.subgroup,
    config.subgroups,
    defaults.subgroup,
  );
  const subgroup =
    group === "none" || rawSubgroup === group ? "none" : rawSubgroup;
  const sort = normalizeOption(search.sort, config.sorts, defaults.sort);
  const dir =
    search.dir === "asc" || search.dir === "desc" ? search.dir : defaults.dir;
  const propertyValues = new Set(
    config.properties.map((option) => option.value),
  );
  const properties = unique(
    parseProperties(search.props).filter((value): value is Property =>
      propertyValues.has(value as Property),
    ),
  );

  return {
    view,
    group,
    subgroup,
    sort,
    dir,
    showEmptyGroups: parseBoolean(search.emptyGroups, defaults.showEmptyGroups),
    showEmptySubgroups: parseBoolean(
      search.emptySubgroups,
      defaults.showEmptySubgroups,
    ),
    properties: properties.length > 0 ? properties : defaults.properties,
  };
}

export function displayStateToSearch<
  Group extends string,
  Sort extends string,
  Property extends string,
>(
  state: DisplayListState<Group, Sort, Property>,
  config: DisplayListConfig<Group, Sort, Property>,
): DisplaySearchParams {
  const defaults = config.defaults;

  return {
    view: state.view === defaults.view ? undefined : state.view,
    group: state.group === defaults.group ? undefined : state.group,
    subgroup:
      state.group === "none" || state.subgroup === defaults.subgroup
        ? undefined
        : state.subgroup,
    sort: state.sort === defaults.sort ? undefined : state.sort,
    dir: state.dir === defaults.dir ? undefined : state.dir,
    emptyGroups:
      state.showEmptyGroups === defaults.showEmptyGroups
        ? undefined
        : state.showEmptyGroups,
    emptySubgroups:
      state.showEmptySubgroups === defaults.showEmptySubgroups
        ? undefined
        : state.showEmptySubgroups,
    props: sameArray(state.properties, defaults.properties)
      ? undefined
      : state.properties.join(","),
  };
}

export function groupDisplayRows<
  Row,
  Group extends string,
  Sort extends string,
>({
  rows,
  group,
  subgroup,
  sort,
  dir,
  showEmptyGroups,
  showEmptySubgroups,
  groupingOptions,
  sortOptions,
}: {
  rows: Row[];
  group: Group | "none";
  subgroup: Group | "none";
  dir: DisplaySortDirection;
  showEmptyGroups: boolean;
  showEmptySubgroups: boolean;
  sort: Sort;
  groupingOptions: DisplayGroupingOption<Group, Row>[];
  sortOptions: DisplaySortOption<Sort, Row>[];
}): DisplayGroup<Row>[] {
  const sorter =
    sortOptions.find((option) => option.value === sort)?.compare ?? (() => 0);
  const sortedRows = [...rows].sort((left, right) => {
    const result = sorter(left, right);
    return dir === "asc" ? result : -result;
  });

  const primary = groupingOptions.find((option) => option.value === group);
  const secondary =
    subgroup === "none"
      ? undefined
      : groupingOptions.find((option) => option.value === subgroup);

  if (!primary || group === "none") {
    return [{ id: "all", label: "All", rows: sortedRows }];
  }

  return buildGroups(sortedRows, primary, showEmptyGroups).map((mainGroup) => {
    if (!secondary) return mainGroup;
    return {
      ...mainGroup,
      subgroups: buildGroups(mainGroup.rows, secondary, showEmptySubgroups),
    };
  });
}

function buildGroups<Value extends string, Row>(
  rows: Row[],
  option: DisplayGroupingOption<Value, Row>,
  includeEmpty: boolean,
): DisplayGroup<Row>[] {
  const bucketed = new Map<string, Row[]>();
  for (const row of rows) {
    const key = option.group(row);
    const bucket = bucketed.get(key) ?? [];
    bucket.push(row);
    bucketed.set(key, bucket);
  }

  const orderedKeys = includeEmpty
    ? [
        ...(option.emptyKeys ?? []).map(({ key }) => key),
        ...[...bucketed.keys()].filter(
          (key) => !(option.emptyKeys ?? []).some((empty) => empty.key === key),
        ),
      ]
    : [...bucketed.keys()];

  return orderedKeys
    .map((key) => {
      const emptyLabel = option.emptyKeys?.find(
        (empty) => empty.key === key,
      )?.label;
      const groupRows = bucketed.get(key) ?? [];
      return {
        id: key,
        label: emptyLabel ?? option.labelFor(key),
        rows: groupRows,
      };
    })
    .filter((group) => includeEmpty || group.rows.length > 0);
}

function normalizeOption<Value extends string>(
  value: unknown,
  options: DisplayOption<Value>[],
  fallback: Value,
): Value {
  return typeof value === "string" &&
    options.some((option) => option.value === value)
    ? (value as Value)
    : fallback;
}

function isOneOf<Value extends string>(
  value: unknown,
  options: Value[],
): value is Value {
  return typeof value === "string" && options.includes(value as Value);
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
}

function parseProperties(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((item) => typeof item === "string");
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function unique<Value extends string>(values: Value[]): Value[] {
  return [...new Set(values)];
}
