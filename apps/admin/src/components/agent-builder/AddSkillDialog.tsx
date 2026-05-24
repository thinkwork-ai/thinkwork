import { useEffect, useMemo, useState } from "react";
import { AlertCircleIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getWorkspaceFile,
  listWorkspaceFiles,
  WorkspaceFilesApiError,
} from "@/lib/workspace-files-api";
import { installSkill, type Target } from "@/lib/agent-builder-api";
import { cn } from "@/lib/utils";

export interface AddSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: Target;
  onInstalled?: () => void;
}

export interface CatalogSkillOption {
  slug: string;
  summary: string;
}

export interface WiringOption {
  id: string;
  title: string;
  description: string;
  snippet: string;
}

type LoadState = "idle" | "loading" | "ready" | "error";

export function AddSkillDialog({
  open,
  onOpenChange,
  target,
  onInstalled,
}: AddSkillDialogProps) {
  const [catalogState, setCatalogState] = useState<LoadState>("idle");
  const [wiringState, setWiringState] = useState<LoadState>("idle");
  const [installing, setInstalling] = useState(false);
  const [skills, setSkills] = useState<CatalogSkillOption[]>([]);
  const [wiringOptions, setWiringOptions] = useState<WiringOption[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [selectedWiringId, setSelectedWiringId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCatalogState("loading");
    setWiringState("idle");
    setSkills([]);
    setWiringOptions([]);
    setSelectedSlug("");
    setSelectedWiringId("");
    setError(null);

    async function loadCatalog() {
      try {
        const listed = await listWorkspaceFiles({ catalog: true });
        const slugs = catalogSkillSlugs(listed.files.map((file) => file.path));
        const summaries = new Map<string, string>();
        await Promise.all(
          slugs.map(async (slug) => {
            const result = await getWorkspaceFile(
              { catalog: true },
              `${slug}/SKILL.md`,
            );
            summaries.set(slug, result.content ?? "");
          }),
        );
        if (cancelled) return;
        setSkills(
          summarizeCatalogSkills(
            slugs.map((slug) => ({
              slug,
              skillMd: summaries.get(slug) ?? "",
            })),
          ),
        );
        setCatalogState("ready");
      } catch (err) {
        if (cancelled) return;
        setCatalogState("error");
        setError(errorMessage(err));
      }
    }

    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !selectedSlug) return;
    let cancelled = false;
    setWiringState("loading");
    setWiringOptions([]);
    setSelectedWiringId("");
    setError(null);

    async function loadWiring() {
      try {
        const result = await getWorkspaceFile(
          { catalog: true },
          `${selectedSlug}/WIRING.md`,
        );
        const parsed = parseClientWiringMd(result.content ?? "");
        if (cancelled) return;
        setWiringOptions(parsed);
        setSelectedWiringId(parsed[0]?.id ?? "");
        setWiringState("ready");
      } catch (err) {
        if (cancelled) return;
        setWiringState("error");
        setError(errorMessage(err));
      }
    }

    void loadWiring();
    return () => {
      cancelled = true;
    };
  }, [open, selectedSlug]);

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.slug === selectedSlug),
    [skills, selectedSlug],
  );
  const selectedWiring = useMemo(
    () => wiringOptions.find((option) => option.id === selectedWiringId),
    [wiringOptions, selectedWiringId],
  );
  const canInstall = Boolean(selectedSkill && selectedWiring && !installing);

  async function handleInstall() {
    if (!selectedSkill || !selectedWiring) return;
    setInstalling(true);
    setError(null);
    try {
      await installSkill(target, selectedSkill.slug, selectedWiring.id);
      onInstalled?.();
      onOpenChange(false);
    } catch (err) {
      setError(installErrorMessage(err));
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add Skill</DialogTitle>
          <DialogDescription>
            Pick a catalog skill, then choose how it should be wired into this
            workspace.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid max-h-[62vh] gap-4 overflow-y-auto pr-1 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="space-y-2">
            <div className="text-xs font-medium uppercase text-muted-foreground">
              Catalog
            </div>
            {catalogState === "loading" ? (
              <LoadingRow label="Loading catalog" />
            ) : skills.length === 0 ? (
              <EmptyState text="No catalog skills are available." />
            ) : (
              <div className="space-y-2">
                {skills.map((skill) => (
                  <button
                    key={skill.slug}
                    type="button"
                    className={cn(
                      "w-full rounded-md border p-3 text-left transition-colors hover:bg-muted/50",
                      selectedSlug === skill.slug
                        ? "border-ring bg-muted"
                        : "border-border",
                    )}
                    onClick={() => setSelectedSlug(skill.slug)}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{skill.slug}</span>
                      {selectedSlug === skill.slug ? (
                        <CheckIcon className="size-4 shrink-0" />
                      ) : null}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                      {skill.summary || "No summary provided."}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
          <section className="space-y-2">
            <div className="text-xs font-medium uppercase text-muted-foreground">
              Wiring
            </div>
            {!selectedSlug ? (
              <EmptyState text="Select a skill to choose wiring." />
            ) : wiringState === "loading" ? (
              <LoadingRow label="Loading wiring" />
            ) : wiringOptions.length === 0 ? (
              <EmptyState text="This skill has no installable wiring suggestions." />
            ) : (
              <div className="space-y-2">
                {wiringOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={cn(
                      "w-full rounded-md border p-3 text-left transition-colors hover:bg-muted/50",
                      selectedWiringId === option.id
                        ? "border-ring bg-muted"
                        : "border-border",
                    )}
                    onClick={() => setSelectedWiringId(option.id)}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">{option.title}</span>
                      {selectedWiringId === option.id ? (
                        <CheckIcon className="size-4 shrink-0" />
                      ) : null}
                    </span>
                    {option.description ? (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                    <code className="mt-2 block max-h-24 overflow-auto whitespace-pre-wrap rounded-sm bg-muted/70 p-2 text-[11px] text-muted-foreground">
                      {option.snippet}
                    </code>
                  </button>
                ))}
              </div>
            )}
          </section>
        </DialogBody>
        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={installing}
          >
            Cancel
          </Button>
          <Button onClick={handleInstall} disabled={!canInstall}>
            {installing ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : null}
            Add Skill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 animate-spin" />
      {label}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
      {text}
    </div>
  );
}

export function catalogSkillSlugs(paths: string[]): string[] {
  const slugs = new Set<string>();
  for (const path of paths) {
    const [slug, file] = path.split("/");
    if (slug && file === "SKILL.md") slugs.add(slug);
  }
  return Array.from(slugs).sort((a, b) => a.localeCompare(b));
}

export function summarizeCatalogSkills(
  entries: Array<{ slug: string; skillMd: string }>,
): CatalogSkillOption[] {
  return entries
    .map((entry) => ({
      slug: entry.slug,
      summary: skillSummary(entry.skillMd),
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export function skillSummary(markdown: string): string {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatter) {
    const summary =
      frontmatter[1].match(/^summary:\s*"?(.+?)"?\s*$/m)?.[1] ??
      frontmatter[1].match(/^description:\s*"?(.+?)"?\s*$/m)?.[1];
    if (summary) return summary.trim();
  }
  const lines = markdown
    .replace(/^---\n[\s\S]*?\n---/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstParagraph = lines.find((line) => !line.startsWith("#"));
  return firstParagraph ?? "";
}

export function parseClientWiringMd(markdown: string): WiringOption[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const options: WiringOption[] = [];
  for (let index = 0; index < lines.length; index++) {
    const heading = lines[index].match(/^##\s+(.+?)\s*$/);
    if (!heading) continue;
    const title = heading[1].trim();
    const body: string[] = [];
    index++;
    while (index < lines.length && !lines[index].startsWith("## ")) {
      body.push(lines[index]);
      index++;
    }
    index--;
    const block = body.join("\n");
    const snippet = block.match(/```context-md\n([\s\S]*?)```/)?.[1] ?? "";
    if (!snippet.trim()) continue;
    const description = block.slice(0, block.indexOf("```context-md")).trim();
    options.push({
      id: slugifyWiringTitle(title),
      title,
      description,
      snippet: snippet.replace(/\n+$/, "\n"),
    });
  }
  return options;
}

export function slugifyWiringTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function installErrorMessage(err: unknown): string {
  if (err instanceof WorkspaceFilesApiError) {
    if (err.code === "already_installed") {
      return "Skill is already installed in this workspace.";
    }
    if (err.code === "context_md_missing") {
      return "Create CONTEXT.md in this workspace before installing a catalog skill.";
    }
    return err.message;
  }
  return errorMessage(err);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
