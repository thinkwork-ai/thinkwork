import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  MessagesSquare,
  Inbox,
  Bot,
  Monitor,
  Repeat,
  BarChart3,
  Network,
  Settings,
  Plus,
  Moon,
  Sun,
  KeyRound,
  AppWindow,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useDialog } from "@/context/DialogContext";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from "@/components/ui/command";

const NAV_ITEMS = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { label: "Threads", to: "/threads", icon: MessagesSquare },
  { label: "Inbox", to: "/inbox", icon: Inbox },
  { label: "Computers", to: "/computers", icon: Monitor },
  { label: "Apps", to: "/applets", icon: AppWindow },
  { label: "Agents", to: "/agents", icon: Bot },
  { label: "Routines", to: "/automations/routines", icon: Repeat },
  { label: "Credentials", to: "/automations/credentials", icon: KeyRound },
  { label: "Analytics", to: "/analytics", icon: BarChart3 },
  { label: "Org Chart", to: "/org", icon: Network },
  { label: "Settings", to: "/settings", icon: Settings },
] as const;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { openNewThread, openNewAgent } = useDialog();

  // Listen for Cmd+K / Ctrl+K
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  function goTo(to: string) {
    setOpen(false);
    navigate({ to });
  }

  function runAction(fn: () => void) {
    setOpen(false);
    fn();
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          {NAV_ITEMS.map((item) => (
            <CommandItem key={item.to} onSelect={() => goTo(item.to)}>
              <item.icon className="mr-2 h-4 w-4" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Create">
          <CommandItem onSelect={() => runAction(() => openNewThread())}>
            <Plus className="mr-2 h-4 w-4" />
            New Thread
          </CommandItem>
          <CommandItem onSelect={() => runAction(() => openNewAgent())}>
            <Plus className="mr-2 h-4 w-4" />
            New Managed Agent
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Preferences">
          <CommandItem onSelect={() => runAction(toggleTheme)}>
            {theme === "dark" ? (
              <Sun className="mr-2 h-4 w-4" />
            ) : (
              <Moon className="mr-2 h-4 w-4" />
            )}
            Toggle {theme === "dark" ? "light" : "dark"} mode
            <CommandShortcut>Theme</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
