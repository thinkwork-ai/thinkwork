/**
 * Page skeletons per type.
 *
 * Each template describes the canonical section layout for a page type — the
 * planner is steered toward these sections, and the compiler uses them to
 * seed new pages. Section semantics (what each one covers) keep the compiled
 * output consistent across tenants/agents.
 *
 * Treat as v1 defaults; adjust per-page based on record density during the
 * seed run. "No full-page rewrites in v1" still applies: the planner picks
 * which named sections to update, never replaces the whole page.
 */

import type { WikiPageType } from "./repository.js";

export interface SectionTemplate {
  slug: string;
  heading: string;
  /** One-line description for the planner prompt — what belongs here. */
  prompt: string;
}

export interface PageTemplate {
  type: WikiPageType;
  /** One-line description for the planner — when to choose this type. */
  prompt: string;
  sections: SectionTemplate[];
}

export const PAGE_TEMPLATES: Record<WikiPageType, PageTemplate> = {
  entity: {
    type: "entity",
    prompt:
      "A real-world thing the user refers to by name: a person, place, organization, product, repo, or team. Prefer `entity` when the subject has a stable identity and shows up across multiple records.",
    sections: [
      {
        slug: "overview",
        heading: "Overview",
        prompt:
          "Two–four sentence summary of what this entity is, grounded in the cited records. Avoid speculation.",
      },
      {
        slug: "notes",
        heading: "Notes",
        prompt:
          "Notable impressions, opinions, or qualitative observations about this entity, drawn directly from record quotes.",
      },
      {
        slug: "visits",
        heading: "Visits & Interactions",
        prompt:
          "A chronological-ish list (newest first) of meaningful interactions or visits. Keep entries short; cite dates when available.",
      },
      {
        slug: "related",
        heading: "Related",
        prompt:
          "Other pages in this wiki that this entity is meaningfully linked to. Rendered automatically from wiki_page_links; only add prose here when relationships need explanation.",
      },
    ],
  },
  topic: {
    type: "topic",
    prompt:
      "A recurring subject or line of thought that spans multiple records — 'Portuguese trip 2023', 'Best tacos', 'My coffee workflow'. Prefer `topic` when the subject is a theme rather than a single thing.",
    sections: [
      {
        slug: "summary",
        heading: "Summary",
        prompt: "Two–four sentence description of what this topic covers.",
      },
      {
        slug: "highlights",
        heading: "Highlights",
        prompt:
          "Short bulleted highlights — standout moments, patterns, or takeaways.",
      },
      {
        slug: "related_entities",
        heading: "Related Entities",
        prompt:
          "Named entities (places, people, etc.) that show up repeatedly in this topic. Use wiki-page links when the entity already exists.",
      },
      {
        slug: "recent",
        heading: "Recent",
        prompt: "A few of the newest records contributing to this topic.",
      },
    ],
  },
  decision: {
    type: "decision",
    prompt:
      "A recorded choice or stance — 'Switched to Haiku for v1', 'Won't eat there again', 'Tariq is my go-to referral for plumbing'. Prefer `decision` when the subject is a conclusion the user reached, not a thing or theme.",
    sections: [
      {
        slug: "context",
        heading: "Context",
        prompt:
          "What was going on that prompted this decision. Keep to what the records show.",
      },
      {
        slug: "decision",
        heading: "Decision",
        prompt: "The decision itself in one or two plain-language sentences.",
      },
      {
        slug: "rationale",
        heading: "Rationale",
        prompt: "The reasons given or evident in the source records.",
      },
      {
        slug: "consequences",
        heading: "Consequences",
        prompt:
          "Observed follow-on effects: what changed, what got revisited, what to revisit next.",
      },
    ],
  },
};

export function getTemplate(type: WikiPageType): PageTemplate {
  return PAGE_TEMPLATES[type];
}

/**
 * A compact description of all page types for the planner prompt — included
 * verbatim so the planner picks types by the same definition code uses.
 */
export function describeAllPageTypes(): string {
  return Object.values(PAGE_TEMPLATES)
    .map(
      (t) =>
        `- **${t.type}**: ${t.prompt} Sections: ${t.sections.map((s) => s.slug).join(", ")}.`,
    )
    .join("\n");
}

export function describeOntologyAwareWikiGuardrails(): string {
  return [
    "Business/domain ontology is authoritative for tenant Company Brain pages.",
    "Use approved ontology labels, facet names, and relationship names when they are present in context.",
    "Do not invent new business entity types, facet slugs, or relationship labels in prose; describe unsupported concepts as observations instead.",
    "Owner-scoped wiki pages still use the default page templates above unless the caller supplies tenant Brain ontology context.",
  ].join(" ");
}
