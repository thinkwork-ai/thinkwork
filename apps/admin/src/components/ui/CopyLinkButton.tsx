import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CopyLinkButtonProps {
  text: string;
  ariaLabel?: string;
  className?: string;
}

export function CopyLinkButton({
  text,
  ariaLabel = "Copy",
  className,
}: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Permission denied, insecure context, or older Safari without clipboard API.
      // Leave the icon as Copy to signal "nothing copied" — matches CopyableRow.
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={handleClick}
      aria-label={ariaLabel}
      className={cn("shrink-0", className)}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
    </Button>
  );
}
