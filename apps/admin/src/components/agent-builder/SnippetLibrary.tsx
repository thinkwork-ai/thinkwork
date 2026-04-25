import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AGENT_BUILDER_SNIPPETS,
  STARTER_AGENT_TEMPLATES,
  type SnippetDefinition,
} from "./snippets";

export interface SnippetLibraryProps {
  onInsert: (snippet: SnippetDefinition) => void;
  onApplyStarter: (snippet: SnippetDefinition) => void;
}

export function SnippetLibrary({
  onInsert,
  onApplyStarter,
}: SnippetLibraryProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs">
          <Wand2 className="mr-1.5 h-3.5 w-3.5" />
          Snippets
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Insert snippet</DropdownMenuLabel>
        {AGENT_BUILDER_SNIPPETS.map((snippet) => (
          <DropdownMenuItem
            key={snippet.id}
            className="flex flex-col items-start gap-0.5"
            onClick={() => onInsert(snippet)}
          >
            <span>{snippet.name}</span>
            <span className="text-xs text-muted-foreground">
              {snippet.description}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Starter content</DropdownMenuLabel>
        {STARTER_AGENT_TEMPLATES.map((snippet) => (
          <DropdownMenuItem
            key={snippet.id}
            className="flex flex-col items-start gap-0.5"
            onClick={() => onApplyStarter(snippet)}
          >
            <span>{snippet.name}</span>
            <span className="text-xs text-muted-foreground">
              {snippet.description}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
