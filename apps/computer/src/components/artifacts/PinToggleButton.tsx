import { useState, type MouseEvent } from "react";
import { useMutation } from "urql";
import { Pin } from "lucide-react";
import { toast } from "sonner";
import { Button, cn } from "@thinkwork/ui";
import { UpdateArtifactMutation } from "@/lib/graphql-queries";

export interface PinToggleButtonProps {
  artifactId: string;
  favoritedAt: string | null;
  /** Override the data-testid (used to disambiguate buttons in lists). */
  testId?: string;
}

interface UseArtifactPinToggleResult {
  isPinned: boolean;
  working: boolean;
  toggle: (event?: MouseEvent) => Promise<void>;
}

export function useArtifactPinToggle(
  artifactId: string,
  favoritedAt: string | null,
): UseArtifactPinToggleResult {
  const [, updateArtifact] = useMutation(UpdateArtifactMutation);
  const [working, setWorking] = useState(false);
  const isPinned = favoritedAt !== null;

  async function toggle(event?: MouseEvent) {
    event?.stopPropagation();
    event?.preventDefault();
    if (working) return;
    setWorking(true);
    try {
      const nextValue = isPinned ? null : new Date().toISOString();
      const result = await updateArtifact({
        id: artifactId,
        input: { favoritedAt: nextValue },
      });
      if (result.error) {
        toast.error(
          `Could not ${isPinned ? "unpin" : "pin"} artifact: ${result.error.message}`,
        );
        return;
      }
      toast.success(isPinned ? "Unpinned." : "Pinned.");
    } catch (err) {
      console.error("[PinToggleButton] favoritedAt toggle failed", err);
      toast.error(
        `Could not update pin: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    } finally {
      setWorking(false);
    }
  }

  return { isPinned, working, toggle };
}

export function PinToggleButton({
  artifactId,
  favoritedAt,
  testId,
}: PinToggleButtonProps) {
  const { isPinned, working, toggle } = useArtifactPinToggle(
    artifactId,
    favoritedAt,
  );
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={isPinned ? "Unpin artifact" : "Pin artifact"}
      aria-pressed={isPinned}
      data-testid={testId ?? "pin-toggle-button"}
      disabled={working}
      onClick={(event) => {
        void toggle(event);
      }}
    >
      <Pin className={cn("h-4 w-4", isPinned && "fill-current")} />
    </Button>
  );
}
