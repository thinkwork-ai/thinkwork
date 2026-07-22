import { CommandGroup, CommandItem, CommandShortcut } from "@thinkwork/ui";
import { BookOpen, Brain, FileText, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EntityDossierResult, SearchEntityHit } from "@/gql/graphql";
import type { PaletteThreadTarget } from "./SearchPalette";

// How many rows of each section the dossier shows before truncating — the
// broker already ranks, so the top few are the grounded highlights.
const SECTION_LIMIT = 4;

/**
 * THINK-263 U5 entity dossier: a grounded, per-entity card rendered at the top
 * of the search palette's broker rails. Purely presentational — all data and
 * navigation callbacks are supplied by the palette host (ChatSidebar). Emits
 * CommandGroup/CommandItem so it stays keyboard-navigable and visually
 * consistent with the rails below it.
 */
export function EntityDossierCard({
  result,
  fetching,
  onOpenEntity,
  onOpenThread,
  onOpenArtifact,
  onSelectEntity,
}: {
  result: EntityDossierResult | null;
  fetching: boolean;
  /** Opens the Twin Explorer entity detail (THINK-327 U7). */
  onOpenEntity: (target: { entityType: string; canonicalId: string }) => void;
  onOpenThread: (target: PaletteThreadTarget) => void;
  onOpenArtifact: (artifactId: string) => void;
  onSelectEntity: (entityId: string) => void;
}) {
  // The rails render their own pending state; a fetching-but-empty dossier adds
  // nothing but noise, so render nothing until a result lands.
  if (!result) {
    void fetching;
    return null;
  }

  const match = result.match;
  if (match) {
    const memories = match.memories.slice(0, SECTION_LIMIT);
    const threads = match.threads.slice(0, SECTION_LIMIT);
    const artifacts = match.artifacts.slice(0, SECTION_LIMIT);
    const canOpenEntity = Boolean(match.canonicalEntityId && match.entityType);
    const hasDetails =
      canOpenEntity ||
      memories.length > 0 ||
      threads.length > 0 ||
      artifacts.length > 0;

    return (
      <CommandGroup
        heading={
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate">{match.label}</span>
            {match.ontologyTypeSlug ? (
              <span className="shrink-0 text-xs font-normal text-muted-foreground">
                {match.ontologyTypeSlug}
              </span>
            ) : null}
          </span>
        }
      >
        {canOpenEntity ? (
          <CommandItem
            value={`dossier-entity ${match.entityId} ${match.canonicalEntityId}`}
            className="h-10"
            onSelect={() =>
              onOpenEntity({
                entityType: match.entityType!,
                canonicalId: match.canonicalEntityId!,
              })
            }
          >
            <BookOpen className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate font-medium">
              Open {match.label}
            </span>
            {/* Dual-read gate verdict: the Explorer detail serves the
                living projected sections for this entity (THINK-327 U7). */}
            {match.twinProjected ? (
              <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                Live
              </span>
            ) : null}
          </CommandItem>
        ) : null}

        {memories.map((memory) => {
          const threadId = memory.threadId;
          return (
            <CommandItem
              key={memory.memoryRecordId}
              value={`dossier-memory ${memory.memoryRecordId}`}
              className="h-10"
              // A memory with no source thread is context-only — shown, but with
              // nowhere to navigate, so it stays inert.
              onSelect={
                threadId ? () => onOpenThread({ id: threadId }) : undefined
              }
            >
              <Brain className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{memory.text}</span>
            </CommandItem>
          );
        })}

        {threads.map((thread) => (
          <CommandItem
            key={thread.id}
            value={`dossier-thread ${thread.id}`}
            className="h-10"
            onSelect={() =>
              onOpenThread({ id: thread.id, spaceId: thread.spaceId })
            }
          >
            <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {thread.title ?? thread.identifier ?? "Untitled thread"}
            </span>
          </CommandItem>
        ))}

        {artifacts.map((artifact) => (
          <CommandItem
            key={artifact.id}
            value={`dossier-artifact ${artifact.id}`}
            className="h-10"
            onSelect={() => onOpenArtifact(artifact.id)}
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {artifact.title ?? artifact.type ?? "Untitled artifact"}
            </span>
          </CommandItem>
        ))}

        {hasDetails ? null : (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            No details found for this entity.
          </div>
        )}
      </CommandGroup>
    );
  }

  if (result.disambiguation.length > 0) {
    return (
      <CommandGroup heading="Did you mean…">
        {result.disambiguation.map((candidate) => (
          <CommandItem
            key={candidate.entityId}
            value={`dossier-disambig ${candidate.entityId}`}
            className="h-10"
            onSelect={() => onSelectEntity(candidate.entityId)}
          >
            <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
            {distinguishingFact(candidate) ? (
              <CommandShortcut className={cn("tracking-normal")}>
                {distinguishingFact(candidate)}
              </CommandShortcut>
            ) : null}
          </CommandItem>
        ))}
      </CommandGroup>
    );
  }

  // No grounded match and nothing to disambiguate — stay silent.
  return null;
}

/** A short, source-safe identity hint for a disambiguation candidate. */
function distinguishingFact(candidate: SearchEntityHit): string {
  const parts: string[] = [];
  if (candidate.ontologyTypeSlug) parts.push(candidate.ontologyTypeSlug);
  if (typeof candidate.evidenceCount === "number") {
    parts.push(
      `${candidate.evidenceCount} ${
        candidate.evidenceCount === 1 ? "mention" : "mentions"
      }`,
    );
  }
  return parts.join(" · ");
}
