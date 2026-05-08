import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyableRowProps {
  label: string;
  value: string;
  url?: boolean;
  onClick?: () => void;
}

export function CopyableRow({ label, value, url, onClick }: CopyableRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Permission denied, insecure context, or older Safari without clipboard API.
      // Don't flip the icon — leaving Copy visible signals "nothing copied".
    }
  };

  return (
    <div className="flex items-center justify-between text-sm gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        {url ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-primary hover:underline"
          >
            {value.replace(/^https?:\/\//, "")}
          </a>
        ) : onClick ? (
          <button
            type="button"
            onClick={onClick}
            className="truncate text-primary hover:underline font-mono"
          >
            {value}
          </button>
        ) : (
          <span className="truncate">{value}</span>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}
