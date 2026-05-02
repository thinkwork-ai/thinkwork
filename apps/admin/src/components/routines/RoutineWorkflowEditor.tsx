import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
}: RoutineWorkflowEditorProps) {
  const groupedRecipes = groupRecipes(recipes);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
      <aside className="rounded-lg border border-border/70 bg-card/40">
        <div className="border-b border-border/70 px-4 py-3">
          <h2 className="text-sm font-semibold">Recipe catalog</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add product-owned Step Functions blocks to this routine.
          </p>
        </div>
        <div className="max-h-[720px] overflow-y-auto p-3">
          {catalogLoading && (
            <div className="rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
              Loading recipes...
            </div>
          )}
          {!catalogLoading &&
            groupedRecipes.map(([category, items]) => (
              <div key={category} className="mb-4 last:mb-0">
                <div className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {categoryLabel(category)}
                </div>
                <div className="space-y-2">
                  {items.map((recipe) => (
                    <button
                      key={recipe.id}
                      type="button"
                      onClick={() => onAddRecipe(recipe)}
                      className="w-full rounded-md border border-border/70 bg-background/60 p-3 text-left transition-colors hover:bg-muted/60"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {recipe.displayName}
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {recipe.description}
                          </p>
                        </div>
                        <Plus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge
                          variant="secondary"
                          className="font-mono text-[11px]"
                        >
                          {recipe.id}
                        </Badge>
                        {recipe.hitlCapable && (
                          <Badge variant="outline" className="text-[11px]">
                            HITL
                          </Badge>
                        )}
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
            <h2 className="text-sm font-semibold">Workflow</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {steps.length
                ? `${steps.length} recipe ${steps.length === 1 ? "step" : "steps"}`
                : "Start by adding a recipe from the catalog."}
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
          />
        ) : (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No workflow steps yet.
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

function categoryLabel(category: string): string {
  return category.replace(/_/g, " ");
}
