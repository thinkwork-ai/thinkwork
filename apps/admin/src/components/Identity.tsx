import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type IdentitySize = "sm" | "md" | "lg";

const avatarSize: Record<IdentitySize, "sm" | "default" | "lg"> = {
  sm: "sm",
  md: "default",
  lg: "lg",
};

const textSize: Record<IdentitySize, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};

// Generate a consistent hue from a name string for avatar background
function nameToHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

interface IdentityProps {
  name: string;
  avatarUrl?: string | null;
  subtitle?: string;
  size?: IdentitySize;
  className?: string;
}

export function Identity({
  name,
  avatarUrl,
  subtitle,
  size = "md",
  className,
}: IdentityProps) {
  const initials = deriveInitials(name);
  const hue = nameToHue(name);

  return (
    <span
      className={cn(
        "inline-flex items-center",
        size === "sm" ? "gap-1.5" : "gap-2",
        size === "lg" && "gap-2.5",
        className,
      )}
    >
      <Avatar size={avatarSize[size]}>
        {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
        <AvatarFallback
          style={{ backgroundColor: `hsl(${hue}, 45%, 65%)`, color: "white" }}
        >
          {initials}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0">
        <span className={cn("truncate block", textSize[size])}>{name}</span>
        {subtitle && (
          <span className="truncate block text-xs text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );
}
