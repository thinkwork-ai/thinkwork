import { FileText, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  files: string[];
  selected: string | null;
  onSelect: (path: string) => void;
};

export function SkillFileTree({ files, selected, onSelect }: Props) {
  // Group files by directory
  const tree = new Map<string, string[]>();
  for (const f of files) {
    const parts = f.split("/");
    if (parts.length > 1) {
      const dir = parts.slice(0, -1).join("/");
      if (!tree.has(dir)) tree.set(dir, []);
      tree.get(dir)!.push(f);
    } else {
      if (!tree.has("")) tree.set("", []);
      tree.get("")!.push(f);
    }
  }

  return (
    <div className="space-y-0.5">
      {/* Root files first */}
      {tree.get("")?.map((f) => (
        <FileItem key={f} path={f} name={f} selected={selected === f} onClick={() => onSelect(f)} />
      ))}

      {/* Grouped directories */}
      {[...tree.entries()]
        .filter(([dir]) => dir !== "")
        .map(([dir, dirFiles]) => (
          <div key={dir}>
            <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
              <FolderOpen className="h-3.5 w-3.5" />
              <span>{dir}</span>
            </div>
            <div className="pl-3">
              {dirFiles.map((f) => (
                <FileItem
                  key={f}
                  path={f}
                  name={f.split("/").pop()!}
                  selected={selected === f}
                  onClick={() => onSelect(f)}
                />
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

function FileItem({
  name,
  selected,
  onClick,
}: {
  path: string;
  name: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 w-full px-2 py-1 text-xs rounded-md transition-colors text-left",
        selected ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted",
      )}
    >
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{name}</span>
    </button>
  );
}
