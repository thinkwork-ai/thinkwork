import { vi } from "vitest";

type Row = Record<string, any>;
type Table = Record<string, any> & { __table: string };
type Predicate = (row: Row) => boolean;

function col(name: string) {
  return { __col: name };
}

function table(name: string, columns: string[]): Table {
  return Object.fromEntries([
    ["__table", name],
    ...columns.map((column) => [column, col(column)]),
  ]) as Table;
}

export const rows = {
  skillDrafts: [] as Row[],
  skillDraftEvents: [] as Row[],
  tenants: [] as Row[],
  threads: [] as Row[],
  users: [] as Row[],
};

export const authMocks = {
  requireTenantAdmin: vi.fn(),
  requireTenantMember: vi.fn(),
  resolveCaller: vi.fn(),
  resolveCallerTenantId: vi.fn(),
  resolveCallerUserId: vi.fn(),
};

export const tables = {
  skillDrafts: table("skillDrafts", [
    "id",
    "tenant_id",
    "requested_by_user_id",
    "source_thread_id",
    "source_message_id",
    "inbox_item_id",
    "slug",
    "title",
    "display_name",
    "summary",
    "source_kind",
    "status",
    "current_content_hash",
    "draft_s3_prefix",
    "failure_message",
    "rejected_by_user_id",
    "rejected_at",
    "published_catalog_slug",
    "published_content_hash",
    "metadata",
    "created_at",
    "updated_at",
    "submitted_at",
  ]),
  skillDraftEvents: table("skillDraftEvents", [
    "id",
    "tenant_id",
    "draft_id",
    "actor_user_id",
    "event_type",
    "message",
    "payload",
    "created_at",
  ]),
  tenants: table("tenants", ["id", "slug"]),
  threads: table("threads", ["id", "tenant_id"]),
  users: table("users", ["id", "name", "email"]),
};

export function resetHarness() {
  rows.skillDrafts = [];
  rows.skillDraftEvents = [];
  rows.tenants = [{ id: "tenant-1", slug: "acme" }];
  rows.threads = [{ id: "thread-1", tenant_id: "tenant-1" }];
  rows.users = [
    { id: "user-1", name: "Ada", email: "ada@example.com" },
    { id: "user-2", name: "Grace", email: "grace@example.com" },
  ];
  authMocks.requireTenantAdmin.mockReset().mockResolvedValue("admin");
  authMocks.requireTenantMember.mockReset().mockResolvedValue("member");
  authMocks.resolveCaller
    .mockReset()
    .mockResolvedValue({ tenantId: "tenant-1", userId: "user-1" });
  authMocks.resolveCallerTenantId.mockReset().mockResolvedValue("tenant-1");
  authMocks.resolveCallerUserId.mockReset().mockResolvedValue("user-1");
}

function rowsFor(tableRef: Table): Row[] {
  switch (tableRef.__table) {
    case "skillDrafts":
      return rows.skillDrafts;
    case "skillDraftEvents":
      return rows.skillDraftEvents;
    case "tenants":
      return rows.tenants;
    case "threads":
      return rows.threads;
    case "users":
      return rows.users;
    default:
      return [];
  }
}

function project(row: Row, selection?: Record<string, any>) {
  if (!selection) return { ...row };
  return Object.fromEntries(
    Object.entries(selection).map(([key, value]) => [key, row[value.__col]]),
  );
}

function queryResult(
  tableRef: Table,
  selection?: Record<string, any>,
  predicate?: Predicate,
  limitCount?: number,
) {
  const source = rowsFor(tableRef).filter((row) =>
    predicate ? predicate(row) : true,
  );
  const limited =
    typeof limitCount === "number" ? source.slice(0, limitCount) : source;
  return limited.map((row) => project(row, selection));
}

function makeSelect(selection?: Record<string, any>) {
  return {
    from(tableRef: Table) {
      const chain: any = {
        _predicate: undefined as Predicate | undefined,
        where(predicate: Predicate) {
          chain._predicate = predicate;
          return chain;
        },
        orderBy() {
          return chain;
        },
        limit(limitCount: number) {
          return Promise.resolve(
            queryResult(tableRef, selection, chain._predicate, limitCount),
          );
        },
        then(
          resolve: (value: Row[]) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(
            queryResult(tableRef, selection, chain._predicate),
          ).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

function withDefaults(tableRef: Table, values: Row) {
  const now = new Date("2026-06-21T00:00:00.000Z");
  const row: Row = {
    id: values.id ?? `${tableRef.__table}-${rowsFor(tableRef).length + 1}`,
    created_at: values.created_at ?? now,
    updated_at: values.updated_at ?? now,
    ...values,
  };
  if (tableRef.__table === "skillDrafts") {
    row.status ??= "draft";
    row.metadata ??= {};
  }
  if (tableRef.__table === "skillDraftEvents") {
    row.payload ??= {};
  }
  return row;
}

export const db = {
  select: vi.fn((selection?: Record<string, any>) => makeSelect(selection)),
  insert: vi.fn((tableRef: Table) => ({
    values(values: Row) {
      const row = withDefaults(tableRef, values);
      rowsFor(tableRef).push(row);
      return {
        returning: () => Promise.resolve([row]),
      };
    },
  })),
  update: vi.fn((tableRef: Table) => ({
    set(patch: Row) {
      return {
        where(predicate: Predicate) {
          const updated = rowsFor(tableRef)
            .filter(predicate)
            .map((row) => Object.assign(row, patch));
          return {
            returning: () => Promise.resolve(updated),
          };
        },
      };
    },
  })),
};

export const eq =
  (field: { __col: string }, value: unknown): Predicate =>
  (row) =>
    row[field.__col] === value;

export const and =
  (...predicates: Predicate[]): Predicate =>
  (row) =>
    predicates.every((predicate) => predicate(row));

export const inArray =
  (field: { __col: string }, values: unknown[]): Predicate =>
  (row) =>
    values.includes(row[field.__col]);

export const asc = () => ({});
export const desc = () => ({});
