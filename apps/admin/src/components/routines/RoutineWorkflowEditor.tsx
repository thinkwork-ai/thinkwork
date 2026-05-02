import { useMemo, useState } from "react";
import { Plus, Search, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  RoutineStepConfigEditor,
  type RoutineConfigField,
  type RoutineConfigStep,
} from "./RoutineStepConfigEditor";

export type RoutineRecipeCatalogItem = {
  id: string;
  displayName: string;
  description: string;
  category: string;
  hitlCapable: boolean;
  defaultArgs: unknown;
  configFields: RoutineConfigField[];
};

interface RoutineWorkflowEditorProps {
  steps: RoutineConfigStep[];
  recipes: RoutineRecipeCatalogItem[];
  fieldValues: Record<string, string>;
  onFieldChange: (key: string, value: string) => void;
  onAddRecipe: (recipe: RoutineRecipeCatalogItem) => void;
  onLabelChange: (nodeId: string, value: string) => void;
  onMoveStep: (nodeId: string, direction: "up" | "down") => void;
  onRemoveStep: (nodeId: string) => void;
  catalogLoading?: boolean;
  fieldErrors?: Record<string, string>;
}

export function RoutineWorkflowEditor({
  steps,
  recipes,
  fieldValues,
  onFieldChange,
  onAddRecipe,
  onLabelChange,
  onMoveStep,
  onRemoveStep,
  catalogLoading = false,
  fieldErrors = {},
}: RoutineWorkflowEditorProps) {
  const [search, setSearch] = useState("");
  const filteredRecipes = useMemo(
    () => filterRecipes(recipes, search),
    [recipes, search],
  );
  const groupedRecipes = useMemo(
    () => groupRecipes(filteredRecipes),
    [filteredRecipes],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
      <aside className="min-w-0 rounded-lg border border-border/70 bg-card/40">
        <div className="space-y-3 border-b border-border/70 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Recipes</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Add blocks to the routine workflow.
              </p>
            </div>
            <Badge variant="outline" className="shrink-0">
              {recipes.length}
            </Badge>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search recipes..."
              className="h-9 pl-8"
            />
          </div>
        </div>
        <div className="max-h-[720px] overflow-y-auto p-2">
          {catalogLoading && (
            <div className="rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
              Loading recipes...
            </div>
          )}
          {!catalogLoading && search && filteredRecipes.length === 0 && (
            <div className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
              No matching recipes.
            </div>
          )}
          {!catalogLoading &&
            groupedRecipes.map(([category, items]) => (
              <div key={category} className="mb-4 last:mb-0">
                <div className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {categoryLabel(category)}
                </div>
                <div className="space-y-1">
                  {items.map((recipe) => (
                    <button
                      key={recipe.id}
                      type="button"
                      onClick={() => onAddRecipe(recipe)}
                      className={cn(
                        "group flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted/60",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground group-hover:text-foreground">
                        <Plus className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {recipe.displayName}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {recipe.description}
                        </p>
                        <div className="mt-1.5 flex min-w-0 flex-wrap gap-1.5">
                          <Badge
                            variant="secondary"
                            className="max-w-full truncate font-mono text-[11px]"
                          >
                            {recipe.id}
                          </Badge>
                          {recipe.hitlCapable && (
                            <Badge variant="outline" className="text-[11px]">
                              HITL
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </aside>

      <section className="min-w-0 rounded-lg border border-border/70 bg-card/40">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Workflow className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Workflow</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {steps.length
                ? `${steps.length} ${steps.length === 1 ? "step" : "steps"}`
                : "Add recipes to assemble the routine."}
            </p>
          </div>
        </div>

        {steps.length ? (
          <RoutineStepConfigEditor
            steps={steps}
            fieldValues={fieldValues}
            onFieldChange={onFieldChange}
            onLabelChange={onLabelChange}
            onMoveStep={onMoveStep}
            onRemoveStep={onRemoveStep}
            fieldErrors={fieldErrors}
          />
        ) : (
          <div className="px-4 py-12 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Workflow className="h-5 w-5" />
            </div>
            <p className="mt-3 text-sm font-medium">No workflow steps yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Add a recipe from the catalog to start configuring this routine.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function groupRecipes(
  recipes: RoutineRecipeCatalogItem[],
): Array<[string, RoutineRecipeCatalogItem[]]> {
  const groups = new Map<string, RoutineRecipeCatalogItem[]>();
  for (const recipe of recipes) {
    const items = groups.get(recipe.category) ?? [];
    items.push(recipe);
    groups.set(recipe.category, items);
  }
  return Array.from(groups.entries());
}

function filterRecipes(
  recipes: RoutineRecipeCatalogItem[],
  search: string,
): RoutineRecipeCatalogItem[] {
  const term = search.trim().toLowerCase();
  if (!term) return recipes;
  return recipes.filter((recipe) =>
    [recipe.id, recipe.displayName, recipe.description, recipe.category].some(
      (value) => value.toLowerCase().includes(term),
    ),
  );
}

function categoryLabel(category: string): string {
  return category.replace(/_/g, " ");
}
