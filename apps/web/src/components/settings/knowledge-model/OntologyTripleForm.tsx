import { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation } from "urql";
import { Loader2 } from "lucide-react";
import {
  Button,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
} from "@thinkwork/ui";
import { OntologyChangeItemType } from "@/gql/graphql";
import {
  SettingsCreateOntologyChangeSetMutation,
  SettingsUpdateOntologyChangeSetMutation,
} from "@/lib/settings-queries";

/** Existing-type option offered on either end of the triple. */
export interface OntologyTypeOption {
  slug: string;
  name: string;
}

/**
 * A still-reviewable candidate loaded into the form for editing. The
 * `updatedAt` carried here becomes the optimistic-concurrency guard
 * (expectedUpdatedAt, R16) on save.
 */
export interface OntologyEditableItem {
  id: string;
  changeSetId: string;
  itemType: string;
  updatedAt: string;
  value: Record<string, unknown>;
}

/** Mirrors the server's slug normalization (R14 pre-validation half). */
export function ontologySlugify(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Client half of the R14 collision check for immediate field feedback —
 * the server remains authoritative and re-runs the real check on save.
 */
export function ontologySlugPrecheck(
  slug: string,
  existingSlugs: ReadonlySet<string>,
): string | null {
  if (!slug) return "Name is required";
  if (!/^[a-z0-9_]+$/.test(slug)) {
    return "Use letters, numbers, and spaces only";
  }
  if (existingSlugs.has(slug)) {
    return `"${slug}" already exists — pick a different name or edit the existing definition`;
  }
  return null;
}

/**
 * R16 conflict detection: the update mutation surfaces
 * OntologyChangeSetConflictError as a GraphQL error whose message names
 * the stale/settled item; match on those markers.
 */
export function isOntologyConflictMessage(message: string) {
  return (
    message.includes("ONTOLOGY_CHANGE_SET_CONFLICT") ||
    message.includes("changed since it was loaded") ||
    message.includes("is settled")
  );
}

interface TripleFormValues {
  sourceSlug: string;
  sourceName: string;
  relationshipName: string;
  targetSlug: string;
  targetName: string;
  entityName: string;
  description: string;
}

const NEW_TYPE = "__new__";

/**
 * Shared form editor of the Living Map (THINK-320 U6, KTD-9): manual
 * add-triple (source type → relationship → target type, new or existing on
 * either end, R7) and candidate edit share this one react-hook-form
 * surface. Save always goes through createOntologyChangeSet /
 * updateOntologyChangeSet — never a direct definition write (R8) — and
 * conflict responses render an inline refresh prompt instead of silently
 * overwriting (R14/R16). First react-hook-form consumer in this area;
 * deliberately self-contained so the pattern is copyable.
 */
export function OntologyTripleForm({
  tenantId,
  editItem,
  typeOptions,
  existingSlugs,
  onSaved,
  onRefresh,
  onCancel,
}: {
  tenantId: string;
  /** Present = edit an existing candidate; absent = manual add-triple. */
  editItem?: OntologyEditableItem | null;
  typeOptions: OntologyTypeOption[];
  /** Approved + pending slugs for the client-side R14 precheck. */
  existingSlugs: ReadonlySet<string>;
  onSaved: () => void;
  /** Re-fetch map/rail data after a conflict so the operator can retry. */
  onRefresh: () => void;
  onCancel?: () => void;
}) {
  const isEdit = !!editItem;
  const editKind = editItem?.itemType?.toUpperCase() ?? null;
  const editIsRelationship = editKind === "RELATIONSHIP_TYPE";

  const [, createChangeSet] = useMutation(
    SettingsCreateOntologyChangeSetMutation,
  );
  const [, updateChangeSet] = useMutation(
    SettingsUpdateOntologyChangeSetMutation,
  );
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editValue = editItem?.value ?? {};
  const form = useForm<TripleFormValues>({
    defaultValues: {
      sourceSlug: isEdit
        ? String((editValue.sourceTypeSlugs as string[] | undefined)?.[0] ?? "")
        : "",
      sourceName: "",
      relationshipName: editIsRelationship ? String(editValue.name ?? "") : "",
      targetSlug: isEdit
        ? String((editValue.targetTypeSlugs as string[] | undefined)?.[0] ?? "")
        : "",
      targetName: "",
      entityName:
        isEdit && !editIsRelationship ? String(editValue.name ?? "") : "",
      description: isEdit ? String(editValue.description ?? "") : "",
    },
  });

  const sourceSlug = form.watch("sourceSlug");
  const targetSlug = form.watch("targetSlug");

  const submitAdd = async (values: TripleFormValues) => {
    const endpoints: Array<{
      field: "sourceName" | "targetName";
      mode: string;
      name: string;
    }> = [
      { field: "sourceName", mode: values.sourceSlug, name: values.sourceName },
      { field: "targetName", mode: values.targetSlug, name: values.targetName },
    ];

    const endpointSlugs: string[] = [];
    const newTypeItems: Array<{ slug: string; name: string }> = [];
    let invalid = false;
    for (const endpoint of endpoints) {
      if (endpoint.mode !== NEW_TYPE) {
        if (!endpoint.mode) {
          form.setError(
            endpoint.field === "sourceName" ? "sourceSlug" : "targetSlug",
            { message: "Pick a type" },
          );
          invalid = true;
          continue;
        }
        endpointSlugs.push(endpoint.mode);
        continue;
      }
      const slug = ontologySlugify(endpoint.name);
      const precheck = ontologySlugPrecheck(slug, existingSlugs);
      if (precheck) {
        form.setError(endpoint.field, { message: precheck });
        invalid = true;
        continue;
      }
      endpointSlugs.push(slug);
      if (!newTypeItems.some((item) => item.slug === slug)) {
        newTypeItems.push({ slug, name: endpoint.name.trim() });
      }
    }

    const relationshipSlug = ontologySlugify(values.relationshipName);
    const relationshipPrecheck = ontologySlugPrecheck(
      relationshipSlug,
      existingSlugs,
    );
    if (relationshipPrecheck) {
      form.setError("relationshipName", { message: relationshipPrecheck });
      invalid = true;
    }
    if (invalid || endpointSlugs.length !== 2) return;

    const [source, target] = endpointSlugs;
    const result = await createChangeSet({
      input: {
        tenantId,
        items: [
          ...newTypeItems.map((item) => ({
            itemType: OntologyChangeItemType.EntityType,
            slug: item.slug,
            proposedValue: { slug: item.slug, name: item.name },
          })),
          {
            itemType: OntologyChangeItemType.RelationshipType,
            slug: relationshipSlug,
            description: values.description.trim() || null,
            proposedValue: {
              slug: relationshipSlug,
              name: values.relationshipName.trim(),
              sourceTypeSlugs: [source],
              targetTypeSlugs: [target],
            },
          },
        ],
      },
    });

    if (result.error) {
      setError(result.error.message);
      return;
    }
    const conflicts = result.data?.createOntologyChangeSet.conflicts ?? [];
    if (conflicts.length > 0) {
      setConflict(
        `"${conflicts[0].slug}" already exists as an approved definition — nothing was staged for it. Refresh the map and adjust your triple.`,
      );
      return;
    }
    onSaved();
  };

  const submitEdit = async (values: TripleFormValues) => {
    if (!editItem) return;
    const editedValue: Record<string, unknown> = editIsRelationship
      ? {
          ...editItem.value,
          name: values.relationshipName.trim(),
          description: values.description.trim() || null,
          sourceTypeSlugs: values.sourceSlug ? [values.sourceSlug] : [],
          targetTypeSlugs: values.targetSlug ? [values.targetSlug] : [],
        }
      : {
          ...editItem.value,
          name: values.entityName.trim(),
          description: values.description.trim() || null,
        };

    const result = await updateChangeSet({
      input: {
        tenantId,
        changeSetId: editItem.changeSetId,
        items: [
          {
            id: editItem.id,
            editedValue,
            expectedUpdatedAt: editItem.updatedAt,
          },
        ],
      },
    });

    if (result.error) {
      if (isOntologyConflictMessage(result.error.message)) {
        setConflict(
          "This candidate changed since you opened it — refresh to load the latest proposal, then re-apply your edit.",
        );
      } else {
        setError(result.error.message);
      }
      return;
    }
    onSaved();
  };

  const onSubmit = async (values: TripleFormValues) => {
    if (submitting) return;
    setSubmitting(true);
    setConflict(null);
    setError(null);
    try {
      if (isEdit) await submitEdit(values);
      else await submitAdd(values);
    } finally {
      setSubmitting(false);
    }
  };

  const typeSelect = (
    field: { value: string; onChange: (value: string) => void },
    label: string,
  ) => (
    <select
      aria-label={label}
      value={field.value}
      onChange={(event) => field.onChange(event.target.value)}
      className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
    >
      <option value="">Pick a type...</option>
      {typeOptions.map((option) => (
        <option key={option.slug} value={option.slug}>
          {option.name}
        </option>
      ))}
      {!isEdit ? <option value={NEW_TYPE}>Create new type...</option> : null}
    </select>
  );

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4"
        aria-label={isEdit ? "Edit candidate" : "Add triple"}
      >
        {isEdit && !editIsRelationship ? (
          <FormField
            control={form.control}
            name="entityName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Type name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Work Order" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : (
          <>
            <FormField
              control={form.control}
              name="sourceSlug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Source type</FormLabel>
                  <FormControl>{typeSelect(field, "Source type")}</FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {sourceSlug === NEW_TYPE ? (
              <FormField
                control={form.control}
                name="sourceName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New source type name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Shipment" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
            <FormField
              control={form.control}
              name="relationshipName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Relationship</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Shipped by" />
                  </FormControl>
                  <FormDescription>
                    Reads as source → relationship → target.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="targetSlug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target type</FormLabel>
                  <FormControl>{typeSelect(field, "Target type")}</FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {targetSlug === NEW_TYPE ? (
              <FormField
                control={form.control}
                name="targetName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New target type name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Carrier" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
          </>
        )}

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={3}
                  placeholder="What this means in your domain..."
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {conflict ? (
          <div
            role="alert"
            className="border-destructive/40 bg-destructive/10 space-y-2 rounded-md border px-3 py-2 text-sm"
          >
            <p>{conflict}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setConflict(null);
                onRefresh();
              }}
            >
              Refresh
            </Button>
          </div>
        ) : null}
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
            ) : null}
            {isEdit ? "Save edit" : "Propose triple"}
          </Button>
          {onCancel ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </Button>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">
          Saving stages a proposal in the review queue — the ontology version
          only changes when the change set is approved.
        </p>
      </form>
    </Form>
  );
}
