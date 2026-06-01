/**
 * Space label helpers shared across the sidebar, workbench, and thread-detail
 * breadcrumb so "is this the default space?" and "what do we call it?" stay
 * consistent everywhere.
 *
 * The structural parameter type is a superset of every call site's space shape:
 * `templateKey` is only present on the workbench's `SpaceSummary`, so it is
 * optional here and simply reads as `undefined` for sidebar/thread spaces —
 * preserving each existing call site's behavior exactly.
 */
export interface SpaceLabelFields {
  slug?: string | null;
  name?: string | null;
  templateKey?: string | null;
}

/** A space is "default" when its slug, name, or template key is default/general. */
export function isDefaultSpace(space: SpaceLabelFields): boolean {
  const slug = space.slug?.toLowerCase();
  const name = space.name?.toLowerCase();
  const templateKey = space.templateKey?.toLowerCase();
  return (
    slug === "default" ||
    slug === "general" ||
    name === "default" ||
    name === "general" ||
    templateKey === "default" ||
    templateKey === "general"
  );
}

/**
 * The label used for a space in navigation chrome. Default (and missing) spaces
 * surface as "Chats" — matching the sidebar's generic section — while named
 * spaces use their human name (falling back to slug).
 */
export function spaceCrumbLabel(space?: SpaceLabelFields | null): string {
  if (!space || isDefaultSpace(space)) return "Chats";
  return space.name || space.slug || "Space";
}
