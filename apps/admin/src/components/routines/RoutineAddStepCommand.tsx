import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import type { RoutineRecipeCatalogItem } from "./RoutineWorkflowEditor";

interface RoutineAddStepCommandProps {
  open: boolean;
  recipes: RoutineRecipeCatalogItem[];
  onOpenChange: (open: boolean) => void;
  onSelectRecipe: (recipe: RoutineRecipeCatalogItem) => void;
}

export function RoutineAddStepCommand({
  open,
  recipes,
  onOpenChange,
  onSelectRecipe,
}: RoutineAddStepCommandProps) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add routine step"
      description="Search routine recipes."
      className="max-w-2xl"
    >
      <Command>
        <CommandInput placeholder="Search recipes..." />
        <CommandList>
          <CommandEmpty>No recipes found.</CommandEmpty>
          {groupRecipes(recipes).map(([category, items]) => (
            <CommandGroup key={category} heading={categoryLabel(category)}>
              {items.map((recipe) => (
                <CommandItem
                  key={recipe.id}
                  value={`${recipe.displayName} ${recipe.id} ${recipe.category}`}
                  onSelect={() => {
                    onSelectRecipe(recipe);
                    onOpenChange(false);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {recipe.displayName}
                    </div>
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      {recipe.description}
                    </p>
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {recipe.id}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
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
