import { Avatar, AvatarFallback } from "./avatar.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";

interface UserMenuProps {
  name?: string | null;
  email?: string | null;
  onSignOut: () => void;
}

export function UserMenu({ name, email, onSignOut }: UserMenuProps) {
  const initials = name
    ? name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : email?.slice(0, 2).toUpperCase() ?? "??";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-full ml-1">
          <Avatar size="xs">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            {name ? (
              <p className="text-sm font-medium leading-none">{name}</p>
            ) : null}
            {email ? (
              <p className="text-xs leading-none text-muted-foreground">
                {email}
              </p>
            ) : null}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
