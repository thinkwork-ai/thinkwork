/**
 * Descriptor builders substituted for drizzle's comparison operators in
 * vi.mock("drizzle-orm") factories. DELIBERATELY dependency-free: the mock
 * factory runs while the drizzle-orm module is being resolved, so importing
 * anything that itself imports drizzle-orm (fake-claims-db → schema →
 * drizzle-orm) deadlocks the module graph. Keep this file import-less.
 */

export const drizzleConditionMocks = {
  and: (...conditions: unknown[]) => ({
    op: "and",
    conditions: conditions.filter(Boolean),
  }),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  ne: (col: unknown, val: unknown) => ({ op: "ne", col, val }),
  isNull: (col: unknown) => ({ op: "isNull", col }),
  inArray: (col: unknown, val: unknown) => ({ op: "inArray", col, val }),
  notInArray: (col: unknown, val: unknown) => ({
    op: "notInArray",
    col,
    val,
  }),
};
