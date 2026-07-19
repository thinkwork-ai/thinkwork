/**
 * Minimal drizzle-shaped fake db for entity-identity lib tests (THINK-321
 * U2). Select results come from a FIFO queue (`selectQueue`) — tests queue
 * rows in the exact order the code under test issues SELECTs. Inserts,
 * updates, and deletes are recorded (with the drizzle table object identity
 * preserved) so tests can assert what was written where. Insert/update
 * `.returning()` results come from their own FIFO queues.
 *
 * Not a test file itself — the `.test-helper.ts` suffix keeps it out of the
 * vitest `src/**\/*.test.ts` include glob.
 */

type Rows = Array<Record<string, unknown>>;

export interface RecordedWrite {
  table: unknown;
  values: Record<string, unknown>;
}

export interface FakeIdentityDb {
  db: {
    select: (fields?: unknown) => unknown;
    insert: (table: unknown) => unknown;
    update: (table: unknown) => unknown;
    delete: (table: unknown) => unknown;
    transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  selectQueue: Rows[];
  insertReturningQueue: Rows[];
  updateReturningQueue: Rows[];
  inserts: RecordedWrite[];
  updates: RecordedWrite[];
  deletes: Array<{ table: unknown }>;
}

export function createFakeIdentityDb(): FakeIdentityDb {
  const selectQueue: Rows[] = [];
  const insertReturningQueue: Rows[] = [];
  const updateReturningQueue: Rows[] = [];
  const inserts: RecordedWrite[] = [];
  const updates: RecordedWrite[] = [];
  const deletes: Array<{ table: unknown }> = [];

  let generatedIds = 0;

  const nextSelect = () => selectQueue.shift() ?? [];
  const selectChain = () => {
    const resolved = () => Promise.resolve(nextSelect());
    const chain: Record<string, unknown> = {};
    chain.then = (
      resolve: (value: Rows) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => resolved().then(resolve, reject);
    chain.limit = () => resolved();
    chain.orderBy = () => ({ limit: () => resolved() });
    return chain;
  };

  const db: FakeIdentityDb["db"] = {
    select: () => ({
      from: () => ({
        where: () => selectChain(),
        innerJoin: () => ({ where: () => selectChain() }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        const returning = () =>
          Promise.resolve(
            insertReturningQueue.shift() ?? [
              { id: `generated-${(generatedIds += 1)}` },
            ],
          );
        const tail = {
          returning,
          then: (
            resolve: (value: unknown) => unknown,
            reject?: (reason: unknown) => unknown,
          ) => Promise.resolve(undefined).then(resolve, reject),
        };
        return { ...tail, onConflictDoNothing: () => tail };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push({ table, values });
          return {
            then: (
              resolve: (value: unknown) => unknown,
              reject?: (reason: unknown) => unknown,
            ) => Promise.resolve(undefined).then(resolve, reject),
            returning: () =>
              Promise.resolve(updateReturningQueue.shift() ?? []),
          };
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        deletes.push({ table });
        return Promise.resolve(undefined);
      },
    }),
    transaction: async (fn) => fn(db),
  };

  return {
    db,
    selectQueue,
    insertReturningQueue,
    updateReturningQueue,
    inserts,
    updates,
    deletes,
  };
}
