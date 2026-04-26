import { wikiPages } from "@thinkwork/database-pg/schema";
import { getDb } from "@thinkwork/database-pg";
import { and, eq } from "drizzle-orm";
import { getMemoryServices } from "./memory/index.js";

const db = getDb();

export type ActivationSeed = {
  tenantId: string;
  userId: string;
  layer: string;
  title?: string;
  summary?: string;
  content?: string;
  metadata?: Record<string, unknown>;
};

export async function writeUserMemorySeed(seed: ActivationSeed): Promise<void> {
  const text = seed.content ?? seed.summary ?? seed.title ?? "";
  if (!text.trim()) return;
  const { adapter } = getMemoryServices();
  await adapter.retain({
    tenantId: seed.tenantId,
    ownerType: "user",
    ownerId: seed.userId,
    sourceType: "explicit_remember",
    content: text,
    metadata: {
      ...seed.metadata,
      source: "activation",
      layer: seed.layer,
      fact_type_override: seed.layer === "friction" ? "preference" : "semantic",
    },
  });
}

export async function writeUserWikiSeed(seed: ActivationSeed): Promise<void> {
  if (seed.layer === "friction") {
    throw new Error(
      "Friction-layer activation seeds cannot be written to wiki",
    );
  }
  const title =
    seed.title || inferTitle(seed.summary || seed.content || seed.layer);
  const slug = slugify(title);
  const summary = seed.summary || seed.content || title;
  const [existing] = await db
    .select({ id: wikiPages.id })
    .from(wikiPages)
    .where(
      and(
        eq(wikiPages.tenant_id, seed.tenantId),
        eq(wikiPages.owner_id, seed.userId),
        eq(wikiPages.type, "topic"),
        eq(wikiPages.slug, slug),
      ),
    );
  if (existing) {
    await db
      .update(wikiPages)
      .set({
        summary,
        body_md: seed.content || summary,
        updated_at: new Date(),
      })
      .where(eq(wikiPages.id, existing.id));
    return;
  }

  await db.insert(wikiPages).values({
    tenant_id: seed.tenantId,
    owner_id: seed.userId,
    type: "topic",
    slug,
    title,
    summary,
    body_md: seed.content || summary,
    status: "active",
    tags: ["activation", seed.layer],
  });
}

function inferTitle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Activation note";
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "activation-note"
  );
}
