/**
 * upsertCanonicalEntityPage — rename + slug-collision behavior (THINK-193 U4).
 *
 * Plan scenario "Rename": canonical Acme changes display name and slug/alias
 * WITHOUT a second page — the same row updates in place and the old slug is
 * seeded as an alias. Slug collisions with a different live page resolve
 * deterministically via a canonical-id suffix.
 */

import { describe, expect, it, vi } from "vitest";
import { upsertCanonicalEntityPage } from "./repository.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CANONICAL = "22222222-2222-4222-8222-222222222222";

interface StubCalls {
  updates: Array<Record<string, unknown>>;
  aliasInserts: Array<Record<string, unknown>>;
  pageInserts: Array<Record<string, unknown>>;
}

/**
 * Minimal drizzle stub: sequenced select results; captured update sets and
 * insert values. `db.transaction(cb)` runs cb against the same stub.
 */
function makeDbStub(selectResults: unknown[][]) {
  const calls: StubCalls = { updates: [], aliasInserts: [], pageInserts: [] };
  let selectIndex = 0;
  const stub: Record<string, unknown> = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => selectResults[selectIndex++] ?? []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((set: Record<string, unknown>) => {
        calls.updates.push(set);
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => [
              { id: "p1", slug: set.slug ?? "unchanged", title: set.title },
            ]),
          })),
        };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        const isAlias = "alias" in values;
        (isAlias ? calls.aliasInserts : calls.pageInserts).push(values);
        return {
          onConflictDoNothing: vi.fn(async () => undefined),
          returning: vi.fn(async () => [{ id: "p-new", ...values }]),
        };
      }),
    })),
  };
  stub.transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb(stub),
  );
  return { db: stub as never, calls };
}

const existingPage = {
  id: "p1",
  tenant_id: TENANT,
  owner_id: null,
  type: "entity",
  canonical_entity_id: CANONICAL,
  slug: "acme-corp",
  title: "Acme Corp",
  summary: "old summary",
  entity_subtype: "company",
  status: "active",
};

describe("upsertCanonicalEntityPage", () => {
  it("renames in place: same page id, new slug + title, old slug becomes an alias", async () => {
    const { db, calls } = makeDbStub([
      [existingPage], // canonical lookup hits
      [], // resolveSlug: nobody owns the new slug
    ]);

    const page = await upsertCanonicalEntityPage(
      {
        tenant_id: TENANT,
        canonical_entity_id: CANONICAL,
        slug: "acme-corporation",
        title: "Acme Corporation",
      },
      db,
    );

    expect(page.id).toBe("p1"); // no second page
    expect(calls.pageInserts).toHaveLength(0);
    expect(calls.updates[0]).toEqual(
      expect.objectContaining({
        slug: "acme-corporation",
        title: "Acme Corporation",
        canonical_entity_id: CANONICAL,
      }),
    );
    expect(calls.aliasInserts).toEqual([
      expect.objectContaining({ alias: "acme-corp", source: "compiler" }),
    ]);
  });

  it("resolves slug collisions deterministically with a canonical-id suffix", async () => {
    const { db, calls } = makeDbStub([
      [existingPage], // canonical lookup
      [{ ...existingPage, id: "p-other", slug: "shared-slug" }], // holder ≠ us
    ]);

    await upsertCanonicalEntityPage(
      {
        tenant_id: TENANT,
        canonical_entity_id: CANONICAL,
        slug: "shared-slug",
        title: "Acme",
      },
      db,
    );

    expect(calls.updates[0]!.slug).toBe(`shared-slug-${CANONICAL.slice(0, 8)}`);
  });

  it("adopts a legacy slug-keyed page lacking a canonical id (backfill stamping)", async () => {
    const legacy = { ...existingPage, canonical_entity_id: null };
    const { db, calls } = makeDbStub([
      [], // no canonical page yet
      [legacy], // legacy page on the desired slug
      [legacy], // resolveSlug: holder is the page we're updating → keep slug
    ]);

    const page = await upsertCanonicalEntityPage(
      {
        tenant_id: TENANT,
        canonical_entity_id: CANONICAL,
        slug: "acme-corp",
        title: "Acme Corp",
      },
      db,
    );

    expect(page.id).toBe("p1");
    expect(calls.pageInserts).toHaveLength(0);
    expect(calls.updates[0]!.canonical_entity_id).toBe(CANONICAL);
  });

  it("inserts a fresh canonical page when nothing exists", async () => {
    const { db, calls } = makeDbStub([
      [], // no canonical page
      [], // no legacy page on the slug
      [], // resolveSlug: slug free
    ]);

    const page = await upsertCanonicalEntityPage(
      {
        tenant_id: TENANT,
        canonical_entity_id: CANONICAL,
        slug: "acme-corp",
        title: "Acme Corp",
      },
      db,
    );

    expect(page.id).toBe("p-new");
    expect(calls.pageInserts[0]).toEqual(
      expect.objectContaining({
        tenant_id: TENANT,
        owner_id: null,
        type: "entity",
        canonical_entity_id: CANONICAL,
        slug: "acme-corp",
      }),
    );
  });
});
